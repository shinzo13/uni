import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx

from uni.sources.base import CredentialsExpired, SourceError

MOBILE_SERVICE = "moodle_mobile_app"
EXPIRED_TOKEN_CODES = {"invalidtoken", "accessexception_token_expired"}


class MoodleClient:
    def __init__(self, base_url: str, token: str, http: httpx.AsyncClient | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.http = http or httpx.AsyncClient(timeout=60)

    async def call(self, function: str, **params: Any) -> Any:
        data = {"wstoken": self.token, "wsfunction": function, "moodlewsrestformat": "json"}
        data.update(flatten(params))
        response = await self.http.post(f"{self.base_url}/webservice/rest/server.php", data=data)
        if response.status_code >= 400:
            raise SourceError(f"moodle {function}: http {response.status_code}")
        body = response.json()
        if isinstance(body, dict) and body.get("exception"):
            if body.get("errorcode") in EXPIRED_TOKEN_CODES:
                raise CredentialsExpired(body.get("message", ""))
            raise SourceError(f"moodle {function}: {body.get('errorcode')} {body.get('message')}")
        return body

    def file_url(self, url: str) -> str:
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}token={self.token}"


def flatten(params: dict[str, Any], prefix: str = "") -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in params.items():
        name = f"{prefix}[{key}]" if prefix else str(key)
        if isinstance(value, dict):
            result.update(flatten(value, name))
        elif isinstance(value, list | tuple):
            result.update(flatten(dict(enumerate(value)), name))
        elif isinstance(value, bool):
            result[name] = "1" if value else "0"
        elif value is not None:
            result[name] = str(value)
    return result


def new_passport() -> str:
    return secrets.token_hex(16)


def launch_url(base_url: str, passport: str, url_scheme: str) -> str:
    query = urlencode({"service": MOBILE_SERVICE, "passport": passport, "urlscheme": url_scheme})
    return f"{base_url.rstrip('/')}/admin/tool/mobile/launch.php?{query}"


def token_from_launch(base_url: str, passport: str, redirect: str) -> str:
    encoded = redirect.split("token=", 1)[-1].strip()
    decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    signature, token, *_ = decoded.split(":::")
    expected = hashlib.md5((base_url.rstrip("/") + passport).encode()).hexdigest()
    if signature != expected:
        raise SourceError("moodle launch signature does not match the passport")
    return token
