import logging
import os
import secrets
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from ..config import Settings
from ..models.connection import ConnectionDocument
from ..repositories.connections import ConnectionRepository

logger = logging.getLogger(__name__)
GOOGLE_WORKSPACE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.send",
]

class GoogleCalendarOAuth:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _flow(self, state: str | None = None, code_verifier: str | None = None) -> Flow:
        if not self._settings.google_client_id or not self._settings.google_client_secret:
            raise ValueError("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
        return Flow.from_client_config({"web": {"client_id": self._settings.google_client_id, "client_secret": self._settings.google_client_secret, "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token"}}, scopes=GOOGLE_WORKSPACE_SCOPES, redirect_uri=self._settings.google_redirect_uri, state=state, code_verifier=code_verifier, autogenerate_code_verifier=code_verifier is None)

    def authorization_url(self) -> tuple[str, str, str]:
        state = secrets.token_urlsafe(32)
        flow = self._flow(state)
        url, _ = flow.authorization_url(access_type="offline", prompt="consent", include_granted_scopes="false")
        if not flow.code_verifier:
            raise ValueError("Google OAuth did not generate a PKCE verifier.")
        return url, state, flow.code_verifier

    def build_connection(self, authorization_response: str, state: str, owner_id: str, code_verifier: str) -> ConnectionDocument:
        if urlparse(self._settings.google_redirect_uri).hostname in {"127.0.0.1", "localhost"}:
            os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
        # Google can return only the scopes granted during this consent round.
        # oauthlib raises that scope difference as Warning before exposing credentials.
        os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
        flow = self._flow(state, code_verifier)
        flow.fetch_token(authorization_response=authorization_response)
        credentials = flow.credentials
        granted_scopes = list(credentials.scopes or [])
        if not granted_scopes:
            raise ValueError("Google did not grant any Workspace scopes. Reconnect and approve the requested permissions.")
        fernet = self._fernet()
        return ConnectionDocument(owner_id=owner_id, provider="google_calendar", display_name="Google Workspace", scopes=granted_scopes, expires_at=credentials.expiry, access_token_encrypted=fernet.encrypt(credentials.token.encode()).decode(), refresh_token_encrypted=fernet.encrypt(credentials.refresh_token.encode()).decode() if credentials.refresh_token else None)

    async def access_token(self, connections: ConnectionRepository, connection_id: str, owner_id: str, force_refresh: bool = False) -> str:
        connection = await connections.get_document(connection_id, owner_id)
        if not connection:
            raise ValueError("Selected Google connection was not found")
        fernet = self._fernet()
        credentials = Credentials(token=fernet.decrypt(connection.access_token_encrypted.encode()).decode(), refresh_token=fernet.decrypt(connection.refresh_token_encrypted.encode()).decode() if connection.refresh_token_encrypted else None, token_uri="https://oauth2.googleapis.com/token", client_id=self._settings.google_client_id, client_secret=self._settings.google_client_secret, scopes=connection.scopes)
        if force_refresh or credentials.expired:
            if not credentials.refresh_token:
                raise ValueError("Google connection expired. Reconnect the account.")
            credentials.refresh(Request())
            connection.access_token_encrypted = fernet.encrypt(credentials.token.encode()).decode()
            connection.expires_at = credentials.expiry
            await connections.update_tokens(connection)
        return credentials.token

    async def revoke(self, connection: ConnectionDocument) -> None:
        fernet = self._fernet()
        token = fernet.decrypt(connection.access_token_encrypted.encode()).decode()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post("https://oauth2.googleapis.com/revoke", params={"token": token})
        if response.status_code not in {200, 400}:
            raise ValueError(f"Google token revocation failed (HTTP {response.status_code})")

    def _fernet(self) -> Fernet:
        if not self._settings.token_encryption_key:
            raise ValueError("Token storage is not configured. Set TOKEN_ENCRYPTION_KEY.")
        try:
            return Fernet(self._settings.token_encryption_key.encode())
        except (ValueError, TypeError) as error:
            raise ValueError("TOKEN_ENCRYPTION_KEY must be a valid Fernet key.") from error