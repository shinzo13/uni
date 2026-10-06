from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from uni.aggregator import Collected
from uni.domain import SourceKind


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class SessionToken(BaseModel):
    token: str


class Me(BaseModel):
    email: str


class SourceStatus(BaseModel):
    kind: SourceKind
    linked: bool
    expired: bool = False
    linked_at: datetime | None = None


class LinkStartOut(BaseModel):
    kind: SourceKind
    url: str
    user_code: str | None = None


class MoodleRedirect(BaseModel):
    redirect: str


class TeamsPoll(BaseModel):
    linked: bool


class SourceStateOut(BaseModel):
    kind: SourceKind
    fetched_at: datetime | None
    error: str | None


class Page[T](BaseModel):
    items: list[T]
    sources: list[SourceStateOut]

    @classmethod
    def of(cls, collected: Collected) -> "Page[T]":
        return cls(
            items=collected.items,
            sources=[
                SourceStateOut(kind=state.kind, fetched_at=state.fetched_at, error=state.error)
                for state in collected.sources
            ],
        )
