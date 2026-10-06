import pytest
from httpx import ASGITransport, AsyncClient

from uni.api.app import create_app
from uni.config import Settings
from uni.models import Base


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path}/test.db",
        secret_key="test-secret",
        public_url="https://uni.test",
        usos_consumer_key="key",
        usos_consumer_secret="secret",
        moodle_base_url="https://moodle.test/sci",
    )


@pytest.fixture
async def app(settings):
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with app.state.database.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield app


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://uni.test") as client:
        yield client


@pytest.fixture
async def signed_in(client):
    response = await client.post(
        "/auth/register", json={"email": "student@amu.edu.pl", "password": "long-password"}
    )
    client.headers["Authorization"] = f"Bearer {response.json()['token']}"
    return client
