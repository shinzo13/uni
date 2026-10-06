from datetime import date

from fastapi import APIRouter

from uni.api.deps import AggregatorDep
from uni.api.schemas import Page
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
from uni.sources.base import (
    AssignmentSource,
    CalendarSource,
    CourseSource,
    ExamSource,
    GradeSource,
    MaterialSource,
    PostSource,
    ScheduleSource,
)

router = APIRouter(tags=["data"])


@router.get("/schedule/classes")
async def classes(
    start: date, end: date, aggregator: AggregatorDep, refresh: bool = False
) -> Page[ClassSession]:
    collected = await aggregator.collect(
        f"classes:{start}:{end}",
        ScheduleSource,
        lambda source: source.classes(start, end),
        ClassSession,
        refresh,
    )
    collected.items.sort(key=lambda item: item.starts_at)
    return Page.of(collected)


@router.get("/schedule/exams")
async def exams(aggregator: AggregatorDep, refresh: bool = False) -> Page[Exam]:
    collected = await aggregator.collect("exams", ExamSource, lambda source: source.exams(), Exam, refresh)
    collected.items.sort(key=lambda item: item.starts_at)
    return Page.of(collected)


@router.get("/schedule/events")
async def events(
    start: date, end: date, aggregator: AggregatorDep, refresh: bool = False
) -> Page[AcademicEvent]:
    collected = await aggregator.collect(
        f"events:{start}:{end}",
        CalendarSource,
        lambda source: source.academic_events(start, end),
        AcademicEvent,
        refresh,
    )
    return Page.of(collected)


@router.get("/assignments")
async def assignments(aggregator: AggregatorDep, refresh: bool = False) -> Page[Assignment]:
    collected = await aggregator.collect(
        "assignments", AssignmentSource, lambda source: source.assignments(), Assignment, refresh
    )
    return Page.of(collected)


@router.get("/courses")
async def courses(aggregator: AggregatorDep, refresh: bool = False) -> Page[Course]:
    collected = await aggregator.collect(
        "courses", CourseSource, lambda source: source.courses(), Course, refresh
    )
    return Page.of(collected)


@router.get("/courses/{kind}/{course_id}/sections")
async def sections(
    kind: SourceKind, course_id: str, aggregator: AggregatorDep, refresh: bool = False
) -> Page[CourseSection]:
    collected = await aggregator.collect(
        f"sections:{course_id}",
        MaterialSource,
        lambda source: source.sections(course_id),
        CourseSection,
        refresh,
        only=kind,
    )
    return Page.of(collected)


@router.get("/posts")
async def posts(
    aggregator: AggregatorDep,
    kind: SourceKind | None = None,
    course_id: str | None = None,
    refresh: bool = False,
) -> Page[Post]:
    collected = await aggregator.collect(
        "posts", PostSource, lambda source: source.posts(), Post, refresh, only=kind
    )
    if course_id is not None:
        collected.items = [post for post in collected.items if post.course_id == course_id]
    collected.items.sort(key=lambda item: item.posted_at, reverse=True)
    return Page.of(collected)


@router.get("/grades")
async def grades(aggregator: AggregatorDep, refresh: bool = False) -> Page[Grade]:
    collected = await aggregator.collect(
        "grades", GradeSource, lambda source: source.grades(), Grade, refresh
    )
    return Page.of(collected)
