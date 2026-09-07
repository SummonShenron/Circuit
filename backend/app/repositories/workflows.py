from datetime import datetime, timezone
import logging

from app.database import Database
from app.models.workflow import Workflow, WorkflowCreate, WorkflowUpdate

logger = logging.getLogger(__name__)


class WorkflowRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    @property
    def _collection(self):
        return self._database.database.workflows

    async def list(self, owner_id: str) -> list[Workflow]:
        documents = await self._collection.find({"owner_id": owner_id}, {"_id": 0}).sort("updated_at", -1).to_list(None)
        logger.info("listed workflows count=%s", len(documents))
        return [Workflow.model_validate(document) for document in documents]

    async def list_scheduled(self) -> list[Workflow]:
        documents = await self._collection.find({"graph.nodes.type": "schedule"}, {"_id": 0}).to_list(None)
        return [Workflow.model_validate(document) for document in documents]

    async def get(self, workflow_id: str, owner_id: str) -> Workflow | None:
        document = await self._collection.find_one({"id": workflow_id, "owner_id": owner_id}, {"_id": 0})
        logger.debug("fetched workflow workflow_id=%s found=%s", workflow_id, document is not None)
        return Workflow.model_validate(document) if document else None

    async def get_by_event(self, workflow_id: str, event_name: str) -> Workflow | None:
        document = await self._collection.find_one({"id": workflow_id, "graph.nodes": {"$elemMatch": {"type": "schedule", "config.trigger_mode": "event", "config.event_name": event_name}}}, {"_id": 0})
        return Workflow.model_validate(document) if document else None

    async def create(self, payload: WorkflowCreate, owner_id: str) -> Workflow:
        workflow = Workflow(**payload.model_dump(), owner_id=owner_id)
        await self._collection.insert_one(workflow.model_dump(mode="json"))
        logger.info("created workflow workflow_id=%s", workflow.id)
        return workflow

    async def update(self, workflow: Workflow, payload: WorkflowUpdate) -> Workflow:
        changes = payload.model_dump(exclude_unset=True)
        updated = Workflow.model_validate(
            {**workflow.model_dump(), **changes, "updated_at": datetime.now(timezone.utc)}
        )
        await self._collection.replace_one(
            {"id": workflow.id}, updated.model_dump(mode="json"), upsert=False
        )
        logger.info("updated workflow workflow_id=%s", workflow.id)
        return updated

    async def delete(self, workflow_id: str, owner_id: str) -> bool:
        result = await self._collection.delete_one({"id": workflow_id, "owner_id": owner_id})
        logger.info("deleted workflow workflow_id=%s deleted=%s", workflow_id, result.deleted_count == 1)
        return result.deleted_count == 1