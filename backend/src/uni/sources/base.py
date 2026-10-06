from datetime import date
from typing import Protocol, runtime_checkable

from uni.domain import (
    AcademicEvent,
    Assignment,
    ClassSession,
    Course,
    CourseSection,
    Exam,
    Grade,
    Post,
    SourceKind,
)


class SourceError(Exception):
    pass


class CredentialsExpired(SourceError):
    pass


class Source(Protocol):
    kind: SourceKind


@runtime_checkable
class CourseSource(Source, Protocol):
    async def courses(self) -> list[Course]: ...


@runtime_checkable
class ScheduleSource(Source, Protocol):
    async def classes(self, start: date, end: date) -> list[ClassSession]: ...


@runtime_checkable
class ExamSource(Source, Protocol):
    async def exams(self) -> list[Exam]: ...


@runtime_checkable
class CalendarSource(Source, Protocol):
    async def academic_events(self, start: date, end: date) -> list[AcademicEvent]: ...


@runtime_checkable
class AssignmentSource(Source, Protocol):
    async def assignments(self) -> list[Assignment]: ...


@runtime_checkable
class MaterialSource(Source, Protocol):
    async def sections(self, course_id: str) -> list[CourseSection]: ...


@runtime_checkable
class PostSource(Source, Protocol):
    async def posts(self) -> list[Post]: ...


@runtime_checkable
class GradeSource(Source, Protocol):
    async def grades(self) -> list[Grade]: ...
