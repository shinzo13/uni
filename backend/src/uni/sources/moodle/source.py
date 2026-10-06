import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from uni.domain import (
    Assignment,
    AssignmentKind,
    AssignmentStatus,
    Attachment,
    Course,
    CourseItem,
    CourseSection,
    Grade,
    GradeKind,
    ItemKind,
    Post,
    SourceKind,
)
from uni.sources.base import SourceError
from uni.sources.moodle.client import MoodleClient

PARALLEL_CALLS = 8
ITEM_KINDS = {
    "page": ItemKind.PAGE,
    "resource": ItemKind.FILE,
    "folder": ItemKind.FOLDER,
    "url": ItemKind.LINK,
    "label": ItemKind.LABEL,
    "assign": ItemKind.ASSIGNMENT,
    "quiz": ItemKind.QUIZ,
    "forum": ItemKind.FORUM,
}
SUBMISSION_STATUSES = {
    "new": AssignmentStatus.NEW,
    "draft": AssignmentStatus.DRAFT,
    "submitted": AssignmentStatus.SUBMITTED,
}
EMPTY_GRADES = {"", "-"}
HIDDEN_GRADES_CODE = "nopermissiontoviewgrades"


def timestamp(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if value else None


def attachment(file: dict[str, Any]) -> Attachment:
    return Attachment(
        name=file["filename"],
        url=file["fileurl"],
        mime_type=file.get("mimetype"),
        size=file.get("filesize"),
    )


class MoodleSource:
    kind = SourceKind.MOODLE

    def __init__(self, client: MoodleClient):
        self.client = client
        self._user_id: int | None = None
        self._limit = asyncio.Semaphore(PARALLEL_CALLS)

    async def courses(self) -> list[Course]:
        return [
            Course(
                source=self.kind,
                id=str(course["id"]),
                name=course["fullname"],
                url=f"{self.client.base_url}/course/view.php?id={course['id']}",
            )
            for course in await self._raw_courses()
        ]

    async def sections(self, course_id: str) -> list[CourseSection]:
        contents, pages = await asyncio.gather(
            self.client.call("core_course_get_contents", courseid=course_id),
            self.client.call("mod_page_get_pages_by_courses", courseids=[course_id]),
        )
        page_html = {page["coursemodule"]: page["content"] for page in pages["pages"]}
        return [
            CourseSection(
                id=str(section["id"]),
                title=section["name"],
                summary_html=section.get("summary") or "",
                items=tuple(
                    self._course_item(module, page_html)
                    for module in section["modules"]
                    if module.get("uservisible", True)
                ),
            )
            for section in contents
            if section.get("uservisible", True)
        ]

    async def assignments(self) -> list[Assignment]:
        courses = {str(course["id"]): course["fullname"] for course in await self._raw_courses()}
        if not courses:
            return []
        assigns, quizzes = await asyncio.gather(
            self._assigns(list(courses), courses),
            self._quizzes(list(courses), courses),
        )
        return assigns + quizzes

    async def posts(self) -> list[Post]:
        courses = {str(course["id"]): course["fullname"] for course in await self._raw_courses()}
        if not courses:
            return []
        forums = await self.client.call("mod_forum_get_forums_by_courses", courseids=list(courses))
        discussions = await self._each(
            forums, lambda forum: self.client.call("mod_forum_get_forum_discussions", forumid=forum["id"])
        )
        return [
            Post(
                source=self.kind,
                id=str(discussion["discussion"]),
                course_id=str(forum["course"]),
                course_name=courses.get(str(forum["course"]), ""),
                author=discussion.get("userfullname"),
                title=discussion.get("subject") or discussion.get("name"),
                body_html=discussion.get("message") or "",
                posted_at=timestamp(discussion["created"]),
                attachments=tuple(attachment(file) for file in discussion.get("attachments") or []),
            )
            for forum, payload in zip(forums, discussions, strict=True)
            for discussion in payload.get("discussions", [])
        ]

    async def grades(self) -> list[Grade]:
        courses = await self._raw_courses()
        user_id = await self._current_user_id()
        reports = await self._each(courses, lambda course: self._grade_report(course["id"], user_id))
        return [
            grade
            for course, report in zip(courses, reports, strict=True)
            for user_grades in report.get("usergrades", [])
            for grade in self._course_grades(course, user_grades["gradeitems"])
        ]

    async def _grade_report(self, course_id: int, user_id: int) -> dict[str, Any]:
        try:
            return await self.client.call(
                "gradereport_user_get_grade_items", courseid=course_id, userid=user_id
            )
        except SourceError as error:
            if HIDDEN_GRADES_CODE in str(error):
                return {}
            raise

    async def _current_user_id(self) -> int:
        if self._user_id is None:
            info = await self.client.call("core_webservice_get_site_info")
            self._user_id = info["userid"]
        return self._user_id

    async def _raw_courses(self) -> list[dict[str, Any]]:
        user_id = await self._current_user_id()
        return await self.client.call("core_enrol_get_users_courses", userid=user_id)

    async def _each(self, items: list[Any], fetch: Callable[[Any], Awaitable[Any]]) -> list[Any]:
        async def limited(item: Any) -> Any:
            async with self._limit:
                return await fetch(item)

        return await asyncio.gather(*(limited(item) for item in items))

    def _course_item(self, module: dict[str, Any], page_html: dict[int, str]) -> CourseItem:
        kind = ITEM_KINDS.get(module["modname"], ItemKind.OTHER)
        files = [file for file in module.get("contents") or [] if file.get("type") == "file"]
        if kind == ItemKind.LINK:
            url = next((file["fileurl"] for file in module.get("contents") or []), module.get("url"))
        else:
            url = module.get("url")
        return CourseItem(
            id=str(module["id"]),
            kind=kind,
            title=module["name"],
            url=url,
            html=page_html.get(module["id"]) or module.get("description") or "",
            attachments=() if kind == ItemKind.PAGE else tuple(attachment(file) for file in files),
        )

    async def _assigns(self, course_ids: list[str], names: dict[str, str]) -> list[Assignment]:
        payload = await self.client.call("mod_assign_get_assignments", courseids=course_ids)
        items = [(course, assign) for course in payload["courses"] for assign in course["assignments"]]
        statuses = await self._each(
            items,
            lambda item: self.client.call("mod_assign_get_submission_status", assignid=item[1]["id"]),
        )
        return [
            self._assignment(course, assign, status, names)
            for (course, assign), status in zip(items, statuses, strict=True)
        ]

    def _assignment(
        self,
        course: dict[str, Any],
        assign: dict[str, Any],
        status: dict[str, Any],
        names: dict[str, str],
    ) -> Assignment:
        attempt = status.get("lastattempt") or {}
        submission = attempt.get("submission") or attempt.get("teamsubmission") or {}
        grade = (status.get("feedback") or {}).get("gradefordisplay")
        state = SUBMISSION_STATUSES.get(submission.get("status"), AssignmentStatus.UNKNOWN)
        if grade:
            state = AssignmentStatus.GRADED
        return Assignment(
            source=self.kind,
            id=f"assign:{assign['id']}",
            course_id=str(course["id"]),
            course_name=names.get(str(course["id"]), course.get("fullname", "")),
            title=assign["name"],
            description_html=assign.get("intro") or "",
            opens_at=timestamp(assign.get("allowsubmissionsfromdate")),
            due_at=timestamp(assign.get("duedate")),
            status=state,
            submitted_at=timestamp(submission.get("timemodified")) if state != AssignmentStatus.NEW else None,
            grade=grade,
            url=f"{self.client.base_url}/mod/assign/view.php?id={assign['cmid']}",
            attachments=tuple(attachment(file) for file in assign.get("introattachments") or []),
        )

    async def _quizzes(self, course_ids: list[str], names: dict[str, str]) -> list[Assignment]:
        payload = await self.client.call("mod_quiz_get_quizzes_by_courses", courseids=course_ids)
        quizzes = payload["quizzes"]
        results = await self._each(quizzes, self._quiz_result)
        return [
            Assignment(
                source=self.kind,
                id=f"quiz:{quiz['id']}",
                course_id=str(quiz["course"]),
                course_name=names.get(str(quiz["course"]), ""),
                title=quiz["name"],
                kind=AssignmentKind.QUIZ,
                description_html=quiz.get("intro") or "",
                opens_at=timestamp(quiz.get("timeopen")),
                due_at=timestamp(quiz.get("timeclose")),
                status=status,
                submitted_at=submitted_at,
                grade=grade,
                url=f"{self.client.base_url}/mod/quiz/view.php?id={quiz['coursemodule']}",
            )
            for quiz, (status, submitted_at, grade) in zip(quizzes, results, strict=True)
        ]

    async def _quiz_result(
        self, quiz: dict[str, Any]
    ) -> tuple[AssignmentStatus, datetime | None, str | None]:
        attempts, best = await asyncio.gather(
            self.client.call("mod_quiz_get_user_attempts", quizid=quiz["id"], status="all"),
            self.client.call("mod_quiz_get_user_best_grade", quizid=quiz["id"]),
        )
        finished = [attempt for attempt in attempts["attempts"] if attempt.get("state") == "finished"]
        grade = None
        if best.get("hasgrade") and best.get("grade") is not None:
            grade = f"{best['grade']:g} / {quiz.get('grade', 0):g}"
        if grade:
            status = AssignmentStatus.GRADED
        elif finished:
            status = AssignmentStatus.SUBMITTED
        elif attempts["attempts"]:
            status = AssignmentStatus.DRAFT
        else:
            status = AssignmentStatus.NEW
        submitted_at = timestamp(max(attempt["timefinish"] for attempt in finished)) if finished else None
        return status, submitted_at, grade

    def _course_grades(self, course: dict[str, Any], items: list[dict[str, Any]]) -> list[Grade]:
        grades = []
        for item in items:
            value = (item.get("gradeformatted") or "").strip()
            if value in EMPTY_GRADES or item["itemtype"] == "category":
                continue
            is_total = item["itemtype"] == "course"
            grades.append(
                Grade(
                    source=self.kind,
                    course_id=str(course["id"]),
                    course_name=course["fullname"],
                    kind=GradeKind.FINAL if is_total else GradeKind.POINTS,
                    name="Course total" if is_total else item.get("itemname") or "",
                    value=value,
                    max_value=f"{item['grademax']:g}" if item.get("grademax") is not None else None,
                    comment=item.get("feedback") or None,
                    graded_at=timestamp(item.get("gradedategraded")),
                )
            )
        return grades
