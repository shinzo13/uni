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
from uni.sources.base import CredentialsExpired, Source

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


class Revalidator:
    def __init__(self, registry: SourceRegistry):
        self.registry = registry
        self._running: dict[tuple[str, str, str], asyncio.Task] = {}

    def schedule(self, user_id: Any, kind: str, dataset: str, fetch: Fetch) -> None:
        key = (str(user_id), kind, dataset)
        if key in self._running:
            return
        task = asyncio.create_task(self._run(user_id, kind, dataset, fetch))
        self._running[key] = task
        task.add_done_callback(lambda _: self._running.pop(key, None))

    async def wait(self) -> None:
        await asyncio.gather(*self._running.values(), return_exceptions=True)

    async def _run(self, user_id: Any, kind: str, dataset: str, fetch: Fetch) -> None:
        async with self.registry.sessions() as db:
            link = await db.scalar(
                select(SourceLink).where(SourceLink.user_id == user_id, SourceLink.kind == kind)
            )
            if link is None or link.expired:
                return
            snapshot = await db.get(Snapshot, (user_id, kind, dataset))
            await refresh_snapshot(db, self.registry, link, dataset, fetch, snapshot)
            await db.commit()


async def refresh_snapshot(
    db: AsyncSession,
    registry: SourceRegistry,
    link: SourceLink,
    dataset: str,
    fetch: Fetch,
    snapshot: Snapshot | None,
    source: Source | None = None,
) -> tuple[Snapshot | None, str | None]:
    try:
        items = await fetch(source or registry.build(link))
    except CredentialsExpired:
        link.expired = True
        return snapshot, "credentials expired"
    except Exception as error:
        log.warning("source %s failed on %s: %r", link.kind, dataset, error)
        return snapshot, "source unavailable"
    payload = [item.model_dump(mode="json") for item in items]
    if snapshot is None:
        snapshot = Snapshot(user_id=link.user_id, kind=link.kind, dataset=dataset, payload=payload)
        db.add(snapshot)
    snapshot.payload = payload
    snapshot.fetched_at = datetime.now(UTC)
    return snapshot, None


class Aggregator:
    def __init__(
        self,
        db: AsyncSession,
        registry: SourceRegistry,
        revalidator: Revalidator,
        user: User,
        max_age: timedelta,
    ):
        self.db = db
        self.registry = registry
        self.revalidator = revalidator
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
        blocking = [(link, source) for link, source in capable if refresh or snapshots.get(link.kind) is None]
        for link, _ in capable:
            snapshot = snapshots.get(link.kind)
            if not refresh and snapshot is not None and not self._fresh(snapshot):
                self.revalidator.schedule(self.user.id, link.kind, dataset, fetch)
        results = await asyncio.gather(
            *(
                refresh_snapshot(
                    self.db, self.registry, link, dataset, fetch, snapshots.get(link.kind), source
                )
                for link, source in blocking
            )
        )
        errors: dict[str, str] = {}
        for (link, _), (snapshot, error) in zip(blocking, results, strict=True):
            if snapshot is not None:
                snapshots[link.kind] = snapshot
            if error:
                errors[link.kind] = error
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

    def _fresh(self, snapshot: Snapshot) -> bool:
        fetched = (
            snapshot.fetched_at if snapshot.fetched_at.tzinfo else snapshot.fetched_at.replace(tzinfo=UTC)
        )
        return datetime.now(UTC) - fetched < self.max_age
