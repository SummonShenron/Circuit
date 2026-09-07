from datetime import datetime, timezone

from app.database import Database
from app.models.secret import Secret, SecretDocument


class SecretRepository:
    def __init__(self, database: Database) -> None:
        self._collection = database.database.secrets

    async def list(self, owner_id: str) -> list[Secret]:
        documents = await self._collection.find({"owner_id": owner_id}, {"_id": 0, "value_encrypted": 0}).sort("name", 1).to_list(None)
        return [Secret.model_validate(document) for document in documents]

    async def get(self, owner_id: str, name: str) -> SecretDocument | None:
        document = await self._collection.find_one({"owner_id": owner_id, "name": name}, {"_id": 0})
        return SecretDocument.model_validate(document) if document else None

    async def upsert(self, secret: SecretDocument) -> Secret:
        await self._collection.update_one(
            {"owner_id": secret.owner_id, "name": secret.name},
            {"$set": secret.model_dump(mode="json")},
            upsert=True,
        )
        return Secret(name=secret.name, description=secret.description, created_at=secret.created_at, updated_at=secret.updated_at)

    async def delete(self, owner_id: str, name: str) -> bool:
        return (await self._collection.delete_one({"owner_id": owner_id, "name": name})).deleted_count == 1
