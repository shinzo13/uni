import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uni.domain import SourceKind
from uni.models import Subject, SubjectCourse, User


class SubjectNotFound(Exception):
    pass


@dataclass(frozen=True)
class CourseRef:
    source: SourceKind
    course_id: str


@dataclass(frozen=True)
class SubjectData:
    name: str | None
    color: str | None
    icon: str | None
    courses: list[CourseRef]


@dataclass(frozen=True)
class SubjectView:
    id: uuid.UUID
    name: str | None
    color: str | None
    icon: str | None
    courses: list[CourseRef]


class Subjects:
    def __init__(self, db: AsyncSession, user: User):
        self.db = db
        self.user = user

    async def list(self) -> list[SubjectView]:
        subjects = await self.db.scalars(
            select(Subject).where(Subject.user_id == self.user.id).order_by(Subject.created_at)
        )
        members = await self.db.scalars(select(SubjectCourse).where(SubjectCourse.user_id == self.user.id))
        courses: dict[uuid.UUID, list[CourseRef]] = {}
        for member in members:
            courses.setdefault(member.subject_id, []).append(
                CourseRef(SourceKind(member.kind), member.course_id)
            )
        return [_view(subject, courses.get(subject.id, [])) for subject in subjects]

    async def create(self, data: SubjectData) -> SubjectView:
        subject = Subject(user_id=self.user.id)
        self.db.add(subject)
        await self.db.flush()
        return await self._save(subject, data)

    async def update(self, subject_id: uuid.UUID, data: SubjectData) -> SubjectView:
        return await self._save(await self._get(subject_id), data)

    async def delete(self, subject_id: uuid.UUID) -> None:
        subject = await self._get(subject_id)
        await self.db.execute(delete(SubjectCourse).where(SubjectCourse.subject_id == subject.id))
        await self.db.delete(subject)
        await self.db.commit()

    async def _get(self, subject_id: uuid.UUID) -> Subject:
        subject = await self.db.get(Subject, subject_id)
        if subject is None or subject.user_id != self.user.id:
            raise SubjectNotFound
        return subject

    async def _save(self, subject: Subject, data: SubjectData) -> SubjectView:
        subject.name, subject.color, subject.icon = data.name, data.color, data.icon
        courses = list(dict.fromkeys(data.courses))
        await self.db.execute(
            delete(SubjectCourse).where(
                SubjectCourse.user_id == self.user.id, SubjectCourse.subject_id == subject.id
            )
        )
        for course in courses:
            await self.db.execute(
                delete(SubjectCourse).where(
                    SubjectCourse.user_id == self.user.id,
                    SubjectCourse.kind == course.source,
                    SubjectCourse.course_id == course.course_id,
                )
            )
        self.db.add_all(
            SubjectCourse(
                user_id=self.user.id, kind=course.source, course_id=course.course_id, subject_id=subject.id
            )
            for course in courses
        )
        await self.db.flush()
        await self._drop_empty()
        await self.db.commit()
        return _view(subject, courses)

    async def _drop_empty(self) -> None:
        used = select(SubjectCourse.subject_id).where(SubjectCourse.user_id == self.user.id)
        await self.db.execute(delete(Subject).where(Subject.user_id == self.user.id, Subject.id.not_in(used)))


def _view(subject: Subject, courses: list[CourseRef]) -> SubjectView:
    return SubjectView(subject.id, subject.name, subject.color, subject.icon, courses)
