from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..database import Database
from ..models.workflow import RunWorkflowResponse


class WorkflowRunRepository:
    def __init__(self, database: Database) -> None:
        self._collection = database.database.workflow_runs

    async def record(
        self,
        workflow_id: str,
        owner_id: str,
        result: RunWorkflowResponse,
        started_at: datetime,
        trigger: str,
    ) -> dict[str, Any]:
        completed_at = datetime.now(timezone.utc)
        document = {
            "id": f"run_{uuid4().hex}",
            "workflow_id": workflow_id,
            "owner_id": owner_id,
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": max(0, int((completed_at - started_at).total_seconds() * 1000)),
            "status": "failed" if result.context.errors or any(event.status == "failed" for event in result.trace) else "completed",
            "trigger": trigger,
            "context": result.context.model_dump(mode="json"),
            "trace": [event.model_dump(mode="json") for event in result.trace],
        }
        await self._collection.insert_one(document)
        return {key: value for key, value in document.items() if key != "_id"}

    async def list_for_workflow(self, workflow_id: str, owner_id: str, limit: int = 50) -> list[dict[str, Any]]:
        documents = await self._collection.find(
            {"workflow_id": workflow_id, "owner_id": owner_id}, {"_id": 0}
        ).sort("started_at", -1).limit(limit).to_list(limit)
        return documents
