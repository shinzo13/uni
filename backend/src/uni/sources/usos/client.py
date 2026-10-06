from typing import Any
from urllib.parse import parse_qsl, urlencode

import httpx

from uni.sources.base import CredentialsExpired, SourceError
from uni.sources.usos.oauth import Consumer, Token, signed_params

SCOPES = ("studies", "grades", "crstests", "email", "personal", "events", "offline_access")


class UsosClient:
    def __init__(
        self,
        base_url: str,
        consumer: Consumer,
        token: Token | None = None,
        http: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/") + "/services/"
        self.consumer = consumer
        self.token = token
        self.http = http or httpx.AsyncClient(timeout=30)

    async def call(self, method: str, **params: Any) -> Any:
        url = self.base_url + method
        data = signed_params("POST", url, _stringify(params), self.consumer, self.token)
        response = await self.http.post(url, data=data)
        if response.status_code == 401:
            raise CredentialsExpired(response.text)
        body = response.json()
        if response.status_code >= 400 or (isinstance(body, dict) and "error" in body):
            raise SourceError(f"usos {method}: {body}")
        return body

    async def request_token(self, callback: str) -> Token:
        payload = await self._token_request(
            "oauth/request_token", {"oauth_callback": callback, "scopes": "|".join(SCOPES)}
        )
        return Token(payload["oauth_token"], payload["oauth_token_secret"])

    def authorize_url(self, request_token: Token) -> str:
        return self.base_url + "oauth/authorize?" + urlencode({"oauth_token": request_token.key})

    async def access_token(self, request_token: Token, verifier: str) -> Token:
        self.token = request_token
        payload = await self._token_request("oauth/access_token", {"oauth_verifier": verifier})
        self.token = Token(payload["oauth_token"], payload["oauth_token_secret"])
        return self.token

    async def _token_request(self, method: str, params: dict[str, str]) -> dict[str, str]:
        url = self.base_url + method
        response = await self.http.post(
            url, data=signed_params("POST", url, params, self.consumer, self.token)
        )
        if response.status_code >= 400:
            raise SourceError(f"usos {method}: {response.text}")
        return dict(parse_qsl(response.text))


def _stringify(params: dict[str, Any]) -> dict[str, str]:
    result = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            result[key] = "true" if value else "false"
        elif isinstance(value, list | tuple | set):
            result[key] = "|".join(str(item) for item in value)
        else:
            result[key] = str(value)
    return result
