import httpx
import pytest
import respx

from uni.domain import AssignmentStatus, GradeCategory
from uni.sources.base import CredentialsExpired
from uni.sources.teams.client import ASSIGNMENTS_URL, AUTHORITY, GRAPH_URL, TeamsClient
from uni.sources.teams.source import TeamsSource, term_of

TEAM = "team-1"


def test_term_is_parsed_from_team_name():
    assert term_of("2026/SL 06-S3IN02-P04800 CW Algebra liniowa") == "2026/SL"
    assert term_of("Random team") is None


def token_endpoint(rotated: str = "rt-2"):
    return respx.post(f"{AUTHORITY}/token").mock(
        return_value=httpx.Response(
            200, json={"access_token": "at", "expires_in": 3600, "refresh_token": rotated}
        )
    )


@respx.mock
async def test_rotated_refresh_token_is_reported_once():
    saved = []

    async def save(token: str) -> None:
        saved.append(token)

    token_endpoint()
    respx.get(f"{GRAPH_URL}/me/joinedTeams").mock(return_value=httpx.Response(200, json={"value": []}))
    client = TeamsClient("rt-1", save)

    await client.graph("/me/joinedTeams")
    await client.graph("/me/joinedTeams")

    assert saved == ["rt-2"]
    assert client.refresh_token == "rt-2"


@respx.mock
async def test_dead_refresh_token_means_expired_credentials():
    respx.post(f"{AUTHORITY}/token").mock(
        return_value=httpx.Response(400, json={"error": "invalid_grant", "error_description": "expired"})
    )

    with pytest.raises(CredentialsExpired):
        await TeamsClient("rt-1").graph("/me")


@respx.mock
async def test_assignments_use_submission_status_and_outcomes():
    token_endpoint()
    respx.get(f"{GRAPH_URL}/me/joinedTeams").mock(
        return_value=httpx.Response(200, json={"value": [{"id": TEAM, "displayName": "2026/SL Algebra"}]})
    )
    respx.get(f"{ASSIGNMENTS_URL}/me/classes").mock(
        return_value=httpx.Response(200, json={"value": [{"id": TEAM}]})
    )
    respx.get(f"{ASSIGNMENTS_URL}/classes/{TEAM}/assignments").mock(
        return_value=httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "a1",
                        "displayName": "Lab",
                        "dueDateTime": "2026-05-13T21:59:00Z",
                        "grading": None,
                    },
                    {
                        "id": "a2",
                        "displayName": "Kolokwium",
                        "dueDateTime": None,
                        "grading": {"maxPoints": 60.0},
                        "instructions": {"content": "<p>go</p>"},
                    },
                ]
            },
        )
    )
    respx.get(f"{ASSIGNMENTS_URL}/classes/{TEAM}/assignments/a1/submissions").mock(
        return_value=httpx.Response(
            200,
            json={
                "value": [{"id": "s1", "status": "submitted", "submittedDateTime": "2026-05-18T23:12:06Z"}]
            },
        )
    )
    respx.get(f"{ASSIGNMENTS_URL}/classes/{TEAM}/assignments/a2/submissions").mock(
        return_value=httpx.Response(200, json={"value": [{"id": "s2", "status": "returned"}]})
    )
    respx.get(f"{ASSIGNMENTS_URL}/classes/{TEAM}/assignments/a2/submissions/s2/outcomes").mock(
        return_value=httpx.Response(200, json={"value": [{"feedback": None}, {"points": {"points": 54.0}}]})
    )
    source = TeamsSource(TeamsClient("rt-1"))

    assignments = {item.id: item for item in await source.assignments()}
    grades = await source.grades()

    assert assignments["a1"].status == AssignmentStatus.SUBMITTED
    assert assignments["a2"].status == AssignmentStatus.GRADED
    assert assignments["a2"].grade == "54 / 60"
    assert assignments["a2"].description_html == "<p>go</p>"
    assert [(grade.category, grade.value, grade.max_value, grade.term) for grade in grades] == [
        (GradeCategory.WORK, "54", "60", "2026/SL")
    ]


@respx.mock
async def test_posts_skip_system_messages():
    token_endpoint()
    respx.get(f"{GRAPH_URL}/me/joinedTeams").mock(
        return_value=httpx.Response(200, json={"value": [{"id": TEAM, "displayName": "Algebra"}]})
    )
    respx.get(f"{GRAPH_URL}/teams/{TEAM}/channels").mock(
        return_value=httpx.Response(200, json={"value": [{"id": "c1"}]})
    )
    respx.get(f"{GRAPH_URL}/teams/{TEAM}/channels/c1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "m0",
                        "messageType": "systemEventMessage",
                        "createdDateTime": "2026-10-01T10:00:00Z",
                    },
                    {
                        "id": "m1",
                        "messageType": "message",
                        "createdDateTime": "2026-10-01T10:00:00Z",
                        "from": {"user": {"displayName": "Teacher"}},
                        "body": {"content": "<p>hi</p>"},
                        "attachments": [
                            {"name": "a.pdf", "contentUrl": "https://sp/a.pdf"},
                            {"name": "card"},
                        ],
                        "replies": [
                            {
                                "id": "r1",
                                "messageType": "message",
                                "createdDateTime": "2026-10-01T11:00:00Z",
                                "from": {"user": {"displayName": "Student"}},
                                "body": {"content": "ok"},
                            }
                        ],
                    },
                ]
            },
        )
    )

    [post] = await TeamsSource(TeamsClient("rt-1")).posts()

    assert post.author == "Teacher"
    assert [attachment.name for attachment in post.attachments] == ["a.pdf"]
    assert [reply.author for reply in post.replies] == ["Student"]
