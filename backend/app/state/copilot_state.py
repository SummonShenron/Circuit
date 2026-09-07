from typing import Annotated, Any, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages


class WorkflowCopilotState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    workflow_context: dict[str, Any]
    selected_node_id: str | None
    intent: str
    analysis: list[str]
    assistant_response: str
    proposal: dict[str, Any] | None
    errors: Annotated[list[str], list.__add__]