from cryptography.fernet import Fernet

from ..config import Settings
from ..models.secret import SecretCreate, SecretDocument
from ..repositories.secrets import SecretRepository


class SecretService:
    def __init__(self, settings: Settings) -> None:
        if not settings.token_encryption_key:
            raise ValueError("Token storage is not configured. Set TOKEN_ENCRYPTION_KEY.")
        try:
            self._fernet = Fernet(settings.token_encryption_key.encode())
        except (ValueError, TypeError) as error:
            raise ValueError("TOKEN_ENCRYPTION_KEY must be a valid Fernet key.") from error

    async def save(self, repository: SecretRepository, owner_id: str, payload: SecretCreate):
        now = SecretDocument.model_fields["updated_at"].default_factory()
        return await repository.upsert(SecretDocument(owner_id=owner_id, name=payload.name, description=payload.description, created_at=now, updated_at=now, value_encrypted=self._fernet.encrypt(payload.value.encode()).decode()))

    def decrypt(self, secret: SecretDocument) -> str:
        return self._fernet.decrypt(secret.value_encrypted.encode()).decode()
