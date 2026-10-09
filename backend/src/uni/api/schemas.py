import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, StringConstraints

from uni.aggregator import Collected
from uni.domain import SourceKind
from uni.subjects import CourseRef, SubjectData, SubjectView


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


class CourseRefIn(BaseModel):
    source: SourceKind
    course_id: str = Field(min_length=1, max_length=255)


class SubjectIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")] | None = None
    icon: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,64}$")] | None = None
    courses: list[CourseRefIn] = Field(min_length=1, max_length=20)

    def data(self) -> SubjectData:
        return SubjectData(
            name=self.name or None,
            color=self.color.upper() if self.color else None,
            icon=self.icon,
            courses=[CourseRef(course.source, course.course_id) for course in self.courses],
        )


class SubjectOut(BaseModel):
    id: uuid.UUID
    name: str | None
    color: str | None
    icon: str | None
    courses: list[CourseRefIn]

    @classmethod
    def of(cls, view: SubjectView) -> "SubjectOut":
        return cls(
            id=view.id,
            name=view.name,
            color=view.color,
            icon=view.icon,
            courses=[
                CourseRefIn(source=course.source, course_id=course.course_id) for course in view.courses
            ],
        )
