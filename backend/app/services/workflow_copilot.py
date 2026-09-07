import logging
import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app.config import get_settings
from app.models.workflow import WorkflowCreate, WorkflowProposal
from app.services.api_catalog import search_connectors
from app.services.llm import GoogleFlashModel, response_text
from app.state.copilot_state import WorkflowCopilotState

logger = logging.getLogger(__name__)
llm = GoogleFlashModel(get_settings())

CAPABILITIES = (
    "I can explain the current workflow, diagnose structural problems, discover supported API connectors, "
    "and delegate planning or debugging to an ErrAgent bridge when the workflow includes an ErrAgent block. "
    "and propose workflows using schedule, LLM, API, condition, transform, variable, repeat, for-each, GitHub repository, Google Drive, and Resend nodes. "
    "I cannot authenticate a GitHub account or apply changes without the user reviewing the proposal. "
    "For repository questions, I can inspect context from configured GitHub repository nodes when a connected GitHub PAT permits access, "
    "or propose a GitHub repository context step for a repository that is not configured yet."
)


def capability_guidance(request: str) -> str:
    return (
        f"I can help with that, but I need to use the workflow blocks available in this builder. {CAPABILITIES} "
        f"For your request ({request}), add or connect the required credential in the GitHub repository block, then run the workflow."
    )


def repository_analysis_proposal(message: str) -> dict[str, Any] | None:
    lowered = message.lower()
    repository_marker = "github" in lowered or "repo" in lowered or "repository" in lowered
    analysis_marker = "what it does" in lowered or "understand" in lowered or "analy" in lowered or "summar" in lowered
    if not repository_marker or not analysis_marker:
        return None

    repository_match = re.search(r"(?:https?://)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", message, flags=re.IGNORECASE)
    if repository_match is None:
        repository_match = re.search(r"\b([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)\b", message)
    if not repository_match:
        return None
    owner, repository = repository_match.groups()

    return {
        "summary": f"Connect a read-capable GitHub PAT, then read {owner}/{repository} and explain what it does.",
        "patch": {
            "add_nodes": [
                {
                    "id": "github_repository_context",
                    "type": "github_repository",
                    "label": "Read GitHub repository",
                    "position": {"x": 260, "y": 220},
                    "config": {
                        "owner": owner,
                        "repository": repository,
                        "connection_id": "github_connection_required",
                        "include_readme": True,
                        "auto_select_files": True,
                        "include_paths": ["package.json", "pyproject.toml"],
                        "max_files": 12,
                        "max_chars": 40000,
                        "output_key": "repository_context",
                    },
                },
                {
                    "id": "explain_github_repository",
                    "type": "llm",
                    "label": "Explain repository",
                    "position": {"x": 620, "y": 220},
                    "config": {
                        "prompt": "Explain what this repository does, its main technologies, important entry points, and how the pieces fit together. Be clear about evidence and unknowns. Repository context: {{github_repository_context.repository_context}}",
                        "model": "gemini-3.6-flash",
                        "temperature": 0.2,
                        "output_key": "repository_summary",
                    },
                },
            ],
            "update_nodes": [],
            "add_edges": [
                {
                    "id": "github_repository_context_to_explanation",
                    "source": "github_repository_context",
                    "target": "explain_github_repository",
                    "source_handle": None,
                    "label": None,
                }
            ],
        },
        "valid": False,
        "errors": [],
    }


