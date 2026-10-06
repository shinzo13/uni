from fastapi import APIRouter, HTTPException, Request, status

from uni.accounts import EmailTaken, InvalidCredentials
from uni.api.deps import AccountsDep, CurrentUser
from uni.api.schemas import Credentials, Me, SessionToken

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: Credentials, accounts: AccountsDep) -> SessionToken:
    try:
        user = await accounts.register(body.email, body.password)
    except EmailTaken as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered") from error
    return SessionToken(token=await accounts.open_session(user))


@router.post("/login")
async def login(body: Credentials, accounts: AccountsDep) -> SessionToken:
    try:
        user = await accounts.authenticate(body.email, body.password)
    except InvalidCredentials as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong email or password") from error
    return SessionToken(token=await accounts.open_session(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, user: CurrentUser, accounts: AccountsDep) -> None:
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    await accounts.close_session(token)


@router.get("/me")
async def me(user: CurrentUser) -> Me:
    return Me(email=user.email)
