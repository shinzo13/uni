from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from uni.api.routes import auth, data, files, sources
from uni.config import Settings, settings
from uni.crypto import SecretBox
from uni.db import Database
from uni.registry import SourceRegistry


def create_app(config: Settings | None = None) -> FastAPI:
    config = config or settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(config.database_url)
        async with httpx.AsyncClient(timeout=60) as http:
            app.state.settings = config
            app.state.database = database
            app.state.registry = SourceRegistry(config, SecretBox(config.secret_key), database.sessions, http)
            yield
        await database.dispose()

    app = FastAPI(title="uni", lifespan=lifespan)
    for router in (auth.router, sources.router, data.router, files.router):
        app.include_router(router)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
