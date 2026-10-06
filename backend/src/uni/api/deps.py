from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from uni.accounts import Accounts
from uni.aggregator import Aggregator
from uni.config import Settings
from uni.linking import Linker
from uni.models import User
from uni.registry import SourceRegistry

bearer = HTTPBearer(auto_error=False)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_registry(request: Request) -> SourceRegistry:
    return request.app.state.registry


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.database.sessions() as session:
        yield session


Db = Annotated[AsyncSession, Depends(get_db)]
Config = Annotated[Settings, Depends(get_settings)]
Registry = Annotated[SourceRegistry, Depends(get_registry)]


def get_accounts(db: Db, settings: Config) -> Accounts:
    return Accounts(db, settings.session_days)


AccountsDep = Annotated[Accounts, Depends(get_accounts)]


async def get_user(
    accounts: AccountsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    access_token: Annotated[str | None, Query(include_in_schema=False)] = None,
) -> User:
    token = credentials.credentials if credentials else access_token
    user = await accounts.user_for_token(token) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")
    return user


CurrentUser = Annotated[User, Depends(get_user)]


def get_linker(db: Db, registry: Registry) -> Linker:
    return Linker(db, registry)


def get_aggregator(db: Db, registry: Registry, user: CurrentUser, settings: Config) -> Aggregator:
    return Aggregator(db, registry, user, timedelta(minutes=settings.cache_minutes))


LinkerDep = Annotated[Linker, Depends(get_linker)]
AggregatorDep = Annotated[Aggregator, Depends(get_aggregator)]
