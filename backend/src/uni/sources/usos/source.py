import asyncio
from collections.abc import Iterable, Iterator
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from uni.domain import (
    AcademicEvent,
    ClassSession,
    Course,
    Exam,
    Grade,
    GradeCategory,
    SourceKind,
)
from uni.sources.usos.client import UsosClient

WARSAW = ZoneInfo("Europe/Warsaw")
TIMETABLE_FIELDS = (
    "start_time|end_time|course_id|course_name|classtype_id|classtype_name|building_id|building_name|room_number"
    "|group_number"
)
GRADE_FIELDS = "value_symbol|passes|value_description|exam_session_number|comment|date_modified"
EXAM_FIELDS = "id|name|course|groups[exam_start|exam_end|room]"
TIMETABLE_MAX_DAYS = 7
CALENDAR_MAX_DAYS = 28
NODE_BATCH = 100
SKIPPED_CALENDAR_TYPES = {"links_edit"}


def text(value: dict[str, str] | str | None) -> str:
    if isinstance(value, dict):
        return value.get("pl") or value.get("en") or ""
    return value or ""


def local_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=WARSAW)


def date_chunks(start: date, end: date, size: int) -> Iterator[tuple[date, int]]:
    cursor = start
    while cursor <= end:
        days = min(size, (end - cursor).days + 1)
        yield cursor, days
        cursor += timedelta(days=days)


