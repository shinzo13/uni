import base64
import hashlib
import hmac
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import quote


@dataclass(frozen=True)
class Consumer:
    key: str
    secret: str


@dataclass(frozen=True)
class Token:
    key: str
    secret: str


def _escape(value: str) -> str:
    return quote(value, safe="~")


def signed_params(
    method: str,
    url: str,
    params: Mapping[str, str],
    consumer: Consumer,
    token: Token | None = None,
    nonce: str | None = None,
    timestamp: int | None = None,
) -> dict[str, str]:
    oauth = {
        "oauth_consumer_key": consumer.key,
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(timestamp if timestamp is not None else int(time.time())),
        "oauth_version": "1.0",
    }
    if token:
        oauth["oauth_token"] = token.key
    signed = {**params, **oauth}
    normalized = "&".join(f"{_escape(k)}={_escape(v)}" for k, v in sorted(signed.items()))
    base = "&".join([method.upper(), _escape(url), _escape(normalized)])
    key = f"{_escape(consumer.secret)}&{_escape(token.secret if token else '')}"
    digest = hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()
    return {**signed, "oauth_signature": base64.b64encode(digest).decode()}
