import base64
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select

from uni.api.deps import CurrentUser, Db, Registry
from uni.domain import SourceKind
from uni.models import SourceLink
from uni.sources.teams.client import GRAPH_URL, TeamsClient

router = APIRouter(tags=["files"])

PASSED_HEADERS = ("content-type", "content-disposition", "content-length")
SHAREPOINT_SUFFIX = ".sharepoint.com"


@router.get("/files")
async def file(kind: SourceKind, url: str, user: CurrentUser, db: Db, registry: Registry) -> Response:
    link = await db.scalar(select(SourceLink).where(SourceLink.user_id == user.id, SourceLink.kind == kind))
    if link is None or link.expired:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{kind} is not linked")
    credentials = registry.box.open(link.credentials)
    match kind:
        case SourceKind.MOODLE:
            if (
                not url.startswith(registry.settings.moodle_base_url.rstrip("/") + "/")
                or "pluginfile.php" not in url
            ):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a moodle file")
            upstream = await registry.http.get(
                registry.moodle_client(credentials["token"]).file_url(url), follow_redirects=True
            )
        case SourceKind.TEAMS:
            if not (urlparse(url).hostname or "").endswith(SHAREPOINT_SUFFIX):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a teams file")
            share = "u!" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
            client = TeamsClient(credentials["refresh_token"], http=registry.http)
            upstream = await client.download(f"{GRAPH_URL}/shares/{share}/driveItem/content")
        case _:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{kind} has no files")
    if upstream.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "file is unavailable")
    headers = {name: upstream.headers[name] for name in PASSED_HEADERS if name in upstream.headers}
    return Response(upstream.content, headers=headers)
