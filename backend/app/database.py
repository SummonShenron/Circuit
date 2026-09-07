import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from ..config import Settings

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: AsyncIOMotorClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self._settings.mongo_uri)

    async def connect(self) -> None:
        if not self._settings.mongo_uri:
            logger.warning("MongoDB connection skipped because MONGO_URI is not configured")
            return
        logger.info("connecting to MongoDB database=%s", self._settings.mongo_database)
        self._client = AsyncIOMotorClient(self._settings.mongo_uri)
        await self._client.admin.command("ping")
        logger.info("MongoDB connection established database=%s", self._settings.mongo_database)

    async def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None
            logger.info("MongoDB connection closed")

    @property
    def database(self) -> AsyncIOMotorDatabase:
        if not self._client:
            raise RuntimeError("MongoDB is not configured")
        return self._client[self._settings.mongo_database]