def chunked(items: list[Any], size: int) -> Iterator[list[Any]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


class UsosSource:
    kind = SourceKind.USOS

    def __init__(self, client: UsosClient):
        self.client = client

    async def courses(self) -> list[Course]:
        editions = await self._course_editions()
        return [
            Course(
                source=self.kind,
                id=edition["course_id"],
                name=text(edition["course_name"]),
                term=edition["term_id"],
            )
            for edition in editions
        ]

    async def classes(self, start: date, end: date) -> list[ClassSession]:
        weeks = await asyncio.gather(
            *(
                self.client.call(
                    "tt/student", start=chunk_start.isoformat(), days=days, fields=TIMETABLE_FIELDS
                )
                for chunk_start, days in date_chunks(start, end, TIMETABLE_MAX_DAYS)
            )
        )
        entries = [entry for week in weeks for entry in week]
        addresses = await self._building_addresses(
            {entry["building_id"] for entry in entries if entry.get("building_id")}
        )
        return [self._class_session(entry, addresses) for entry in entries]

    async def _building_addresses(self, building_ids: set[str]) -> dict[str, str]:
        buildings = await asyncio.gather(
            *(
                self.client.call("geo/building2", building_id=building_id, fields="id|postal_address")
                for building_id in sorted(building_ids)
            )
        )
        return {
            building["id"]: building["postal_address"]
            for building in buildings
            if building.get("postal_address")
        }

    async def exams(self) -> list[Exam]:
        payload = await self.client.call("exams/student_exams", fields=EXAM_FIELDS)
        return [
            Exam(
                source=self.kind,
                id=f"{exam['id']}:{index}",
                course_id=exam["course"]["id"],
                course_name=text(exam["course"]["name"]),
                name=text(exam["name"]),
                starts_at=local_datetime(group["exam_start"]),
                ends_at=local_datetime(group["exam_end"]),
                room=(group.get("room") or {}).get("number"),
                building=text((group.get("room") or {}).get("building_name")) or None,
            )
            for exam in payload
            for index, group in enumerate(exam.get("groups") or [])
            if group.get("exam_start") and group.get("exam_end")
        ]

    async def academic_events(self, start: date, end: date) -> list[AcademicEvent]:
        faculties = await self._faculty_ids()
        responses = await asyncio.gather(
            *(
                self.client.call(
                    "calendar/search",
                    faculty_id=faculty,
                    start_date=chunk_start.isoformat(),
                    end_date=(chunk_start + timedelta(days=days - 1)).isoformat(),
                )
                for faculty in faculties
                for chunk_start, days in date_chunks(start, end, CALENDAR_MAX_DAYS)
            )
        )
        unique = {event["id"]: event for response in responses for event in response}
        events = [
            AcademicEvent(
                source=self.kind,
                name=text(event["name"]),
                starts_on=datetime.fromisoformat(event["start_date"]).date(),
                ends_on=datetime.fromisoformat(event["end_date"]).date(),
                kind=event["type"],
            )
            for event in unique.values()
            if event["type"] not in SKIPPED_CALENDAR_TYPES and text(event["name"])
        ]
        return sorted(events, key=lambda event: event.starts_on)

    async def grades(self) -> list[Grade]:
        final, points = await asyncio.gather(self._final_grades(), self._test_results())
        return final + points

    async def _course_editions(self) -> list[dict[str, Any]]:
        payload = await self.client.call(
            "courses/user",
            active_terms_only=False,
            fields="course_editions[course_id|course_name|term_id|course_units_ids]|terms",
        )
        return [edition for editions in payload["course_editions"].values() for edition in editions]

    async def _faculty_ids(self) -> list[str]:
        editions = await self._course_editions()
        course_ids = sorted({edition["course_id"] for edition in editions})
        found: set[str] = set()
        for batch in chunked(course_ids, NODE_BATCH):
            courses = await self.client.call("courses/courses", course_ids=batch, fields="id|fac_id")
            found.update(course["fac_id"] for course in courses.values() if course)
        return sorted(found)

    def _class_session(self, entry: dict[str, Any], addresses: dict[str, str]) -> ClassSession:
        return ClassSession(
            source=self.kind,
            course_id=entry["course_id"],
            course_name=text(entry["course_name"]),
            kind=text(entry["classtype_name"]),
            kind_code=entry.get("classtype_id"),
            address=addresses.get(entry.get("building_id") or ""),
            starts_at=local_datetime(entry["start_time"]),
            ends_at=local_datetime(entry["end_time"]),
            room=entry.get("room_number"),
            building=text(entry.get("building_name")) or None,
            group_number=entry.get("group_number"),
        )

    async def _final_grades(self) -> list[Grade]:
        editions = await self._course_editions()
        names = {
            (edition["term_id"], edition["course_id"]): text(edition["course_name"]) for edition in editions
        }
        terms = sorted({edition["term_id"] for edition in editions})
        if not terms:
            return []
        payload = await self.client.call("grades/terms2", term_ids=terms, fields=GRADE_FIELDS)
        unit_ids = sorted(
            {
                unit_id
                for courses in payload.values()
                for course in courses.values()
                for unit_id in course["course_units_grades"]
            }
        )
        classtypes = await self._unit_classtypes(unit_ids)
        grades = []
        for term, courses in payload.items():
            for course_id, course in courses.items():
                course_name = names.get((term, course_id), course_id)
                for sessions in course["course_grades"]:
                    grades += self._session_grades(sessions, term, course_id, course_name, "Course")
                for unit_id, unit_sessions in course["course_units_grades"].items():
                    for sessions in unit_sessions:
                        grades += self._session_grades(
                            sessions,
                            term,
                            course_id,
                            course_name,
                            classtypes.get(unit_id, unit_id),
                        )
        return grades

    async def _unit_classtypes(self, unit_ids: list[str]) -> dict[str, str]:
        if not unit_ids:
            return {}
        index, *units = await asyncio.gather(
            self.client.call("courses/classtypes_index"),
            *(
                self.client.call("courses/units", unit_ids=batch, fields="id|classtype_id")
                for batch in chunked(unit_ids, NODE_BATCH)
            ),
        )
        return {
            unit_id: text(index.get(unit["classtype_id"], {}).get("name")) or unit["classtype_id"]
            for batch in units
            for unit_id, unit in batch.items()
            if unit
        }

    def _session_grades(
        self,
        sessions: dict[str, Any],
        term: str,
        course_id: str,
        course_name: str,
        name: str,
    ) -> list[Grade]:
        return [
            Grade(
                source=self.kind,
                course_id=course_id,
                course_name=course_name,
                category=GradeCategory.SEMESTER,
                name=name if session == "1" else f"{name} (attempt {session})",
                value=grade["value_symbol"],
                term=term,
                passed=grade.get("passes"),
                comment=grade.get("comment"),
                graded_at=local_datetime(grade["date_modified"]) if grade.get("date_modified") else None,
            )
            for session, grade in sorted(sessions.items())
            if grade
        ]

    async def _test_results(self) -> list[Grade]:
        participant = await self.client.call("crstests/participant")
        roots = [root for term_roots in participant["tests"].values() for root in term_roots.values()]
        trees = await asyncio.gather(
            *(
                self.client.call(
                    "crstests/node",
                    node_id=root["node_id"],
                    recursive=True,
                    fields="node_id|name|type|points_max|subnodes",
                )
                for root in roots
            )
        )
        nodes: dict[int, tuple[dict[str, Any], dict[str, Any]]] = {}
        for root, tree in zip(roots, trees, strict=True):
            for node in _walk(tree):
                nodes[node["node_id"]] = (node, root)
        point_ids = [node_id for node_id, (node, _) in nodes.items() if node["type"] == "pkt"]
        grade_ids = [node_id for node_id, (node, _) in nodes.items() if node["type"] == "oc"]
        points, grades = await asyncio.gather(
            self._node_results("crstests/user_points", point_ids),
            self._node_results("crstests/user_grades", grade_ids),
        )
        results = []
        for entry in points + grades:
            node, root = nodes[entry["node_id"]]
            edition = root["course_edition"]
            grade = entry.get("grade")
            results.append(
                Grade(
                    source=self.kind,
                    course_id=edition["course_id"],
                    course_name=text(edition["course_name"]),
                    category=GradeCategory.WORK,
                    name=f"{text(root['name'])} / {text(node['name'])}",
                    value=str(entry["points"]) if grade is None else grade["symbol"],
                    term=edition["term_id"],
                    passed=None if grade is None else grade.get("passes"),
                    max_value=str(node["points_max"]) if node.get("points_max") is not None else None,
                    comment=entry.get("comment") or entry.get("public_comment"),
                    graded_at=local_datetime(entry["last_changed"]) if entry.get("last_changed") else None,
                )
            )
        return results

    async def _node_results(self, method: str, node_ids: list[int]) -> list[dict[str, Any]]:
        batches = await asyncio.gather(
            *(self.client.call(method, node_ids=batch) for batch in chunked(node_ids, NODE_BATCH))
        )
        return [entry for batch in batches for entry in batch if entry]


def _walk(node: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield node
    for child in node.get("subnodes") or []:
        yield from _walk(child)
