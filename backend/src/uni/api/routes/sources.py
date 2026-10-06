from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse

from uni.api.deps import Config, CurrentUser, LinkerDep
from uni.api.schemas import LinkStartOut, MoodleRedirect, SourceStatus, TeamsPoll
from uni.domain import SourceKind
from uni.linking import LinkNotFound
from uni.sources.base import SourceError

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("")
async def list_sources(user: CurrentUser, linker: LinkerDep) -> list[SourceStatus]:
    links = {link.kind: link for link in await linker.links(user)}
    return [
        SourceStatus(kind=kind, linked=True, expired=links[kind].expired, linked_at=links[kind].linked_at)
        if kind in links
        else SourceStatus(kind=kind, linked=False)
        for kind in SourceKind
    ]


@router.post("/{kind}/link")
async def start_link(kind: SourceKind, user: CurrentUser, linker: LinkerDep) -> LinkStartOut:
    try:
        start = await linker.start(user, kind)
    except SourceError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{kind} is unavailable") from error
    return LinkStartOut(kind=start.kind, url=start.url, user_code=start.user_code)


@router.get("/usos/callback", include_in_schema=False)
async def usos_callback(oauth_token: str, oauth_verifier: str, linker: LinkerDep, settings: Config):
    try:
        await linker.finish_usos(oauth_token, oauth_verifier)
    except (LinkNotFound, SourceError):
        return HTMLResponse("USOS linking failed. Start again from the app.", status.HTTP_400_BAD_REQUEST)
    return RedirectResponse(f"{settings.app_scheme}://sources/usos", status.HTTP_302_FOUND)


@router.post("/moodle/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_moodle(body: MoodleRedirect, user: CurrentUser, linker: LinkerDep) -> None:
    try:
        await linker.finish_moodle(user, body.redirect)
    except LinkNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no pending moodle link") from error
    except (SourceError, ValueError) as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid moodle redirect") from error


@router.post("/teams/complete")
async def complete_teams(user: CurrentUser, linker: LinkerDep) -> TeamsPoll:
    try:
        link = await linker.poll_teams(user)
    except LinkNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no pending teams link") from error
    except SourceError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "teams login failed") from error
    return TeamsPoll(linked=link is not None)


@router.delete("/{kind}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink(kind: SourceKind, user: CurrentUser, linker: LinkerDep) -> None:
    await linker.unlink(user, kind)