def daily_briefing_proposal(message: str) -> dict[str, Any] | None:
    lowered = message.lower()
    if not ("daily briefing" in lowered or ("weather" in lowered and "news" in lowered and "calendar" in lowered)):
        return None
    nodes = [
        {"id": "schedule_daily", "type": "schedule", "label": "Daily briefing schedule", "position": {"x": 80, "y": 260}, "config": {"interval": "daily", "enabled": True, "input_values": {"recipient_email": ""}}},
        {"id": "fetch_weather", "type": "api", "label": "Fetch weather", "position": {"x": 340, "y": 80}, "config": {"method": "GET", "url": "https://api.weather.gov/gridpoints/DMX/47,58/forecast", "headers": {"User-Agent": "Circuit workflow builder"}, "body": None, "output_key": "weather"}},
        {"id": "fetch_news", "type": "api", "label": "Fetch news", "position": {"x": 340, "y": 220}, "config": {"method": "GET", "url": "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5", "headers": {"User-Agent": "Circuit workflow builder/1.0"}, "body": None, "output_key": "news"}},
        {"id": "fetch_calendar", "type": "api", "label": "Fetch calendar", "position": {"x": 340, "y": 360}, "config": {"method": "GET", "url": "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10", "headers": {}, "body": None, "connection_id": "", "output_key": "calendar"}},
        {"id": "merge_briefing_data", "type": "transform", "label": "Merge briefing data", "position": {"x": 620, "y": 220}, "config": {"mappings": {"weather": "{{fetch_weather.weather}}", "news": "{{fetch_news.news}}", "calendar": "{{fetch_calendar.calendar}}"}}},
        {"id": "generate_briefing", "type": "llm", "label": "Generate daily briefing", "position": {"x": 880, "y": 220}, "config": {"prompt": "Write a complete personal daily briefing using the weather, top news, and calendar events below. Do not ask the user to provide these sources; they are included in the data. Use clear headings, summarize all five news headlines when available, list relevant calendar events, include useful weather details, and explicitly label unavailable data. Finish the response fully and do not stop mid-sentence.\n\nWeather: {{merge_briefing_data.weather}}\nNews: {{merge_briefing_data.news}}\nCalendar: {{merge_briefing_data.calendar}}", "model": "gemini-3.6-flash", "temperature": 0.2, "max_tokens": 1800, "output_key": "briefing"}},
        {"id": "save_briefing_drive", "type": "google_drive", "label": "Save briefing to Drive", "position": {"x": 1140, "y": 140}, "config": {"name": "daily-briefing.md", "content": "{{generate_briefing.briefing}}", "mime_type": "text/markdown", "folder_id": "", "file_id": "", "connection_id": "", "output_key": "drive_file"}},
        {"id": "email_briefing", "type": "resend_email", "label": "Email daily briefing", "position": {"x": 1140, "y": 320}, "config": {"from_email": "Patchy <patchy@sonicassistant.com>", "to": "{{inputs.recipient_email}}", "subject": "Your daily briefing", "body": "{{generate_briefing.briefing}}", "body_type": "text", "output_key": "email_response"}},
    ]
    edges = []
    for target in ("fetch_weather", "fetch_news", "fetch_calendar"):
        edges.append({"id": f"schedule_daily_{target}", "source": "schedule_daily", "target": target, "source_handle": None, "label": None})
    edges.extend([
        {"id": "weather_merge", "source": "fetch_weather", "target": "merge_briefing_data", "source_handle": None, "label": None},
        {"id": "news_merge", "source": "fetch_news", "target": "merge_briefing_data", "source_handle": None, "label": None},
        {"id": "calendar_merge", "source": "fetch_calendar", "target": "merge_briefing_data", "source_handle": None, "label": None},
        {"id": "merge_generate", "source": "merge_briefing_data", "target": "generate_briefing", "source_handle": None, "label": None},
        {"id": "generate_drive", "source": "generate_briefing", "target": "save_briefing_drive", "source_handle": None, "label": None},
        {"id": "generate_email", "source": "generate_briefing", "target": "email_briefing", "source_handle": None, "label": None},
    ])
    return {"summary": "Create a daily scheduled briefing using keyless NOAA weather, Hacker News, and Google Calendar, then save it to Drive and email it.", "patch": {"add_inputs": [{"key": "recipient_email", "label": "Recipient email", "type": "string", "required": True}], "add_nodes": nodes, "update_nodes": [], "add_edges": edges}, "valid": False, "errors": []}


def is_repository_analysis_request(message: str) -> bool:
    lowered = message.lower()
    return (
        ("github" in lowered or "repo" in lowered or "repository" in lowered)
        and ("what it does" in lowered or "understand" in lowered or "analy" in lowered or "summar" in lowered)
    )


