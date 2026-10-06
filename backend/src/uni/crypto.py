import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet


class SecretBox:
    def __init__(self, secret_key: str):
        digest = hashlib.sha256(secret_key.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def seal(self, value: dict[str, Any]) -> str:
        return self._fernet.encrypt(json.dumps(value).encode()).decode()

    def open(self, sealed: str) -> dict[str, Any]:
        return json.loads(self._fernet.decrypt(sealed.encode()))
