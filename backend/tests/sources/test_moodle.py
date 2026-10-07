import base64
import hashlib
from urllib.parse import parse_qsl

import httpx
import pytest
import respx

from uni.domain import AssignmentKind, AssignmentStatus, GradeCategory, ItemKind
from uni.sources.base import CredentialsExpired, SourceError
from uni.sources.moodle.client import MoodleClient, flatten, launch_url, token_from_launch
from uni.sources.moodle.source import MoodleSource

BASE = "https://moodle.test/sci"
ENDPOINT = f"{BASE}/webservice/rest/server.php"


def launch_redirect(passport: str, token: str, base: str = BASE) -> str:
    signature = hashlib.md5((base + passport).encode()).hexdigest()
    payload = base64.b64encode(f"{signature}:::{token}:::private".encode()).decode()
    return f"uni://token={payload}"


def test_flatten_uses_moodle_array_syntax():
    assert flatten({"courseids": ["1", "2"], "options": [{"name": "x", "value": True}]}) == {
        "courseids[0]": "1",
        "courseids[1]": "2",
        "options[0][name]": "x",
        "options[0][value]": "1",
    }


def test_launch_url_requests_mobile_service():
    url = launch_url(BASE, "abc", "uni")
    assert url.startswith(f"{BASE}/admin/tool/mobile/launch.php?")
    assert "service=moodle_mobile_app" in url and "urlscheme=uni" in url


def test_token_from_launch_checks_passport():
    assert token_from_launch(BASE, "abc", launch_redirect("abc", "secret-token")) == "secret-token"
    with pytest.raises(SourceError):
        token_from_launch(BASE, "other", launch_redirect("abc", "secret-token"))


class FakeMoodle:
    def __init__(self, responses: dict):
        self.responses = responses

    def __call__(self, request: httpx.Request) -> httpx.Response:
        params = dict(parse_qsl(request.content.decode()))
        response = self.responses[params["wsfunction"]]
        return httpx.Response(200, json=response(params) if callable(response) else response)


@pytest.fixture
def source():
    return MoodleSource(MoodleClient(BASE, "token"))


def serve(responses: dict):
    respx.post(ENDPOINT).mock(side_effect=FakeMoodle(responses))


BASE_RESPONSES = {
    "core_webservice_get_site_info": {"userid": 7},
    "core_enrol_get_users_courses": [{"id": 10, "fullname": "Systemy operacyjne"}],
}


@respx.mock
async def test_assignments_combine_assigns_and_quizzes(source):
    serve(
        {
            **BASE_RESPONSES,
            "mod_assign_get_assignments": {
                "courses": [
                    {
                        "id": 10,
                        "assignments": [
                            {
                                "id": 1,
                                "cmid": 100,
                                "name": "Shell",
                                "duedate": 1790000000,
                                "intro": "<p>x</p>",
                            },
                            {"id": 2, "cmid": 101, "name": "Report", "duedate": 0},
                        ],
                    }
                ]
            },
            "mod_assign_get_submission_status": lambda params: {
                "1": {"lastattempt": {"submission": {"status": "submitted", "timemodified": 1789000000}}},
                "2": {
                    "lastattempt": {"submission": {"status": "new"}},
                    "feedback": {"gradefordisplay": "5,00 / 5,00"},
                },
            }[params["assignid"]],
            "mod_quiz_get_quizzes_by_courses": {
                "quizzes": [{"id": 3, "course": 10, "coursemodule": 102, "name": "Quiz", "grade": 10}]
            },
            "mod_quiz_get_user_attempts": {"attempts": [{"state": "finished", "timefinish": 1789500000}]},
            "mod_quiz_get_user_best_grade": {"hasgrade": True, "grade": 7.5},
        }
    )

    assignments = {item.id: item for item in await source.assignments()}

    assert assignments["assign:1"].status == AssignmentStatus.SUBMITTED
    assert assignments["assign:1"].due_at is not None
    assert assignments["assign:2"].status == AssignmentStatus.GRADED
    assert assignments["assign:2"].due_at is None
    assert assignments["quiz:3"].kind == AssignmentKind.QUIZ
    assert assignments["quiz:3"].grade == "7.5 / 10"
    assert assignments["quiz:3"].url == f"{BASE}/mod/quiz/view.php?id=102"


@respx.mock
async def test_grades_skip_categories_and_hidden_reports(source):
    serve(
        {
            "core_webservice_get_site_info": {"userid": 7},
            "core_enrol_get_users_courses": [
                {"id": 10, "fullname": "Algebra"},
                {"id": 11, "fullname": "Hidden"},
            ],
            "gradereport_user_get_grade_items": lambda params: {
                "10": {
                    "usergrades": [
                        {
                            "gradeitems": [
                                {"itemtype": "course", "gradeformatted": "59,33 (4,5)", "grademax": 70},
                                {"itemtype": "category", "gradeformatted": "10,00", "grademax": 10},
                                {
                                    "itemtype": "mod",
                                    "itemmodule": "assign",
                                    "itemname": "Lab 1",
                                    "gradeformatted": "10,00",
                                    "grademax": 10,
                                },
                                {
                                    "itemtype": "mod",
                                    "itemname": "Lab 2",
                                    "gradeformatted": "-",
                                    "grademax": 10,
                                },
                            ]
                        }
                    ]
                },
                "11": {"exception": "moodle_exception", "errorcode": "nopermissiontoviewgrades"},
            }[params["courseid"]],
        }
    )

    grades = await source.grades()

    assert [(grade.category, grade.name, grade.value, grade.max_value) for grade in grades] == [
        (GradeCategory.SEMESTER, "Course total", "59,33 (4,5)", "70"),
        (GradeCategory.ASSIGNMENT, "Lab 1", "10,00", "10"),
    ]


@respx.mock
async def test_sections_attach_page_html(source):
    serve(
        {
            "core_course_get_contents": [
                {
                    "id": 1,
                    "name": "Week 1",
                    "summary": "",
                    "modules": [
                        {"id": 50, "name": "Intro", "modname": "page", "url": "u"},
                        {
                            "id": 51,
                            "name": "Slides",
                            "modname": "resource",
                            "contents": [{"type": "file", "filename": "a.pdf", "fileurl": "f"}],
                        },
                        {"id": 52, "name": "Hidden", "modname": "page", "uservisible": False},
                    ],
                }
            ],
            "mod_page_get_pages_by_courses": {"pages": [{"coursemodule": 50, "content": "<p>hello</p>"}]},
        }
    )

    [section] = await source.sections("10")

    assert [(item.kind, item.html) for item in section.items] == [
        (ItemKind.PAGE, "<p>hello</p>"),
        (ItemKind.FILE, ""),
    ]
    assert section.items[1].attachments[0].name == "a.pdf"


@respx.mock
async def test_invalid_token_means_expired_credentials(source):
    serve({"core_webservice_get_site_info": {"exception": "moodle_exception", "errorcode": "invalidtoken"}})

    with pytest.raises(CredentialsExpired):
        await source.courses()
