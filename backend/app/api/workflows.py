from typing import Annotated, Any
from datetime import datetime, timezone
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status, Header
from fastapi.responses import JSONResponse
from app.config import get_settings
from app.auth import get_current_user_id
from app.database import Database
from app.main_dependencies import get_database
from app.models.workflow import (
    CopilotMessageRequest,
    CopilotMessageResponse,
    RunWorkflowRequest,
    WorkflowConsoleRequest,
    RunWorkflowResponse,
    SuggestTemplateRequest,
    SuggestTemplateResponse,
    Workflow,
    WorkflowCreate,
    WorkflowUpdate,
    ApplyWorkflowPatchRequest,
    WorkflowRunRecord,
    NodeType,
    HttpResponseNodeConfig,
    validate_run_inputs,
)
from app.repositories.workflows import WorkflowRepository
from app.repositories.workflow_runs import WorkflowRunRepository
from app.repositories.connections import ConnectionRepository
from app.services.workflow_engine import run_workflow
from app.services.node_runners import run_github_repository
from app.services.suggestions import suggest_template
from app.services.workflow_copilot import create_workflow_copilot
from app.services.scheduler import resolve_scheduled_inputs_for_owner
from app.services.workflow_validation import validate_workflow_preflight
from app.services.secrets import SecretService
from app.repositories.secrets import SecretRepository
from langchain_core.messages import HumanMessage, AIMessage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])
DatabaseDependency = Annotated[Database, Depends(get_database)]
UserDependency = Annotated[str, Depends(get_current_user_id)]


def get_repository(database: DatabaseDependency) -> WorkflowRepository:
    if not database.configured:
        logger.warning("workflow persistence requested while MongoDB is unconfigured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is not configured. Set MONGO_URI to enable workflow persistence.",
        )
    return WorkflowRepository(database)


RepositoryDependency = Annotated[WorkflowRepository, Depends(get_repository)]


async def get_workflow_or_404(repository: RepositoryDependency, workflow_id: str, user_id: UserDependency) -> Workflow:
    workflow = await repository.get(workflow_id, user_id)
    if not workflow:
        logger.info("workflow not found workflow_id=%s", workflow_id)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return workflow


@router.get("", response_model=list[Workflow])
async def list_workflows(repository: RepositoryDependency, user_id: UserDependency) -> list[Workflow]:
    return await repository.list(user_id)


@router.post("", response_model=Workflow, status_code=status.HTTP_201_CREATED)
async def create_workflow(payload: WorkflowCreate, repository: RepositoryDependency, user_id: UserDependency) -> Workflow:
    logger.info("creating workflow name=%s", payload.name)
    return await repository.create(payload, user_id)


@router.get("/{workflow_id}", response_model=Workflow)
async def get_workflow(workflow_id: str, repository: RepositoryDependency, user_id: UserDependency) -> Workflow:
    return await get_workflow_or_404(repository, workflow_id, user_id)


