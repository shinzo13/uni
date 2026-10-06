import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uni.domain import SourceKind
from uni.models import Snapshot, SourceLink, User
from uni.registry import SourceRegistry
from uni.sources.base import CredentialsExpired, Source, SourceError

log = logging.getLogger(__name__)

Fetch = Callable[[Any], Awaitable[list[BaseModel]]]


@dataclass(frozen=True)
class SourceState:
    kind: SourceKind
    fetched_at: datetime | None
    error: str | None = None


@dataclass
class Collected[T]:
    items: list[T] = field(default_factory=list)
    sources: list[SourceState] = field(default_factory=list)


class Aggregator:
    def __init__(self, db: AsyncSession, registry: SourceRegistry, user: User, max_age: timedelta):
        self.db = db
        self.registry = registry
        self.user = user
        self.max_age = max_age

    async def collect[T: BaseModel](
        self,
        dataset: str,
        capability: type,
        fetch: Callable[[Any], Awaitable[list[T]]],
        model: type[T],
        refresh: bool = False,
        only: SourceKind | None = None,
    ) -> Collected[T]:
        links = [
            link
            for link in await self.db.scalars(select(SourceLink).where(SourceLink.user_id == self.user.id))
            if not link.expired and (only is None or link.kind == only)
        ]
        sources = [(link, self.registry.build(link)) for link in links]
        capable = [(link, source) for link, source in sources if isinstance(source, capability)]
        snapshots = {
            snapshot.kind: snapshot
            for snapshot in await self.db.scalars(
                select(Snapshot).where(Snapshot.user_id == self.user.id, Snapshot.dataset == dataset)
            )
        }
        stale = [
            (link, source) for link, source in capable if refresh or not self._fresh(snapshots.get(link.kind))
        ]
        results = await asyncio.gather(
            *(self._fetch(source, fetch) for _, source in stale), return_exceptions=True
        )
        errors: dict[str, str] = {}
        for (link, _), result in zip(stale, results, strict=True):
            if isinstance(result, CredentialsExpired):
                link.expired = True
                errors[link.kind] = "credentials expired"
            elif isinstance(result, BaseException):
                log.warning("source %s failed on %s: %r", link.kind, dataset, result)
                errors[link.kind] = "source unavailable"
            else:
                snapshots[link.kind] = await self._store(link.kind, dataset, result, snapshots.get(link.kind))
        await self.db.commit()

        adapter = TypeAdapter(list[model])
        collected: Collected[T] = Collected()
        for link, _ in capable:
            snapshot = snapshots.get(link.kind)
            if snapshot is not None:
                collected.items += adapter.validate_python(snapshot.payload)
            collected.sources.append(
                SourceState(
                    kind=SourceKind(link.kind),
                    fetched_at=snapshot.fetched_at if snapshot else None,
                    error=errors.get(link.kind),
                )
            )
        return collected

    def _fresh(self, snapshot: Snapshot | None) -> bool:
        if snapshot is None:
            return False
        fetched = (
            snapshot.fetched_at if snapshot.fetched_at.tzinfo else snapshot.fetched_at.replace(tzinfo=UTC)
        )
        return datetime.now(UTC) - fetched < self.max_age

    async def _fetch(self, source: Source, fetch: Fetch) -> list[dict[str, Any]]:
        try:
            items = await fetch(source)
        except (CredentialsExpired, SourceError):
            raise
        except Exception as error:
            raise SourceError(repr(error)) from error
        return [item.model_dump(mode="json") for item in items]

    async def _store(
        self, kind: str, dataset: str, payload: list[dict[str, Any]], snapshot: Snapshot | None
    ) -> Snapshot:
        if snapshot is None:
            snapshot = Snapshot(user_id=self.user.id, kind=kind, dataset=dataset, payload=payload)
            self.db.add(snapshot)
        snapshot.payload = payload
        snapshot.fetched_at = datetime.now(UTC)
        return snapshot
