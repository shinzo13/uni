FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY src ./src
RUN uv sync --locked

EXPOSE 8000
CMD ["sh", "-c", "uv run --no-sync alembic upgrade head && uv run --no-sync uvicorn uni.api.app:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers"]
