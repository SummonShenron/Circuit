from datetime import datetime, timezone
import re
from pydantic import BaseModel, Field

SECRET_NAME_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{2,63}$")


class SecretCreate(BaseModel):
    name: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z][a-zA-Z0-9_]{2,63}$")
    value: str = Field(min_length=1, max_length=10_000)
    description: str = Field(default="", max_length=200)


class Secret(BaseModel):
    name: str
    description: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SecretDocument(Secret):
    owner_id: str
    value_encrypted: str
