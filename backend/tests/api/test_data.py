import uuid

import pytest
from sqlalchemy import select

from uni.domain import Assignment, CourseItem, CourseSection, ItemKind, SourceKind
from uni.models import Snapshot, SourceLink, User
from uni.sources.base import CredentialsExpired, SourceError


class FakeSource:
    def __init__(self, kind: SourceKind, outcome):
        self.kind = kind
        self.outcome = outcome
        self.calls = 0

    async def assignments(self) -> list[Assignment]:
        self.calls += 1
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def assignment(kind: SourceKind, title: str) -> Assignment:
    return Assignment(source=kind, id=title, course_id="c", course_name="Course", title=title)


@pytest.fixture
async def linked(app, signed_in):
    async with app.state.database.sessions() as session:
        user = await session.scalar(select(User))
        for kind in (SourceKind.MOODLE, SourceKind.TEAMS):
            session.add(
                SourceLink(
                    id=uuid.uuid4(), user_id=user.id, kind=kind, credentials=app.state.registry.seal({})
                )
            )
        await session.commit()
    sources: dict[str, FakeSource] = {}
    app.state.registry.build = lambda link: sources[link.kind]
    return sources


async def test_results_are_cached_until_refresh(signed_in, linked):
    linked["moodle"] = FakeSource(SourceKind.MOODLE, [assignment(SourceKind.MOODLE, "Lab")])
    linked["teams"] = FakeSource(SourceKind.TEAMS, [assignment(SourceKind.TEAMS, "Essay")])

    first = await signed_in.get("/assignments")
    second = await signed_in.get("/assignments")
    refreshed = await signed_in.get("/assignments", params={"refresh": True})

    assert sorted(item["title"] for item in first.json()["items"]) == ["Essay", "Lab"]
    assert second.json()["items"] == first.json()["items"]
    assert linked["moodle"].calls == 2
    assert refreshed.status_code == 200


async def test_failing_source_keeps_last_snapshot(signed_in, linked):
    linked["moodle"] = FakeSource(SourceKind.MOODLE, [assignment(SourceKind.MOODLE, "Lab")])
    linked["teams"] = FakeSource(SourceKind.TEAMS, [])
    await signed_in.get("/assignments")
    linked["moodle"].outcome = SourceError("down")

    response = await signed_in.get("/assignments", params={"refresh": True})

    states = {state["kind"]: state for state in response.json()["sources"]}
    assert [item["title"] for item in response.json()["items"]] == ["Lab"]
    assert states["moodle"]["error"] == "source unavailable"
    assert states["moodle"]["fetched_at"] is not None


async def test_expired_credentials_mark_the_link(signed_in, linked, app):
    linked["moodle"] = FakeSource(SourceKind.MOODLE, CredentialsExpired("token"))
    linked["teams"] = FakeSource(SourceKind.TEAMS, [])

    response = await signed_in.get("/assignments")
    sources = {item["kind"]: item for item in (await signed_in.get("/sources")).json()}

    assert {state["kind"]: state["error"] for state in response.json()["sources"]}[
        "moodle"
    ] == "credentials expired"
    assert sources["moodle"]["expired"] is True


async def test_stale_snapshot_is_served_and_revalidated(signed_in, linked, app):
    app.state.settings.cache_minutes = 0
    linked["moodle"] = FakeSource(SourceKind.MOODLE, [assignment(SourceKind.MOODLE, "Old")])
    linked["teams"] = FakeSource(SourceKind.TEAMS, [])
    await signed_in.get("/assignments")
    linked["moodle"].outcome = [assignment(SourceKind.MOODLE, "New")]

    stale = await signed_in.get("/assignments")
    await app.state.revalidator.wait()
    revalidated = await signed_in.get("/assignments")

    assert [item["title"] for item in stale.json()["items"]] == ["Old"]
    assert [item["title"] for item in revalidated.json()["items"]] == ["New"]


async def test_snapshot_with_outdated_schema_is_refetched(signed_in, linked, app):
    linked["moodle"] = FakeSource(SourceKind.MOODLE, [assignment(SourceKind.MOODLE, "Lab")])
    linked["teams"] = FakeSource(SourceKind.TEAMS, [])
    await signed_in.get("/assignments")
    async with app.state.database.sessions() as session:
        for snapshot in await session.scalars(select(Snapshot)):
            snapshot.payload = [{"unexpected": True}]
        await session.commit()

    response = await signed_in.get("/assignments")

    assert [item["title"] for item in response.json()["items"]] == ["Lab"]
    assert linked["moodle"].calls == 2


class FakeMoodle:
    kind = SourceKind.MOODLE

    def __init__(self):
        self.changes: list[tuple[str, bool]] = []

    async def sections(self, course_id: str) -> list[CourseSection]:
        return [
            CourseSection(
                id="s", title="Week", items=(CourseItem(id="7", kind=ItemKind.FILE, title="Slides"),)
            )
        ]

    async def set_completion(self, item_id: str, completed: bool) -> None:
        self.changes.append((item_id, completed))


async def test_completion_is_sent_to_moodle_and_patched_into_the_snapshot(signed_in, linked):
    linked["moodle"] = FakeMoodle()
    await signed_in.get("/courses/moodle/10/sections")

    response = await signed_in.post("/courses/moodle/10/items/7/completion", json={"completed": True})
    sections = (await signed_in.get("/courses/moodle/10/sections")).json()["items"]

    assert response.status_code == 204
    assert linked["moodle"].changes == [("7", True)]
    assert sections[0]["items"][0]["completion"] == "complete"


class FakeMoodlePage:
    kind = SourceKind.MOODLE

    async def sections(self, course_id: str) -> list[CourseSection]:
        html = (
            '<p><img src="https://moodle.test/sci/webservice/pluginfile.php/1/mod_page/content/2/a.png">'
            '<a href="https://example.com/x">x</a></p>'
        )
        return [
            CourseSection(
                id="s",
                title="Week",
                items=(CourseItem(id="9", kind=ItemKind.PAGE, title="Intro", html=html),),
            )
        ]


async def test_page_html_gets_signed_moodle_file_links(signed_in, linked):
    linked["moodle"] = FakeMoodlePage()

    response = await signed_in.get("/courses/moodle/10/items/9/html")
    missing = await signed_in.get("/courses/moodle/10/items/404/html")

    html = response.json()["html"]
    assert 'src="https://uni.test/files/' in html
    assert 'href="https://example.com/x"' in html
    assert missing.status_code == 404