async def workflow_copilot_node(state: WorkflowCopilotState) -> dict[str, Any]:
    system = SystemMessage(
        content=(
            "You are Workflow Copilot. Help users design visual agent workflows. "
            "Use only the provided workflow context. Explain suggestions clearly and do not claim "
            "to apply changes. Treat latest_run, available_node_types, available_connections, "
            "available_secret_names, and repository_context as trusted runtime context. Never reveal "
            "secret values or claim a connection exists when it is not listed. Return plain text only.\n"
            f"Your capabilities and limits: {CAPABILITIES}"
        )
    )
    context = HumanMessage(content=f"Workflow context: {state['workflow_context']}")
    try:
        response = await llm.get("gemini-3.6-flash", 0.2, 1400).ainvoke(
            [system, context, *state["messages"]]
        )
        return {"assistant_response": response_text(response.content), "messages": [response]}
    except Exception as error:
        logger.exception("workflow copilot request failed")
        return {"assistant_response": "I could not generate a response.", "errors": [str(error)]}


async def classify_intent(state: WorkflowCopilotState) -> dict[str, str]:
    message = state["messages"][-1].content.lower()
    if any(word in message for word in ("error", "fail", "debug", "broken", "422")):
        intent = "debug"
    elif any(word in message for word in ("api", "endpoint", "header", "request body", "connector")):
        intent = "api_discovery"
    elif any(word in message for word in ("create", "add", "build", "connect", "flow")):
        intent = "build"
    else:
        intent = "explain"
    logger.info("workflow copilot classified intent=%s", intent)
    return {"intent": intent}


async def copilot_responder(state: WorkflowCopilotState) -> dict[str, Any]:
    focus = {
        "debug": "Focus on diagnosing errors, missing variables, invalid graph routes, or failed nodes.",
        "api_discovery": "Focus on API connector configuration, URLs, methods, headers, bodies, and output mappings. Do not invent API documentation.",
        "build": "Focus on proposing a clear workflow structure using the available node types and connections.",
        "explain": "Focus on explaining the current workflow and its nodes clearly.",
    }[state["intent"]]
    system = SystemMessage(content=f"You are Workflow Copilot. {focus} Use only provided workflow context, including latest run data and authorized repository context when present. Do not claim to apply changes. Never reveal secret values. Return plain text only. {CAPABILITIES}")
    catalog = search_connectors(str(state["messages"][-1].content)) if state["intent"] == "api_discovery" else []
    context = HumanMessage(content=f"Workflow context: {state['workflow_context']}\nDeterministic analysis: {state.get('analysis', [])}\nTrusted API connectors: {catalog}")
    try:
        response = await llm.get("gemini-3.6-flash", 0.2, 1400).ainvoke([system, context, *state["messages"]])
        return {"assistant_response": response_text(response.content), "messages": [response]}
    except Exception as error:
        logger.exception("workflow copilot responder failed intent=%s", state["intent"])
        return {"assistant_response": "I could not generate a response.", "errors": [str(error)]}


async def analyze_workflow(state: WorkflowCopilotState) -> dict[str, list[str]]:
    context = state["workflow_context"]
    nodes = context["nodes"]
    node_ids = {node["id"] for node in nodes}
    edges = context["edges"]
    findings: list[str] = []
    for edge in edges:
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            findings.append("An edge references a node that no longer exists.")
    for node in nodes:
        config = node["config"]
        if node["type"] == "llm" and not config.get("prompt"):
            findings.append(f"LLM node '{node['label']}' has no prompt.")
        if node["type"] == "api" and not config.get("url"):
            findings.append(f"API node '{node['label']}' has no URL.")
        expected = {"condition": {"true", "false"}, "repeat_until": {"continue", "done", "limit_reached"}, "for_each": {"each_item", "complete", "limit_reached"}}.get(node["type"])
        if expected:
            actual = {edge.get("label") for edge in edges if edge["source"] == node["id"]}
            missing = expected - actual
            if missing:
                findings.append(f"{node['label']} is missing route(s): {', '.join(sorted(missing))}.")
    if not findings:
        findings.append("No structural configuration problems were found.")
    logger.info("workflow copilot analysis findings=%s", len(findings))
    return {"analysis": findings}