@router.put("/{workflow_id}", response_model=Workflow)
async def update_workflow(
    workflow_id: str, payload: WorkflowUpdate, repository: RepositoryDependency, user_id: UserDependency
) -> Workflow:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    return await repository.update(workflow, payload)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str, repository: RepositoryDependency, user_id: UserDependency) -> Response:
    await get_workflow_or_404(repository, workflow_id, user_id)
    await repository.delete(workflow_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{workflow_id}/preflight")
async def preflight_workflow(
    workflow_id: str, repository: RepositoryDependency, database: DatabaseDependency, user_id: UserDependency
) -> dict[str, Any]:
    from app.models.workflow import WorkflowPrefightResponse, PrefightIssueResponse
    
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    logger.info("validating workflow workflow_id=%s", workflow_id)
    
    connections = ConnectionRepository(database) if database.configured else None
    secrets = SecretRepository(database) if database.configured else None
    
    issues, is_valid = await validate_workflow_preflight(workflow, connections, secrets)
    issue_responses = [PrefightIssueResponse(**issue.to_dict()) for issue in issues]
    
    return WorkflowPrefightResponse(is_valid=is_valid, issues=issue_responses).model_dump()


@router.post("/{workflow_id}/run", response_model=RunWorkflowResponse)
async def execute_workflow(
    workflow_id: str, payload: RunWorkflowRequest, repository: RepositoryDependency, database: DatabaseDependency, user_id: UserDependency
) -> RunWorkflowResponse:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    logger.info("executing workflow workflow_id=%s", workflow_id)
    started_at = datetime.now(timezone.utc)
    try:
        inputs = await resolve_scheduled_inputs_for_owner(payload.inputs, user_id, SecretService(get_settings()), SecretRepository(database))
        validate_run_inputs(workflow.inputs, inputs)
        result = await run_workflow(workflow, inputs, ConnectionRepository(database), user_id)
        await WorkflowRunRepository(database).record(workflow.id, user_id, result, started_at, "manual")
        logger.info("workflow execution completed workflow_id=%s errors=%s", workflow_id, len(result.context.errors))
        return result
    except ValueError as error:
        logger.warning("workflow execution rejected workflow_id=%s error=%s", workflow_id, error)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.get("/{workflow_id}/runs", response_model=list[WorkflowRunRecord])
async def list_workflow_runs(
    workflow_id: str, repository: RepositoryDependency, database: DatabaseDependency, user_id: UserDependency
) -> list[WorkflowRunRecord]:
    await get_workflow_or_404(repository, workflow_id, user_id)
    records = await WorkflowRunRepository(database).list_for_workflow(workflow_id, user_id)
    return [WorkflowRunRecord.model_validate(record) for record in records]


@router.post("/{workflow_id}/apply-patch", response_model=Workflow)
async def apply_workflow_patch(
    workflow_id: str,
    payload: ApplyWorkflowPatchRequest,
    repository: RepositoryDependency,
    user_id: UserDependency,
) -> Workflow:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    nodes = list(workflow.graph.nodes)
    node_ids = {node.id for node in nodes}
    updates = {item.id: item for item in payload.patch.update_nodes}
    unknown_updates = set(updates) - node_ids
    if unknown_updates:
        raise HTTPException(status_code=422, detail=f"Patch references unknown node(s): {', '.join(sorted(unknown_updates))}")
    if any(node.id in node_ids for node in payload.patch.add_nodes):
        raise HTTPException(status_code=422, detail="Patch adds a node ID that already exists")

    updated_nodes = [
        node.model_copy(update={"label": updates[node.id].label or node.label, "config": updates[node.id].config if updates[node.id].config is not None else node.config})
        if node.id in updates else node
        for node in nodes
    ]
    updated_nodes.extend(payload.patch.add_nodes)
    input_by_key = {item.key: item for item in workflow.inputs}
    for item in payload.patch.add_inputs:
        input_by_key[item.key] = item
    try:
        updated = Workflow.model_validate({
            **workflow.model_dump(),
            "inputs": list(input_by_key.values()),
            "graph": {
                "nodes": [node.model_dump() for node in updated_nodes],
                "edges": [edge.model_dump() for edge in workflow.graph.edges] + [edge.model_dump() for edge in payload.patch.add_edges],
            },
            "updated_at": datetime.now(timezone.utc),
        })
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Patch validation failed: {error}") from error
    return await repository.update(workflow, WorkflowUpdate(inputs=updated.inputs, graph=updated.graph))


@router.post("/{workflow_id}/events/{event_name}")
async def trigger_workflow_event(
    workflow_id: str,
    event_name: str,
    payload: dict[str, Any],
    repository: RepositoryDependency,
    database: DatabaseDependency,
    x_workflow_trigger: str | None = Header(default=None),
) -> RunWorkflowResponse:
    workflow = await repository.get_by_event(workflow_id, event_name)
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event trigger was not found")
    schedule = next(node.typed_config() for node in workflow.graph.nodes if node.type.value == "schedule" and node.config.get("event_name") == event_name)
    if not schedule.event_secret:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event trigger has no secret configured")
    secret = await SecretRepository(database).get(workflow.owner_id, schedule.event_secret)
    if not secret or SecretService(get_settings()).decrypt(secret) != x_workflow_trigger:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid workflow trigger token")
    started_at = datetime.now(timezone.utc)
    inputs = await resolve_scheduled_inputs_for_owner(payload, workflow.owner_id, SecretService(get_settings()), SecretRepository(database))
    validate_run_inputs(workflow.inputs, inputs)
    result = await run_workflow(workflow, inputs, ConnectionRepository(database), workflow.owner_id)
    await WorkflowRunRepository(database).record(workflow.id, workflow.owner_id, result, started_at, "event")
    response_node_id = schedule.response_node_id
    if response_node_id:
        response_node = next((node for node in workflow.graph.nodes if node.id == response_node_id), None)
        if not response_node or response_node.type != NodeType.HTTP_RESPONSE:
            raise HTTPException(status_code=422, detail="Configured response node is not an HTTP Response node")
        response_config = response_node.typed_config()
        assert isinstance(response_config, HttpResponseNodeConfig)
        node_output = result.context.outputs.get(response_node.id, {}).get(response_config.output_key)
        if not isinstance(node_output, dict):
            raise HTTPException(status_code=502, detail="HTTP Response node did not produce a response payload")
        return JSONResponse(content=node_output.get("body"), status_code=int(node_output.get("status_code", 200)), headers=node_output.get("headers", {}))
    return result


@router.post("/{workflow_id}/console")
async def run_workflow_console(
    workflow_id: str,
    payload: WorkflowConsoleRequest,
    repository: RepositoryDependency,
    database: DatabaseDependency,
    user_id: UserDependency,
) -> Any:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    schedule = next(
        (
            node.typed_config()
            for node in workflow.graph.nodes
            if node.type == NodeType.SCHEDULE
            and node.config.get("trigger_mode") == "event"
            and node.config.get("event_name") == payload.event_name
        ),
        None,
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Event trigger was not found")
    inputs = {
        "conversation_id": payload.conversation_id,
        "message": payload.message,
        "history": json.dumps(payload.history, ensure_ascii=False),
    }
    validate_run_inputs(workflow.inputs, inputs)
    started_at = datetime.now(timezone.utc)
    result = await run_workflow(workflow, inputs, ConnectionRepository(database), user_id)
    await WorkflowRunRepository(database).record(workflow.id, user_id, result, started_at, "event")
    if schedule.response_node_id:
        response_node = next((node for node in workflow.graph.nodes if node.id == schedule.response_node_id), None)
        if not response_node or response_node.type != NodeType.HTTP_RESPONSE:
            raise HTTPException(status_code=422, detail="Configured response node is not an HTTP Response node")
        response_config = response_node.typed_config()
        assert isinstance(response_config, HttpResponseNodeConfig)
        node_output = result.context.outputs.get(response_node.id, {}).get(response_config.output_key)
        if not isinstance(node_output, dict):
            raise HTTPException(status_code=502, detail="HTTP Response node did not produce a response payload")
        return JSONResponse(content=node_output.get("body"), status_code=int(node_output.get("status_code", 200)), headers=node_output.get("headers", {}))
    return result


@router.post("/{workflow_id}/suggest", response_model=SuggestTemplateResponse)
async def suggest_workflow_template(
    workflow_id: str, payload: SuggestTemplateRequest, repository: RepositoryDependency, user_id: UserDependency
) -> SuggestTemplateResponse:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    try:
        suggestion = await suggest_template(workflow, payload.node_id, payload.goal, payload.current_value)
        return SuggestTemplateResponse(suggestion=suggestion)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post("/{workflow_id}/copilot/messages", response_model=CopilotMessageResponse)
async def message_workflow_copilot(
    workflow_id: str, payload: CopilotMessageRequest, repository: RepositoryDependency, database: DatabaseDependency, user_id: UserDependency
) -> CopilotMessageResponse:
    workflow = await get_workflow_or_404(repository, workflow_id, user_id)
    selected_node_id = payload.selected_node_id if payload.selected_node_id in {node.id for node in workflow.graph.nodes} else None
    context = {
        "workflow_name": workflow.name,
        "inputs": [item.model_dump() for item in workflow.inputs],
        "selected_node_id": selected_node_id,
        "nodes": [{"id": node.id, "type": node.type, "label": node.label, "config": node.config} for node in workflow.graph.nodes],
        "edges": [{"source": edge.source, "target": edge.target, "label": edge.label} for edge in workflow.graph.edges],
        "available_node_types": [node_type.value for node_type in NodeType],
        "available_connections": [],
        "available_secret_names": [],
        "latest_run": payload.latest_run,
    }
    if database.configured:
        connections = ConnectionRepository(database)
        secrets = SecretRepository(database)
        context["available_connections"] = [item.model_dump(mode="json") for item in await connections.list(user_id)]
        context["available_secret_names"] = [item.name for item in await secrets.list(user_id)]
        repository_request = any(token in payload.message.lower() for token in ("github", "repo", "repository"))
        if repository_request:
            repository_context: list[dict[str, Any]] = []
            for node in workflow.graph.nodes:
                if node.type != "github_repository":
                    continue
                try:
                    result = await run_github_repository(node, {"inputs": {}, "outputs": {}}, connections, user_id)
                    repository_context.append({"node_id": node.id, "label": node.label, "context": result.get(node.typed_config().output_key, "")})
                except Exception as error:
                    repository_context.append({"node_id": node.id, "label": node.label, "error": str(error)})
            context["repository_context"] = repository_context
    messages = [HumanMessage(content=item["content"]) if item.get("role") == "user" else AIMessage(content=item["content"]) for item in payload.conversation]
    messages.append(HumanMessage(content=payload.message))
    state = await create_workflow_copilot().ainvoke({"messages": messages, "workflow_context": context, "selected_node_id": selected_node_id, "intent": "", "analysis": [], "assistant_response": "", "proposal": None, "errors": []})
    return CopilotMessageResponse(message=state["assistant_response"], proposal=state.get("proposal"))