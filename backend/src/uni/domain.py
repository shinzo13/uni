import re
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class SourceKind(StrEnum):
    USOS = "usos"
    MOODLE = "moodle"
    TEAMS = "teams"


class Model(BaseModel):
    model_config = ConfigDict(frozen=True)


class Attachment(Model):
    name: str
    url: str
    mime_type: str | None = None
    size: int | None = None


class Course(Model):
    source: SourceKind
    id: str
    name: str
    term: str | None = None
    url: str | None = None


class ClassSession(Model):
    source: SourceKind
    course_id: str
    course_name: str
    kind: str
    kind_code: str | None = None
    starts_at: datetime
    ends_at: datetime
    room: str | None = None
    building: str | None = None
    address: str | None = None
    group_number: int | None = None


class AcademicEvent(Model):
    source: SourceKind
    name: str
    starts_on: date
    ends_on: date
    kind: str


class Exam(Model):
    source: SourceKind
    id: str
    course_id: str
    course_name: str
    name: str
    starts_at: datetime
    ends_at: datetime
    room: str | None = None
    building: str | None = None


class AssignmentStatus(StrEnum):
    NEW = "new"
    DRAFT = "draft"
    SUBMITTED = "submitted"
    GRADED = "graded"
    UNKNOWN = "unknown"


class AssignmentKind(StrEnum):
    ASSIGNMENT = "assignment"
    QUIZ = "quiz"


class Assignment(Model):
    source: SourceKind
    id: str
    course_id: str
    course_name: str
    title: str
    kind: AssignmentKind = AssignmentKind.ASSIGNMENT
    description_html: str = ""
    opens_at: datetime | None = None
    due_at: datetime | None = None
    status: AssignmentStatus = AssignmentStatus.UNKNOWN
    submitted_at: datetime | None = None
    grade: str | None = None
    url: str | None = None
    attachments: tuple[Attachment, ...] = ()


class ItemKind(StrEnum):
    PAGE = "page"
    FILE = "file"
    FOLDER = "folder"
    LINK = "link"
    LABEL = "label"
    ASSIGNMENT = "assignment"
    QUIZ = "quiz"
    FORUM = "forum"
    OTHER = "other"


class CourseItem(Model):
    id: str
    kind: ItemKind
    title: str
    url: str | None = None
    html: str = ""
    attachments: tuple[Attachment, ...] = ()


class CourseSection(Model):
    id: str
    title: str
    summary_html: str = ""
    items: tuple[CourseItem, ...] = ()


class Post(Model):
    source: SourceKind
    id: str
    course_id: str
    course_name: str
    author: str | None
    title: str | None
    body_html: str
    posted_at: datetime
    replies: tuple["Post", ...] = ()
    attachments: tuple[Attachment, ...] = ()


class GradeCategory(StrEnum):
    SEMESTER = "semester"
    WORK = "work"
    ASSIGNMENT = "assignment"


WORK_NAMES = re.compile(r"kolokw|kolos|\bkol\b|egzamin|exam|test|sprawdzian|kartk|midterm", re.IGNORECASE)


def assessed_category(name: str) -> GradeCategory:
    return GradeCategory.WORK if WORK_NAMES.search(name) else GradeCategory.ASSIGNMENT


class Grade(Model):
    source: SourceKind
    course_id: str
    course_name: str
    category: GradeCategory
    name: str
    value: str
    term: str | None = None
    passed: bool | None = None
    max_value: str | None = None
    comment: str | None = None
    graded_at: datetime | None = None