async def plan_patch(state: WorkflowCopilotState) -> dict[str, Any]:
    request = str(state["messages"][-1].content)
    briefing_proposal = daily_briefing_proposal(request)
    if briefing_proposal:
        return {"proposal": briefing_proposal, "assistant_response": briefing_proposal["summary"]}
    deterministic_proposal = repository_analysis_proposal(request)
    if deterministic_proposal:
        return {"proposal": deterministic_proposal, "assistant_response": deterministic_proposal["summary"]}
    if is_repository_analysis_request(request):
        return {
            "assistant_response": (
                "Please include the repository as owner/name or a GitHub URL, and connect a GitHub PAT "
                "with permission to read it. I can then create a GitHub repository context step followed by an LLM explanation step."
            )
        }

    system = SystemMessage(content=f"You are Workflow Copilot. Return JSON only: {{summary, patch:{{add_nodes:[], update_nodes:[], add_edges:[]}}}}. Use only node types, connections, and variables in the workflow context. Do not remove nodes or edges. Never include secret values. {CAPABILITIES}")
    context = HumanMessage(content=f"Workflow context: {state['workflow_context']}")
    try:
        response = await llm.get("gemini-3.6-flash", 0.2, 1800).ainvoke([system, context, *state["messages"]])
        content = response_text(response.content).strip()
        if content.startswith("```"):
            content = content.removeprefix("```").removeprefix("json").removesuffix("```").strip()
        proposal = WorkflowProposal.model_validate(json.loads(content))
        return {"proposal": proposal.model_dump(), "assistant_response": proposal.summary}
    except Exception as error:
        logger.exception("workflow copilot patch planning failed")
        return {"assistant_response": capability_guidance(request), "errors": [str(error)]}


async def validate_patch(state: WorkflowCopilotState) -> dict[str, Any]:
    proposal_data = state.get("proposal")
    if not proposal_data:
        return {}
    proposal = WorkflowProposal.model_validate(proposal_data)
    context = state["workflow_context"]
    nodes = {node["id"]: node for node in context["nodes"]}
    for update in proposal.patch.update_nodes:
        if update.id not in nodes:
            proposal.valid = False; proposal.errors = [f"Cannot update unknown node '{update.id}'."]
            return {"proposal": proposal.model_dump(), "assistant_response": proposal.summary}
        if update.label is not None:
            nodes[update.id]["label"] = update.label
        if update.config is not None:
            nodes[update.id]["config"] = update.config
    candidate = {"name": context["workflow_name"], "inputs": [*context["inputs"], *[item.model_dump() for item in proposal.patch.add_inputs]], "graph": {"nodes": [*nodes.values(), *[node.model_dump() for node in proposal.patch.add_nodes]], "edges": [*context["edges"], *[edge.model_dump() for edge in proposal.patch.add_edges]]}}
    try:
        WorkflowCreate.model_validate(candidate)
        proposal.valid = True
    except Exception as error:
        proposal.errors = [str(error)]
    return {"proposal": proposal.model_dump(), "assistant_response": proposal.summary}


def route_intent(state: WorkflowCopilotState) -> str:
    return state["intent"]


def create_workflow_copilot():
    graph = StateGraph(WorkflowCopilotState)
    graph.add_node("classify_intent", classify_intent)
    graph.add_node("explain", copilot_responder)
    graph.add_node("build", copilot_responder)
    graph.add_node("plan_patch", plan_patch)
    graph.add_node("validate_patch", validate_patch)
    graph.add_node("api_discovery", copilot_responder)
    graph.add_node("analyze_workflow", analyze_workflow)
    graph.add_node("debug", copilot_responder)
    graph.add_edge(START, "classify_intent")
    graph.add_conditional_edges("classify_intent", route_intent, {"explain": "explain", "build": "plan_patch", "api_discovery": "api_discovery", "debug": "analyze_workflow"})
    graph.add_edge("plan_patch", "validate_patch")
    graph.add_edge("analyze_workflow", "debug")
    for node_name in ("explain", "validate_patch", "api_discovery", "debug"):
        graph.add_edge(node_name, END)
    return graph.compile()