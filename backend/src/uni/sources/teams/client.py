import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from uni.sources.base import CredentialsExpired, SourceError

TEAMS_CLIENT_ID = "1fec8e78-bce4-4aaf-ab1b-5451cc387264"
AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0"
GRAPH_SCOPE = "https://graph.microsoft.com/.default offline_access"
ASSIGNMENTS_SCOPE = "https://onenote.com/.default offline_access"
GRAPH_URL = "https://graph.microsoft.com/v1.0"
ASSIGNMENTS_URL = "https://assignments.onenote.com/api/v1.0/edu"
EXPIRY_MARGIN = 120
DEAD_GRANT_ERRORS = {"invalid_grant", "interaction_required"}


@dataclass(frozen=True)
class DeviceLogin:
    device_code: str
    user_code: str
    verification_uri: str
    interval: int
    expires_at: float


class LoginPending(Exception):
    pass


async def start_device_login(http: httpx.AsyncClient) -> DeviceLogin:
    response = await http.post(
        f"{AUTHORITY}/devicecode", data={"client_id": TEAMS_CLIENT_ID, "scope": GRAPH_SCOPE}
    )
    payload = response.json()
    if "device_code" not in payload:
        raise SourceError(f"teams device code: {payload.get('error_description', payload)}")
    return DeviceLogin(
        device_code=payload["device_code"],
        user_code=payload["user_code"],
        verification_uri=payload["verification_uri"],
        interval=payload.get("interval", 5),
        expires_at=time.time() + payload.get("expires_in", 900),
    )


async def finish_device_login(http: httpx.AsyncClient, device_code: str) -> str:
    response = await http.post(
        f"{AUTHORITY}/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": TEAMS_CLIENT_ID,
            "device_code": device_code,
        },
    )
    payload = response.json()
    if "refresh_token" in payload:
        return payload["refresh_token"]
    if payload.get("error") in {"authorization_pending", "slow_down"}:
        raise LoginPending
    raise SourceError(f"teams device login: {payload.get('error_description', payload)}")


class TeamsClient:
    def __init__(
        self,
        refresh_token: str,
        on_refresh_token: Callable[[str], Awaitable[None]] | None = None,
        http: httpx.AsyncClient | None = None,
    ):
        self.refresh_token = refresh_token
        self.on_refresh_token = on_refresh_token
        self.http = http or httpx.AsyncClient(timeout=30)
        self._access: dict[str, tuple[str, float]] = {}
        self._refreshing = asyncio.Lock()

    async def graph(self, path: str, **params: Any) -> Any:
        return await self._get(f"{GRAPH_URL}{path}", GRAPH_SCOPE, params)

    async def graph_pages(self, path: str, **params: Any) -> list[Any]:
        items: list[Any] = []
        url: str | None = f"{GRAPH_URL}{path}"
        while url:
            payload = await self._get(url, GRAPH_SCOPE, params if not items else {})
            items += payload.get("value", [])
            url = payload.get("@odata.nextLink")
        return items

    async def assignments(self, path: str, **params: Any) -> Any:
        return await self._get(f"{ASSIGNMENTS_URL}{path}", ASSIGNMENTS_SCOPE, params)

    async def download(self, url: str) -> httpx.Response:
        token = await self._access_token(GRAPH_SCOPE)
        return await self.http.get(url, headers={"Authorization": f"Bearer {token}"}, follow_redirects=True)

    async def _get(self, url: str, scope: str, params: dict[str, Any]) -> Any:
        token = await self._access_token(scope)
        response = await self.http.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 401:
            self._access.pop(scope, None)
            raise CredentialsExpired(f"teams {url}: 401")
        if response.status_code >= 400:
            raise SourceError(f"teams {url}: {response.status_code} {response.text[:200]}")
        return response.json()

    async def _access_token(self, scope: str) -> str:
        async with self._refreshing:
            cached = self._access.get(scope)
            if cached and cached[1] > time.time():
                return cached[0]
            return await self._refresh(scope)

    async def _refresh(self, scope: str) -> str:
        response = await self.http.post(
            f"{AUTHORITY}/token",
            data={
                "grant_type": "refresh_token",
                "client_id": TEAMS_CLIENT_ID,
                "refresh_token": self.refresh_token,
                "scope": scope,
            },
        )
        payload = response.json()
        if "access_token" not in payload:
            if payload.get("error") in DEAD_GRANT_ERRORS:
                raise CredentialsExpired(payload.get("error_description", ""))
            raise SourceError(f"teams token: {payload.get('error_description', payload)}")
        self._access[scope] = (
            payload["access_token"],
            time.time() + payload.get("expires_in", 3600) - EXPIRY_MARGIN,
        )
        rotated = payload.get("refresh_token")
        if rotated and rotated != self.refresh_token:
            self.refresh_token = rotated
            if self.on_refresh_token:
                await self.on_refresh_token(rotated)
        return payload["access_token"]
