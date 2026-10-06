import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uni.models import Session, User

hasher = PasswordHasher()


class EmailTaken(Exception):
    pass


class InvalidCredentials(Exception):
    pass


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Accounts:
    def __init__(self, db: AsyncSession, session_days: int):
        self.db = db
        self.session_lifetime = timedelta(days=session_days)

    async def register(self, email: str, password: str) -> User:
        user = User(email=email.lower(), password_hash=hasher.hash(password))
        self.db.add(user)
        try:
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise EmailTaken from error
        return user

    async def authenticate(self, email: str, password: str) -> User:
        user = await self.db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            hasher.hash(password)
            raise InvalidCredentials
        try:
            hasher.verify(user.password_hash, password)
        except (VerifyMismatchError, InvalidHashError) as error:
            raise InvalidCredentials from error
        return user

    async def open_session(self, user: User) -> str:
        token = secrets.token_urlsafe(32)
        self.db.add(
            Session(
                token_hash=hash_token(token),
                user_id=user.id,
                expires_at=datetime.now(UTC) + self.session_lifetime,
            )
        )
        await self.db.commit()
        return token

    async def user_for_token(self, token: str) -> User | None:
        session = await self.db.get(Session, hash_token(token))
        if session is None or _aware(session.expires_at) <= datetime.now(UTC):
            return None
        return await self.db.get(User, session.user_id)

    async def close_session(self, token: str) -> None:
        await self.db.execute(delete(Session).where(Session.token_hash == hash_token(token)))
        await self.db.commit()


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)
