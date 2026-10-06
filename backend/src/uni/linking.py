import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uni.domain import SourceKind
from uni.models import PendingLink, SourceLink, User
from uni.registry import SourceRegistry
from uni.sources.moodle.client import launch_url, new_passport, token_from_launch
from uni.sources.teams.client import LoginPending, finish_device_login, start_device_login
from uni.sources.usos.oauth import Token

PENDING_LIFETIME = timedelta(minutes=15)


class LinkNotFound(Exception):
    pass


@dataclass(frozen=True)
class LinkStart:
    kind: SourceKind
    url: str
    user_code: str | None = None


class Linker:
    def __init__(self, db: AsyncSession, registry: SourceRegistry):
        self.db = db
        self.registry = registry
        self.settings = registry.settings

    async def links(self, user: User) -> list[SourceLink]:
        return list(await self.db.scalars(select(SourceLink).where(SourceLink.user_id == user.id)))

    async def start(self, user: User, kind: SourceKind) -> LinkStart:
        match kind:
            case SourceKind.USOS:
                pending = await self._pending(user, kind, "", {})
                client = self.registry.usos_client()
                callback = f"{self.settings.public_url}/sources/usos/callback"
                request_token = await client.request_token(callback)
                pending.lookup = request_token.key
                pending.state = self.registry.seal(
                    {"token": request_token.key, "secret": request_token.secret}
                )
                await self.db.commit()
                return LinkStart(kind, client.authorize_url(request_token))
            case SourceKind.MOODLE:
                passport = new_passport()
                await self._pending(user, kind, passport, {"passport": passport})
                await self.db.commit()
                return LinkStart(
                    kind, launch_url(self.settings.moodle_base_url, passport, self.settings.app_scheme)
                )
            case SourceKind.TEAMS:
                login = await start_device_login(self.registry.http)
                await self._pending(user, kind, login.device_code, {"device_code": login.device_code})
                await self.db.commit()
                return LinkStart(kind, login.verification_uri, login.user_code)

    async def finish_usos(self, request_key: str, verifier: str) -> SourceLink:
        pending = await self._find_pending(SourceKind.USOS, lookup=request_key)
        state = self.registry.box.open(pending.state)
        access = await self.registry.usos_client().access_token(
            Token(state["token"], state["secret"]), verifier
        )
        return await self._link(pending, {"token": access.key, "secret": access.secret})

    async def finish_moodle(self, user: User, redirect: str) -> SourceLink:
        pending = await self._find_pending(SourceKind.MOODLE, user=user)
        passport = self.registry.box.open(pending.state)["passport"]
        token = token_from_launch(self.settings.moodle_base_url, passport, redirect)
        return await self._link(pending, {"token": token})

    async def poll_teams(self, user: User) -> SourceLink | None:
        pending = await self._find_pending(SourceKind.TEAMS, user=user)
        device_code = self.registry.box.open(pending.state)["device_code"]
        try:
            refresh_token = await finish_device_login(self.registry.http, device_code)
        except LoginPending:
            return None
        return await self._link(pending, {"refresh_token": refresh_token})

    async def unlink(self, user: User, kind: SourceKind) -> None:
        await self.db.execute(
            delete(SourceLink).where(SourceLink.user_id == user.id, SourceLink.kind == kind)
        )
        await self.db.commit()

    async def _pending(self, user: User, kind: SourceKind, lookup: str, state: dict[str, Any]) -> PendingLink:
        await self.db.execute(
            delete(PendingLink).where(PendingLink.user_id == user.id, PendingLink.kind == kind)
        )
        pending = PendingLink(
            user_id=user.id,
            kind=kind,
            lookup=lookup,
            state=self.registry.seal(state),
            expires_at=datetime.now(UTC) + PENDING_LIFETIME,
        )
        self.db.add(pending)
        await self.db.flush()
        return pending

    async def _find_pending(
        self, kind: SourceKind, user: User | None = None, lookup: str | None = None
    ) -> PendingLink:
        query = select(PendingLink).where(
            PendingLink.kind == kind, PendingLink.expires_at > datetime.now(UTC)
        )
        if user is not None:
            query = query.where(PendingLink.user_id == user.id)
        if lookup is not None:
            query = query.where(PendingLink.lookup == lookup)
        pending = await self.db.scalar(query)
        if pending is None:
            raise LinkNotFound
        return pending

    async def _link(self, pending: PendingLink, credentials: dict[str, Any]) -> SourceLink:
        link = await self.db.scalar(
            select(SourceLink).where(SourceLink.user_id == pending.user_id, SourceLink.kind == pending.kind)
        )
        if link is None:
            link = SourceLink(id=uuid.uuid4(), user_id=pending.user_id, kind=pending.kind, credentials="")
            self.db.add(link)
        link.credentials = self.registry.seal(credentials)
        link.expired = False
        link.linked_at = datetime.now(UTC)
        await self.db.delete(pending)
        await self.db.commit()
        return link
