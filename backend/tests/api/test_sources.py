import base64
import hashlib
from urllib.parse import parse_qs, urlparse

BASE = "https://moodle.test/sci"


def redirect_for(passport: str, token: str) -> str:
    signature = hashlib.md5((BASE + passport).encode()).hexdigest()
    return "uni://token=" + base64.b64encode(f"{signature}:::{token}:::private".encode()).decode()


async def test_all_sources_start_unlinked(signed_in):
    response = await signed_in.get("/sources")
    assert [(item["kind"], item["linked"]) for item in response.json()] == [
        ("usos", False),
        ("moodle", False),
        ("teams", False),
    ]


async def test_moodle_link_flow(signed_in, app):
    start = await signed_in.post("/sources/moodle/link")
    passport = parse_qs(urlparse(start.json()["url"]).query)["passport"][0]

    forged = await signed_in.post("/sources/moodle/complete", json={"redirect": redirect_for("forged", "t")})
    completed = await signed_in.post(
        "/sources/moodle/complete", json={"redirect": redirect_for(passport, "t")}
    )
    sources = {item["kind"]: item for item in (await signed_in.get("/sources")).json()}
    again = await signed_in.post("/sources/moodle/complete", json={"redirect": redirect_for(passport, "t")})

    assert parse_qs(urlparse(start.json()["url"]).query)["urlscheme"] == ["uni"]
    assert forged.status_code == 400
    assert completed.status_code == 204
    assert sources["moodle"]["linked"] is True
    assert again.status_code == 404


async def test_unlink(signed_in):
    start = await signed_in.post("/sources/moodle/link")
    passport = parse_qs(urlparse(start.json()["url"]).query)["passport"][0]
    await signed_in.post("/sources/moodle/complete", json={"redirect": redirect_for(passport, "t")})

    await signed_in.delete("/sources/moodle")

    sources = {item["kind"]: item for item in (await signed_in.get("/sources")).json()}
    assert sources["moodle"]["linked"] is False
