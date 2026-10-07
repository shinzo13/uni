import uuid

import httpx
import respx
from sqlalchemy import select

from uni.domain import SourceKind
from uni.models import SourceLink, User

FILE = "https://moodle.test/sci/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf"


async def link_moodle(app):
    async with app.state.database.sessions() as session:
        user = await session.scalar(select(User))
        session.add(
            SourceLink(
                id=uuid.uuid4(),
                user_id=user.id,
                kind=SourceKind.MOODLE,
                credentials=app.state.registry.seal({"token": "moodle-token"}),
            )
        )
        await session.commit()


async def test_signed_link_downloads_without_session(signed_in, app):
    await link_moodle(app)
    upstream = respx.mock(assert_all_called=True)
    upstream.get(FILE, params={"token": "moodle-token"}).mock(
        return_value=httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"})
    )

    link = await signed_in.post("/files/link", json={"kind": "moodle", "url": FILE})
    path = link.json()["url"].removeprefix("https://uni.test")
    del signed_in.headers["Authorization"]
    with upstream:
        response = await signed_in.get(path)

    assert response.content == b"%PDF"
    assert response.headers["content-type"] == "application/pdf"


async def test_foreign_urls_are_rejected(signed_in):
    response = await signed_in.post("/files/link", json={"kind": "moodle", "url": "https://evil.test/a.pdf"})
    assert response.status_code == 400


async def test_tampered_link_is_not_found(signed_in):
    response = await signed_in.get("/files/not-a-valid-token")
    assert response.status_code == 404
