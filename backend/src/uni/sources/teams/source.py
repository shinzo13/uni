import asyncio
import re
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from uni.domain import (
    Assignment,
    AssignmentStatus,
    Attachment,
    Course,
    CourseItem,
    CourseSection,
    Grade,
    ItemKind,
    Post,
    SourceKind,
    assessed_category,
)
from uni.sources.base import SourceError
from uni.sources.teams.client import TeamsClient

PARALLEL_CALLS = 6
MESSAGES_PER_CHANNEL = 50
TERM_PREFIX = re.compile(r"^(\d{4}/(?:SZ|SL))\s+")
SUBMISSION_STATUSES = {
    "working": AssignmentStatus.NEW,
    "submitted": AssignmentStatus.SUBMITTED,
    "returned": AssignmentStatus.GRADED,
    "reassigned": AssignmentStatus.NEW,
}


def parse_time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def term_of(team_name: str) -> str | None:
    match = TERM_PREFIX.match(team_name)
    return match.group(1) if match else None


class TeamsSource:
    kind = SourceKind.TEAMS

    def __init__(self, client: TeamsClient):
        self.client = client
        self._limit = asyncio.Semaphore(PARALLEL_CALLS)

    async def courses(self) -> list[Course]:
        return [
            Course(
                source=self.kind, id=team["id"], name=team["displayName"], term=term_of(team["displayName"])
            )
            for team in await self._teams()
        ]

    async def assignments(self) -> list[Assignment]:
        return [assignment for assignment, _ in await self._assignments_with_outcomes()]

    async def grades(self) -> list[Grade]:
        return [grade for _, grade in await self._assignments_with_outcomes() if grade]

    async def posts(self) -> list[Post]:
        teams = await self._teams()
        channels = await self._each(
            teams, lambda team: self.client.graph_pages(f"/teams/{team['id']}/channels")
        )
        targets = [
            (team, channel)
            for team, team_channels in zip(teams, channels, strict=True)
            for channel in team_channels
        ]
        messages = await self._each(
            targets,
            lambda target: self.client.graph(
                f"/teams/{target[0]['id']}/channels/{target[1]['id']}/messages",
                **{"$top": MESSAGES_PER_CHANNEL, "$expand": "replies"},
            ),
        )
        return [
            self._post(team, message)
            for (team, _), payload in zip(targets, messages, strict=True)
            for message in payload.get("value", [])
            if _is_user_message(message)
        ]

    async def sections(self, course_id: str) -> list[CourseSection]:
        channels = await self.client.graph_pages(f"/teams/{course_id}/channels")
        listings = await self._each(channels, lambda channel: self._channel_files(course_id, channel["id"]))
        return [
            CourseSection(id=channel["id"], title=channel["displayName"], items=tuple(items))
            for channel, items in zip(channels, listings, strict=True)
            if items
        ]

    async def _channel_files(self, team_id: str, channel_id: str) -> list[CourseItem]:
        try:
            folder = await self.client.graph(f"/teams/{team_id}/channels/{channel_id}/filesFolder")
        except SourceError:
            return []
        drive = folder["parentReference"]["driveId"]
        children = await self.client.graph_pages(f"/drives/{drive}/items/{folder['id']}/children")
        folders = [child for child in children if "folder" in child]
        contents = await self._each(
            folders, lambda child: self.client.graph_pages(f"/drives/{drive}/items/{child['id']}/children")
        )
        nested = {child["id"]: files for child, files in zip(folders, contents, strict=True)}
        return [
            CourseItem(
                id=child["id"],
                kind=ItemKind.FOLDER if "folder" in child else ItemKind.FILE,
                title=child["name"],
                url=child.get("webUrl"),
                attachments=tuple(
                    _drive_attachment(file) for file in nested.get(child["id"], [child]) if "file" in file
                ),
                modified_at=parse_time(child.get("lastModifiedDateTime")),
            )
            for child in sorted(
                children, key=lambda child: child.get("lastModifiedDateTime") or "", reverse=True
            )
        ]

    async def _teams(self) -> list[dict[str, Any]]:
        return await self.client.graph_pages("/me/joinedTeams")

    async def _each(self, items: list[Any], fetch: Callable[[Any], Awaitable[Any]]) -> list[Any]:
        async def limited(item: Any) -> Any:
            async with self._limit:
                return await fetch(item)

        return await asyncio.gather(*(limited(item) for item in items))

    async def _assignments_with_outcomes(self) -> list[tuple[Assignment, Grade | None]]:
        teams = {team["id"]: team["displayName"] for team in await self._teams()}
        classes = (await self.client.assignments("/me/classes"))["value"]
        per_class = await self._each(
            classes, lambda edu_class: self.client.assignments(f"/classes/{edu_class['id']}/assignments")
        )
        items = [
            (edu_class["id"], assignment)
            for edu_class, payload in zip(classes, per_class, strict=True)
            for assignment in payload.get("value", [])
        ]
        details = await self._each(items, lambda item: self._submission(*item))
        return [
            self._assignment(class_id, teams.get(class_id, ""), assignment, submission, outcomes)
            for (class_id, assignment), (submission, outcomes) in zip(items, details, strict=True)
        ]

    async def _submission(
        self, class_id: str, assignment: dict[str, Any]
    ) -> tuple[dict[str, Any], list[Any]]:
        path = f"/classes/{class_id}/assignments/{assignment['id']}/submissions"
        submissions = (await self.client.assignments(path)).get("value", [])
        if not submissions:
            return {}, []
        submission = submissions[0]
        if submission.get("status") != "returned":
            return submission, []
        outcomes = await self.client.assignments(f"{path}/{submission['id']}/outcomes")
        return submission, outcomes.get("value", [])

    def _assignment(
        self,
        class_id: str,
        class_name: str,
        assignment: dict[str, Any],
        submission: dict[str, Any],
        outcomes: list[dict[str, Any]],
    ) -> tuple[Assignment, Grade | None]:
        points = _points(outcomes, assignment.get("grading"))
        status = SUBMISSION_STATUSES.get(submission.get("status", ""), AssignmentStatus.UNKNOWN)
        item = Assignment(
            source=self.kind,
            id=assignment["id"],
            course_id=class_id,
            course_name=class_name,
            title=assignment["displayName"],
            description_html=(assignment.get("instructions") or {}).get("content") or "",
            opens_at=parse_time(assignment.get("assignedDateTime")),
            due_at=parse_time(assignment.get("dueDateTime")),
            status=status,
            submitted_at=parse_time(submission.get("submittedDateTime")),
            grade=points,
            url=assignment.get("webUrl"),
        )
        grade = None
        if points:
            grade = Grade(
                source=self.kind,
                course_id=class_id,
                course_name=class_name,
                category=assessed_category(assignment["displayName"]),
                name=assignment["displayName"],
                value=points.split(" / ")[0],
                term=term_of(class_name),
                max_value=points.split(" / ")[1] if " / " in points else None,
                graded_at=parse_time(submission.get("returnedDateTime")),
            )
        return item, grade

    def _post(self, team: dict[str, Any], message: dict[str, Any]) -> Post:
        return Post(
            source=self.kind,
            id=message["id"],
            course_id=team["id"],
            course_name=team["displayName"],
            author=_author(message),
            title=message.get("subject") or None,
            body_html=(message.get("body") or {}).get("content") or "",
            posted_at=parse_time(message["createdDateTime"]),
            replies=tuple(
                self._post(team, reply) for reply in message.get("replies") or [] if _is_user_message(reply)
            ),
            attachments=tuple(
                Attachment(name=attachment.get("name") or "file", url=attachment["contentUrl"])
                for attachment in message.get("attachments") or []
                if attachment.get("contentUrl")
            ),
        )


def _is_user_message(message: dict[str, Any]) -> bool:
    return message.get("messageType") == "message" and not message.get("deletedDateTime")


def _author(message: dict[str, Any]) -> str | None:
    sender = message.get("from") or {}
    return (sender.get("user") or sender.get("application") or {}).get("displayName")


def _points(outcomes: list[dict[str, Any]], grading: dict[str, Any] | None) -> str | None:
    for outcome in outcomes:
        points = (outcome.get("points") or outcome.get("publishedPoints") or {}).get("points")
        if points is not None:
            maximum = (grading or {}).get("maxPoints")
            return f"{round(points, 2):g} / {maximum:g}" if maximum is not None else f"{round(points, 2):g}"
    return None


def _drive_attachment(file: dict[str, Any]) -> Attachment:
    return Attachment(
        name=file["name"],
        url=file["webUrl"],
        mime_type=(file.get("file") or {}).get("mimeType"),
        size=file.get("size"),
    )
