from datetime import datetime, timezone

from ..database import Database
from ..models.connection import Connection, ConnectionDocument


class ConnectionRepository:
    def __init__(self, database: Database) -> None:
        self._database = database
        self._collection = database.database.connections

    async def create(self, connection: ConnectionDocument) -> Connection:
        await self._collection.insert_one(connection.model_dump(mode="json"))
        return Connection.model_validate(connection.model_dump())

    async def list(self, owner_id: str) -> list[Connection]:
        documents = await self._collection.find({"owner_id": owner_id}, {"_id": 0, "access_token_encrypted": 0, "refresh_token_encrypted": 0}).to_list(None)
        return [Connection.model_validate(document) for document in documents]

    async def delete(self, connection_id: str, owner_id: str) -> bool:
        return (await self._collection.delete_one({"id": connection_id, "owner_id": owner_id})).deleted_count == 1

    async def get_document(self, connection_id: str, owner_id: str) -> ConnectionDocument | None:
        document = await self._collection.find_one({"id": connection_id, "owner_id": owner_id}, {"_id": 0})
        return ConnectionDocument.model_validate(document) if document else None

    async def update_tokens(self, connection: ConnectionDocument) -> None:
        await self._collection.update_one({"id": connection.id, "owner_id": connection.owner_id}, {"$set": {"access_token_encrypted": connection.access_token_encrypted, "refresh_token_encrypted": connection.refresh_token_encrypted, "expires_at": connection.expires_at, "updated_at": datetime.now(timezone.utc)}})

    async def create_pending(self, state: str, owner_id: str, code_verifier: str, return_to: str | None = None) -> None:
        await self._collection.database.oauth_pending.update_one({"state": state}, {"$set": {"state": state, "owner_id": owner_id, "code_verifier": code_verifier, "return_to": return_to, "expires_at": datetime.now(timezone.utc)}}, upsert=True)

    async def has_pending(self, state: str, owner_id: str) -> bool:
        return await self._collection.database.oauth_pending.count_documents({"state": state, "owner_id": owner_id}, limit=1) == 1

    async def get_pending_verifier(self, state: str, owner_id: str) -> str | None:
        document = await self._collection.database.oauth_pending.find_one({"state": state, "owner_id": owner_id}, {"_id": 0, "code_verifier": 1})
        return document.get("code_verifier") if document else None

    async def get_pending_owner(self, state: str) -> str | None:
        document = await self._collection.database.oauth_pending.find_one({"state": state}, {"_id": 0, "owner_id": 1})
        return document.get("owner_id") if document else None

    async def get_pending_return_to(self, state: str, owner_id: str) -> str | None:
        document = await self._collection.database.oauth_pending.find_one({"state": state, "owner_id": owner_id}, {"_id": 0, "return_to": 1})
        return document.get("return_to") if document else None

    async def consume_pending(self, state: str, owner_id: str) -> bool:
        return (await self._collection.database.oauth_pending.delete_one({"state": state, "owner_id": owner_id})).deleted_count == 1