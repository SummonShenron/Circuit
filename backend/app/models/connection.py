from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class Connection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    owner_id: str
    provider: Literal["google_calendar", "github"]
    display_name: str
    account_email: str | None = None
    scopes: list[str]
    expires_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ConnectionDocument(Connection):
    access_token_encrypted: str
    refresh_token_encrypted: str | None = None


class GoogleAuthorizationStart(BaseModel):
    authorization_url: str


class GitHubConnectionCreate(BaseModel):
    token: str = Field(min_length=1, max_length=500)
    display_name: str = Field(default="GitHub", min_length=1, max_length=80)