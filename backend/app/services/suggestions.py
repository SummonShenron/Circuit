import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import get_settings
from app.models.workflow import Workflow, node_output_keys
from app.services.llm import GoogleFlashModel

logger = logging.getLogger(__name__)
llm = GoogleFlashModel(get_settings())


def available_templates(workflow: Workflow, node_id: str) -> list[str]:
    parents: dict[str, list[str]] = {node.id: [] for node in workflow.graph.nodes}
    for edge in workflow.graph.edges:
        parents[edge.target].append(edge.source)
    upstream: set[str] = set()
    def visit(current_id: str) -> None:
        for parent_id in parents[current_id]:
            if parent_id not in upstream:
                upstream.add(parent_id)
                visit(parent_id)
    visit(node_id)
    templates = [f"{{{{input.{item.key}}}}}" for item in workflow.inputs]
    for node in workflow.graph.nodes:
        if node.id in upstream:
            templates.extend(f"{{{{{node.id}.{key}}}}}" for key in node_output_keys(node))
    return templates


async def suggest_template(workflow: Workflow, node_id: str, goal: str, current_value: str) -> str:
    if node_id not in {node.id for node in workflow.graph.nodes}:
        raise ValueError("Workflow node was not found")
    templates = available_templates(workflow, node_id)
    instructions = "Return only the proposed text. Use only listed templates exactly; do not use markdown."
    prompt = f"Goal: {goal}\nCurrent value: {current_value}\nAllowed templates: {', '.join(templates) or 'none'}"
    logger.info("requesting template suggestion node_id=%s", node_id)
    response = await llm.get("gemini-3.6-flash", 0.2, 300).ainvoke([SystemMessage(content=instructions), HumanMessage(content=prompt)])
    suggestion = str(response.content).strip()
    allowed = set(templates)
    used = {f"{{{{{path}}}}}" for path in __import__("re").findall(r"{{\s*([a-zA-Z_][\w.]*)\s*}}", suggestion)}
    if not used.issubset(allowed):
        raise ValueError("Suggestion contains an unavailable workflow variable")
    return suggestion