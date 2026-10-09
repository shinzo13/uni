MOODLE = {"source": "moodle", "course_id": "101"}
TEAMS = {"source": "teams", "course_id": "team-1"}
USOS = {"source": "usos", "course_id": "06-MAN1"}


async def test_subject_is_created_with_alias_color_and_icon(signed_in):
    created = await signed_in.post(
        "/subjects",
        json={"name": "  Matan 2 ", "color": "#1565a8", "icon": "function-variant", "courses": [MOODLE]},
    )

    assert created.status_code == 201
    assert created.json() | {"id": None} == {
        "id": None,
        "name": "Matan 2",
        "color": "#1565A8",
        "icon": "function-variant",
        "courses": [MOODLE],
    }
    assert (await signed_in.get("/subjects")).json() == [created.json()]


async def test_merging_moves_courses_and_drops_emptied_subjects(signed_in):
    first = (await signed_in.post("/subjects", json={"name": "Algebra", "courses": [MOODLE]})).json()
    second = (await signed_in.post("/subjects", json={"color": "#000000", "courses": [TEAMS]})).json()

    merged = await signed_in.put(
        f"/subjects/{first['id']}", json={"name": "Algebra", "courses": [MOODLE, TEAMS, USOS]}
    )
    subjects = (await signed_in.get("/subjects")).json()

    assert merged.status_code == 200
    assert [subject["id"] for subject in subjects] == [first["id"]]
    assert subjects[0]["courses"] == [MOODLE, TEAMS, USOS]
    assert (await signed_in.delete(f"/subjects/{second['id']}")).status_code == 404


async def test_removed_course_becomes_ungrouped(signed_in):
    subject = (await signed_in.post("/subjects", json={"courses": [MOODLE, TEAMS]})).json()

    await signed_in.put(f"/subjects/{subject['id']}", json={"courses": [MOODLE]})
    recreated = await signed_in.post("/subjects", json={"courses": [TEAMS]})

    assert recreated.status_code == 201
    assert len((await signed_in.get("/subjects")).json()) == 2


async def test_delete_ungroups(signed_in):
    subject = (await signed_in.post("/subjects", json={"courses": [MOODLE, TEAMS]})).json()

    deleted = await signed_in.delete(f"/subjects/{subject['id']}")

    assert deleted.status_code == 204
    assert (await signed_in.get("/subjects")).json() == []


async def test_invalid_input_is_rejected(signed_in):
    no_courses = await signed_in.post("/subjects", json={"courses": []})
    bad_color = await signed_in.post("/subjects", json={"color": "red", "courses": [MOODLE]})
    bad_icon = await signed_in.post("/subjects", json={"icon": "Not An Icon", "courses": [MOODLE]})

    assert [no_courses.status_code, bad_color.status_code, bad_icon.status_code] == [422, 422, 422]


async def test_subjects_are_private(signed_in, client):
    subject = (await signed_in.post("/subjects", json={"courses": [MOODLE]})).json()
    other = await client.post(
        "/auth/register", json={"email": "other@example.com", "password": "long-password"}
    )
    client.headers["Authorization"] = f"Bearer {other.json()['token']}"

    assert (await client.get("/subjects")).json() == []
    assert (await client.delete(f"/subjects/{subject['id']}")).status_code == 404
