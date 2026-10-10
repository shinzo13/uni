import base64
import re
import uuid
from html import unescape
from urllib.parse import urlparse

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import select

from uni.api.deps import CurrentUser, Db, Registry
from uni.domain import SourceKind
from uni.models import SourceLink, User
from uni.registry import SourceRegistry
from uni.sources.teams.client import GRAPH_URL, TeamsClient

router = APIRouter(prefix="/files", tags=["files"])

PASSED_HEADERS = ("content-type", "content-disposition", "content-length")
SHAREPOINT_SUFFIX = ".sharepoint.com"
LINK_LIFETIME_SECONDS = 300
UNAVAILABLE_PAGE = (
    '<!doctype html><meta name="viewport" content="width=device-width">'
    '<body style="font-family:sans-serif;padding:24px">'
    "<h2>File unavailable</h2><p>It was removed or you no longer have access to it in the source.</p>"
)


class FileRequest(BaseModel):
    kind: SourceKind
    url: str


class FileLink(BaseModel):
    url: str


@router.post("/link")
async def link(body: FileRequest, user: CurrentUser, registry: Registry) -> FileLink:
    check_url(registry, body.kind, body.url)
    return FileLink(url=signed_url(registry, user, body.kind, body.url))


def signed_url(registry: SourceRegistry, user: User, kind: SourceKind, url: str) -> str:
    sealed = registry.seal({"user_id": str(user.id), "kind": kind, "url": url})
    return f"{registry.settings.public_url}/files/{sealed}"


def sign_moodle_files(registry: SourceRegistry, user: User, html: str) -> str:
    base = re.escape(registry.settings.moodle_base_url.rstrip("/"))
    pattern = re.compile(rf'(?P<attr>src|href)="(?P<url>{base}/[^"]*pluginfile\.php[^"]*)"')
    return pattern.sub(
        lambda match: (
            f'{match["attr"]}="{signed_url(registry, user, SourceKind.MOODLE, unescape(match["url"]))}"'
        ),
        html,
    )


@router.get("/{sealed}")
async def download(sealed: str, db: Db, registry: Registry) -> Response:
    try:
        request = registry.box.open(sealed, max_age=LINK_LIFETIME_SECONDS)
    except InvalidToken as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "link expired") from error
    kind = SourceKind(request["kind"])
    link = await db.scalar(
        select(SourceLink).where(SourceLink.user_id == uuid.UUID(request["user_id"]), SourceLink.kind == kind)
    )
    if link is None or link.expired:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{kind} is not linked")
    credentials = registry.box.open(link.credentials)
    url = request["url"]
    if kind == SourceKind.MOODLE:
        upstream = await registry.http.get(
            registry.moodle_client(credentials["token"]).file_url(url), follow_redirects=True
        )
    else:
        share = "u!" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
        client = TeamsClient(credentials["refresh_token"], http=registry.http)
        upstream = await client.download(f"{GRAPH_URL}/shares/{share}/driveItem/content")
    if upstream.status_code >= 400:
        return HTMLResponse(UNAVAILABLE_PAGE, status.HTTP_404_NOT_FOUND)
    headers = {name: upstream.headers[name] for name in PASSED_HEADERS if name in upstream.headers}
    return Response(upstream.content, headers=headers)


def check_url(registry: SourceRegistry, kind: SourceKind, url: str) -> None:
    match kind:
        case SourceKind.MOODLE:
            moodle = registry.settings.moodle_base_url.rstrip("/") + "/"
            if url.startswith(moodle) and "pluginfile.php" in url:
                return
        case SourceKind.TEAMS:
            if (urlparse(url).hostname or "").endswith(SHAREPOINT_SUFFIX):
                return
    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"not a {kind} file")
