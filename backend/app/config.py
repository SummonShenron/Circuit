from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Workflow Builder API"
    api_prefix: str = "/api"
    log_level: str = "INFO"
    mongo_uri: str | None = None
    mongo_database: str = "workflow_builder"
    google_api_key: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str | None = None  # Will be set dynamically
    resend_api_key: str | None = None
    token_encryption_key: str | None = None
    dev_user_id: str = "local-dev-user"
    clerk_issuer: str | None = None
    clerk_secret_key: str | None = None
    vite_clerk_publishable_key: str | None = None
    clerk_clock_skew_seconds: int = 90
    adzuna_app_id: str | None = None
    adzuna_app_key: str | None = None
    adzuna_api_key: str | None = None
    jooble_api_key: str | None = None
    joobq_api_key: str | None = None
    erragent_api_url: str = "https://erragent.onrender.com/api/v1/circuit/architect"
    erragent_api_key: str | None = None
    mongo_workflow_uri: str | None = None
    api_allowed_hosts: list[str] = []
    cors_origins: list[str] = ["http://127.0.0.1:8090", "https://circuitworkflow.com", "https://www.circuitworkflow.com"]
    backend_url: str | None = None  # Cloud backend URL

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
    )

    def get_google_redirect_uri(self) -> str:
        """Get Google redirect URI based on environment."""
        if self.google_redirect_uri:
            return self.google_redirect_uri
        # Default to local if not specified
        return "http://127.0.0.1:8010/api/connections/google/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()