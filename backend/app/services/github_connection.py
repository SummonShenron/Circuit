import logging

import httpx
from cryptography.fernet import Fernet

from ..config import Settings
from ..models.connection import ConnectionDocument
from ..repositories.connections import ConnectionRepository

logger = logging.getLogger(__name__)


class GitHubConnectionService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def create(self, token: str, display_name: str, owner_id: str) -> ConnectionDocument:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get("https://api.github.com/user", headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
        if response.status_code != 200:
            raise ValueError("GitHub token was rejected. Check its permissions and try again.")
        login = response.json().get("login")
        if not login:
            raise ValueError("GitHub did not return an account identity.")
        return ConnectionDocument(owner_id=owner_id, provider="github", display_name=display_name, account_email=login, scopes=[], access_token_encrypted=self._fernet().encrypt(token.encode()).decode())

    async def access_token(self, connections: ConnectionRepository, connection_id: str, owner_id: str) -> str:
        connection = await connections.get_document(connection_id, owner_id)
        if not connection or connection.provider != "github":
            raise ValueError("Selected GitHub connection was not found")
        return self._fernet().decrypt(connection.access_token_encrypted.encode()).decode()

    def _fernet(self) -> Fernet:
        if not self._settings.token_encryption_key:
            raise ValueError("Token storage is not configured. Set TOKEN_ENCRYPTION_KEY.")
        return Fernet(self._settings.token_encryption_key.encode())