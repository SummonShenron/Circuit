from typing import Annotated, Any, TypedDict
import logging
import asyncio

from langgraph.graph import END, START, StateGraph

from ..models.workflow import (
    ExecutionContext,
    NodeType,
    RunWorkflowResponse,
    TraceEvent,
    Workflow,
    WorkflowNode,
    ScheduleNodeConfig,
)
from ..services.node_runners import read_path, run_node, run_repeat_until
from ..repositories.connections import ConnectionRepository

logger = logging.getLogger(__name__)


def merge_dicts(existing: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    return {**existing, **update}


def partition_for_each_body_nodes(workflow: Workflow) -> set[str]:
    nodes_by_id = {node.id: node for node in workflow.graph.nodes}
    body_ids: set[str] = set()
    for loop_node in workflow.graph.nodes:
        if loop_node.type != NodeType.FOR_EACH:
            continue
        config = loop_node.typed_config()
        selected_ids = set(config.body_node_ids)
        if loop_node.id in selected_ids or not selected_ids.issubset(nodes_by_id):
            raise ValueError(f"For Each node '{loop_node.label}' has invalid body nodes")
        if body_ids.intersection(selected_ids):
            raise ValueError("A node can belong to only one For Each body")
        body_ids.update(selected_ids)
    return body_ids


async def run_for_each_body(
    body_nodes: list[WorkflowNode], item: Any, item_key: str, parent_inputs: dict[str, Any], connections: ConnectionRepository | None = None, owner_id: str | None = None
) -> dict[str, Any]:
    """Run one item through an isolated sequential loop body."""
    context: dict[str, Any] = {"inputs": {**parent_inputs, item_key: item}, "outputs": {}}
    for body_node in body_nodes:
        try:
            context["outputs"][body_node.id] = await run_node(body_node, context, connections, owner_id)
        except Exception as error:
            return {"outputs": context["outputs"], "error": str(error)}
    return {"outputs": context["outputs"]}


class GraphState(TypedDict):
    inputs: dict[str, Any]
    outputs: Annotated[dict[str, Any], merge_dicts]
    logs: Annotated[list[str], list.__add__]
    errors: Annotated[list[str], list.__add__]
    decisions: Annotated[dict[str, str], merge_dicts]
    iterations: Annotated[dict[str, int], merge_dicts]
    trace: Annotated[list[TraceEvent], list.__add__]


def make_node_runner(workflow: Workflow, node: WorkflowNode, body_nodes_by_loop: dict[str, list[WorkflowNode]] | None = None, connections: ConnectionRepository | None = None, owner_id: str | None = None):
    async def execute(state: GraphState) -> dict[str, Any]:
        logger.info("workflow node started node_id=%s node_type=%s", node.id, node.type)
        started = TraceEvent(
            node_id=node.id,
            node_label=node.label,
            status="started",
            message=f"Running {node.label}",
        )
        context = {
            "inputs": state["inputs"],
            "outputs": state["outputs"],
            "workflow": {
                "id": workflow.id,
                "name": workflow.name,
                "description": workflow.description,
                "inputs": [item.model_dump(mode="json") for item in workflow.inputs],
                "nodes": [
                    {"id": item.id, "type": item.type.value, "label": item.label, "config": item.config}
                    for item in workflow.graph.nodes
                ],
                "edges": [
                    {"source": edge.source, "target": edge.target, "label": edge.label}
                    for edge in workflow.graph.edges
                ],
            },
            "latest_run": {
                "inputs": state["inputs"],
                "outputs": state["outputs"],
                "logs": state["logs"],
                "errors": state["errors"],
                "trace": [event.model_dump(mode="json") for event in state["trace"]],
            },
            "available_node_types": [node_type.value for node_type in NodeType],
        }
        if node.type == NodeType.FOR_EACH:
            config = node.typed_config()
            items = read_path(context, config.items_path)
            if not isinstance(items, list):
                raise ValueError(f"For Each node '{node.label}' requires a list at {config.items_path}")
            if len(items) > config.max_items:
                return {"decisions": {node.id: "limit_reached"}, "errors": [f"{node.label}: item limit reached"], "trace": [started]}
            results = []
            for item in items:
                result = await run_for_each_body(body_nodes_by_loop[node.id], item, config.item_key, state["inputs"], connections, owner_id)
                results.append(result)
                if result.get("error") and not config.continue_on_error:
                    return {"decisions": {node.id: "limit_reached"}, "outputs": {node.id: {config.result_key: results}}, "errors": [result["error"]], "trace": [started]}
            return {"decisions": {node.id: "complete"}, "outputs": {node.id: {config.result_key: results}}, "logs": [f"{node.label}: processed {len(items)} item(s)"], "trace": [started, TraceEvent(node_id=node.id, node_label=node.label, status="completed", message=f"Processed {len(items)} item(s)")]}
        if node.type == NodeType.REPEAT_UNTIL:
            iteration = state["iterations"].get(node.id, 0) + 1
            decision = await run_repeat_until(node, context, iteration)
            return {"iterations": {node.id: iteration}, "decisions": {node.id: decision}, "logs": [f"{node.label}: {decision} ({iteration})"], "trace": [started, TraceEvent(node_id=node.id, node_label=node.label, status="completed", message=f"{decision}: iteration {iteration}")]}
        retry = getattr(node.typed_config(), "retry", None)
        attempts = retry.max_attempts if retry else 1
        for attempt in range(1, attempts + 1):
            try:
                result = await run_node(node, context, connections, owner_id)
                break
            except Exception as error:
                if attempt < attempts:
                    delay = retry.initial_delay_ms * (retry.backoff_multiplier ** (attempt - 1))
                    logger.warning("workflow node retrying node_id=%s attempt=%s delay_ms=%s", node.id, attempt, int(delay))
                    started = TraceEvent(node_id=node.id, node_label=node.label, status="started", message=f"Retrying: attempt {attempt + 1} of {attempts}")
                    await asyncio.sleep(delay / 1000)
                    continue
                message = str(error)
                logger.exception("workflow node failed node_id=%s", node.id)
                return {
                    "errors": [message],
                    "logs": [f"{node.label}: failed after {attempts} attempt(s)"],
                    "trace": [started, TraceEvent(node_id=node.id, node_label=node.label, status="failed", message=message)],
                }

        if node.type == NodeType.CONDITION:
            decision = result["__branch__"]
            logger.info("workflow condition resolved node_id=%s branch=%s", node.id, decision)
            return {
                "decisions": {node.id: decision},
                "logs": [f"{node.label}: {decision}"],
                "trace": [started, TraceEvent(node_id=node.id, node_label=node.label, status="completed", message=f"Branch: {decision}")],
            }
        logger.info("workflow node completed node_id=%s", node.id)
        return {
            "outputs": {node.id: result},
            "logs": [f"{node.label}: completed"],
            "trace": [started, TraceEvent(node_id=node.id, node_label=node.label, status="completed", message="Completed")],
        }

    return execute


def compile_workflow(workflow: Workflow, connections: ConnectionRepository | None = None, owner_id: str | None = None):
    logger.info(
        "compiling workflow workflow_id=%s nodes=%s edges=%s",
        workflow.id,
        len(workflow.graph.nodes),
        len(workflow.graph.edges),
    )
    graph = StateGraph(GraphState)
    nodes_by_id = {node.id: node for node in workflow.graph.nodes}
    for_each_body_ids = partition_for_each_body_nodes(workflow)
    logger.info("partitioned For Each body nodes count=%s", len(for_each_body_ids))
    trigger_ids = {node.id for node in workflow.graph.nodes if node.type == NodeType.SCHEDULE}
    error_handler_ids = {
        node.typed_config().error_handler_node_id
        for node in workflow.graph.nodes
        if node.type == NodeType.SCHEDULE and node.typed_config().error_handler_node_id
    }
    incoming_nodes = {edge.target for edge in workflow.graph.edges if edge.source not in trigger_ids}
    outgoing_edges: dict[str, list] = {node.id: [] for node in workflow.graph.nodes}

    body_nodes_by_loop = {node.id: [nodes_by_id[body_id] for body_id in node.typed_config().body_node_ids] for node in workflow.graph.nodes if node.type == NodeType.FOR_EACH}
    parent_nodes = [node for node in workflow.graph.nodes if node.id not in for_each_body_ids and node.type != NodeType.SCHEDULE and node.id not in error_handler_ids]
    for node in parent_nodes:
        graph.add_node(node.id, make_node_runner(workflow, node, body_nodes_by_loop, connections, owner_id))
    for edge in workflow.graph.edges:
        if edge.source in for_each_body_ids or edge.target in for_each_body_ids or edge.source in error_handler_ids or edge.target in error_handler_ids:
            continue
        outgoing_edges[edge.source].append(edge)

    for node in parent_nodes:
        has_schedule_trigger = any(edge.source in trigger_ids and edge.target == node.id for edge in workflow.graph.edges)
        if node.id not in incoming_nodes or has_schedule_trigger:
            graph.add_edge(START, node.id)
        if node.type in {NodeType.CONDITION, NodeType.REPEAT_UNTIL, NodeType.FOR_EACH}:
            branches = {edge.label: edge.target for edge in outgoing_edges[node.id] if edge.label}
            expected = {"true", "false"} if node.type == NodeType.CONDITION else ({"continue", "done", "limit_reached"} if node.type == NodeType.REPEAT_UNTIL else {"complete", "limit_reached"})
            if set(branches) != expected:
                raise ValueError(f"{node.label} needs labeled edges: {', '.join(sorted(expected))}")
            graph.add_conditional_edges(node.id, lambda state, node_id=node.id: state["decisions"].get(node_id, "false"), branches)
        else:
            for edge in outgoing_edges[node.id]:
                graph.add_edge(node.id, edge.target)
        if not outgoing_edges[node.id]:
            graph.add_edge(node.id, END)

    if not parent_nodes:
        raise ValueError("A workflow needs at least one node to run")
    return graph.compile()


async def run_workflow(workflow: Workflow, inputs: dict[str, Any], connections: ConnectionRepository | None = None, owner_id: str | None = None) -> RunWorkflowResponse:
    logger.info("running compiled workflow workflow_id=%s", workflow.id)
    application = compile_workflow(workflow, connections, owner_id)
    state = await application.ainvoke(
        {"inputs": inputs, "outputs": {}, "logs": [], "errors": [], "decisions": {}, "iterations": {}, "trace": []}, config={"recursion_limit": 100}
    )
    result = RunWorkflowResponse(
        context=ExecutionContext(
            inputs=state["inputs"],
            outputs=state["outputs"],
            logs=state["logs"],
            errors=state["errors"],
        ),
        trace=state["trace"],
    )
    handler_id = next((node.typed_config().error_handler_node_id for node in workflow.graph.nodes if node.type == NodeType.SCHEDULE and node.typed_config().error_handler_node_id), None)
    if handler_id and result.context.errors:
        handler = next((node for node in workflow.graph.nodes if node.id == handler_id and node.type == NodeType.ERRAGENT), None)
        if handler:
            handler_context = {
                "inputs": result.context.inputs,
                "outputs": result.context.outputs,
                "workflow": {
                    "id": workflow.id,
                    "name": workflow.name,
                    "description": workflow.description,
                    "inputs": [item.model_dump(mode="json") for item in workflow.inputs],
                    "nodes": [{"id": item.id, "type": item.type.value, "label": item.label, "config": item.config} for item in workflow.graph.nodes],
                    "edges": [{"source": edge.source, "target": edge.target, "label": edge.label} for edge in workflow.graph.edges],
                },
                "latest_run": {"inputs": result.context.inputs, "outputs": result.context.outputs, "logs": result.context.logs, "errors": result.context.errors, "trace": [event.model_dump(mode="json") for event in result.trace]},
                "available_node_types": [node_type.value for node_type in NodeType],
            }
            try:
                handler_result = await run_node(handler, handler_context, connections, owner_id)
                result.context.outputs[handler.id] = handler_result
                result.context.logs.append(f"{handler.label}: error handler completed")
                result.trace.append(TraceEvent(node_id=handler.id, node_label=handler.label, status="completed", message="Error handler completed"))
            except Exception as error:
                result.context.errors.append(f"Error handler '{handler.label}' failed: {error}")
                result.trace.append(TraceEvent(node_id=handler.id, node_label=handler.label, status="failed", message=str(error)))
    logger.info("compiled workflow finished workflow_id=%s errors=%s", workflow.id, len(result.context.errors))
    return result