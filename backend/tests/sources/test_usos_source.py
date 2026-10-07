import json
from datetime import date, datetime
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx

from uni.domain import GradeCategory
from uni.sources.base import SourceError
from uni.sources.usos.client import UsosClient
from uni.sources.usos.oauth import Consumer, Token
from uni.sources.usos.source import UsosSource

BASE = "https://usos.test"
WARSAW = ZoneInfo("Europe/Warsaw")


def form(request: httpx.Request) -> dict[str, str]:
    return dict(parse_qsl(request.content.decode()))


@pytest.fixture
def source():
    return UsosSource(UsosClient(BASE, Consumer("key", "secret"), Token("token", "token-secret")))


def route(path: str, handler):
    return respx.post(f"{BASE}/services/{path}").mock(side_effect=handler)


@respx.mock
async def test_classes_are_fetched_week_by_week(source):
    starts = []

    def timetable(request):
        params = form(request)
        starts.append((params["start"], params["days"]))
        return httpx.Response(
            200,
            json=[
                {
                    "start_time": f"{params['start']} 08:15:00",
                    "end_time": f"{params['start']} 09:45:00",
                    "course_id": "C1",
                    "course_name": {"pl": "Analiza", "en": "Analysis"},
                    "classtype_id": "WYK",
                    "classtype_name": {"pl": "Wykład", "en": "Lecture"},
                    "building_id": "090",
                    "building_name": {"pl": "Collegium", "en": ""},
                    "room_number": "A",
                    "group_number": 1,
                }
            ],
        )

    route("tt/student", timetable)
    route(
        "geo/building2",
        lambda request: httpx.Response(
            200, json={"id": "090", "postal_address": "Uniwersytetu Poznańskiego 4"}
        ),
    )
    classes = await source.classes(date(2026, 10, 1), date(2026, 10, 16))

    assert starts == [("2026-10-01", "7"), ("2026-10-08", "7"), ("2026-10-15", "2")]
    assert len(classes) == 3
    assert classes[0].starts_at == datetime(2026, 10, 1, 8, 15, tzinfo=WARSAW)
    assert classes[0].kind == "Wykład"
    assert classes[0].kind_code == "WYK"
    assert classes[0].address == "Uniwersytetu Poznańskiego 4"


@respx.mock
async def test_exams_map_each_group(source):
    route(
        "exams/student_exams",
        lambda request: httpx.Response(
            200,
            json=[
                {
                    "id": "1",
                    "name": {"pl": "Egzamin", "en": ""},
                    "course": {"id": "C1", "name": {"pl": "Analiza", "en": "Analysis"}},
                    "groups": [
                        {
                            "exam_start": "2027-02-05 10:00:00",
                            "exam_end": "2027-02-05 12:00:00",
                            "room": {"number": "A", "building_name": {"pl": "Collegium", "en": ""}},
                        },
                        {"exam_start": None, "exam_end": None, "room": None},
                    ],
                }
            ],
        ),
    )

    exams = await source.exams()

    assert [exam.id for exam in exams] == ["1:0"]
    assert exams[0].room == "A"
    assert form(respx.calls[0].request)["fields"].startswith("id|name|course")


@respx.mock
async def test_test_results_walk_the_node_tree(source):
    edition = {"course_id": "C1", "course_name": {"pl": "Analiza", "en": ""}, "term_id": "2026/SZ"}
    route(
        "crstests/participant",
        lambda request: httpx.Response(
            200,
            json={
                "tests": {
                    "2026/SZ": {
                        "10": {"node_id": 10, "name": {"pl": "Kolokwia", "en": ""}, "course_edition": edition}
                    }
                },
            },
        ),
    )
    route(
        "crstests/node",
        lambda request: httpx.Response(
            200,
            json={
                "node_id": 10,
                "name": {"pl": "Kolokwia", "en": ""},
                "type": "root",
                "subnodes": [
                    {
                        "node_id": 11,
                        "name": {"pl": "Zadanie 1", "en": ""},
                        "type": "pkt",
                        "points_max": 5.0,
                        "subnodes": [],
                    },
                    {"node_id": 12, "name": {"pl": "Ocena", "en": ""}, "type": "oc", "subnodes": []},
                ],
            },
        ),
    )
    route(
        "crstests/user_points",
        lambda request: httpx.Response(
            200,
            json=[
                {"node_id": 11, "points": 3.0, "comment": None, "last_changed": "2026-11-20 10:00:00"},
            ],
        ),
    )
    route(
        "crstests/user_grades",
        lambda request: httpx.Response(
            200,
            json=[
                {
                    "node_id": 12,
                    "grade": {"symbol": "4", "passes": True},
                    "public_comment": "ok",
                    "last_changed": "2026-11-21 10:00:00",
                },
            ],
        ),
    )

    results = await source._test_results()

    assert [(r.category, r.name, r.value, r.max_value) for r in results] == [
        (GradeCategory.WORK, "Kolokwia / Zadanie 1", "3.0", "5.0"),
        (GradeCategory.WORK, "Kolokwia / Ocena", "4", None),
    ]
    assert results[1].comment == "ok"
    requested = {call.request.url.path: form(call.request) for call in respx.calls}
    assert requested["/services/crstests/user_points"]["node_ids"] == "11"


@respx.mock
async def test_errors_raise_source_error(source):
    route(
        "exams/student_exams",
        lambda request: httpx.Response(403, content=json.dumps({"error": "method_forbidden"})),
    )

    with pytest.raises(SourceError):
        await source.exams()
