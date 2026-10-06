import uuid
from typing import Any

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from uni.config import Settings
from uni.crypto import SecretBox
from uni.domain import SourceKind
from uni.models import SourceLink
from uni.sources.base import Source
from uni.sources.moodle.client import MoodleClient
from uni.sources.moodle.source import MoodleSource
from uni.sources.teams.client import TeamsClient
from uni.sources.teams.source import TeamsSource
from uni.sources.usos.client import UsosClient
from uni.sources.usos.oauth import Consumer, Token
from uni.sources.usos.source import UsosSource


class SourceRegistry:
    def __init__(
        self, settings: Settings, box: SecretBox, sessions: async_sessionmaker, http: httpx.AsyncClient
    ):
        self.settings = settings
        self.box = box
        self.sessions = sessions
        self.http = http

    def usos_client(self, token: Token | None = None) -> UsosClient:
        consumer = Consumer(self.settings.usos_consumer_key, self.settings.usos_consumer_secret)
        return UsosClient(self.settings.usos_base_url, consumer, token, self.http)

    def moodle_client(self, token: str) -> MoodleClient:
        return MoodleClient(self.settings.moodle_base_url, token, self.http)

    def build(self, link: SourceLink) -> Source:
        credentials = self.box.open(link.credentials)
        match SourceKind(link.kind):
            case SourceKind.USOS:
                return UsosSource(self.usos_client(Token(credentials["token"], credentials["secret"])))
            case SourceKind.MOODLE:
                return MoodleSource(self.moodle_client(credentials["token"]))
            case SourceKind.TEAMS:
                return TeamsSource(TeamsClient(credentials["refresh_token"], self._saver(link.id), self.http))

    def seal(self, credentials: dict[str, Any]) -> str:
        return self.box.seal(credentials)

    def _saver(self, link_id: uuid.UUID):
        async def save(refresh_token: str) -> None:
            async with self.sessions() as session:
                await session.execute(
                    update(SourceLink)
                    .where(SourceLink.id == link_id)
                    .values(credentials=self.box.seal({"refresh_token": refresh_token}))
                )
                await session.commit()

        return save
