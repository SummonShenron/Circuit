from datetime import datetime, timezone
from enum import StrEnum
import re
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

TEMPLATE_PATTERN = re.compile(r"{{\s*([a-zA-Z_][\w-]*(?:(?:\.[a-zA-Z_][\w-]*)|(?:\[\d+\]))*)\s*}}")


class NodeType(StrEnum):
    LLM = "llm"
    API = "api"
    CONDITION = "condition"
    TRANSFORM = "transform"
    REPEAT_UNTIL = "repeat_until"
    FOR_EACH = "for_each"
    GITHUB_REPOSITORY = "github_repository"
    VARIABLE = "variable"
    RESEND_EMAIL = "resend_email"
    GOOGLE_DRIVE = "google_drive"
    SCHEDULE = "schedule"
    GOOGLE_DRIVE_UPDATE = "google_drive_update"
    WEATHER_FORECAST = "weather_forecast"
    NEWS_HEADLINES = "news_headlines"
    GOOGLE_SHEETS_APPEND = "google_sheets_append"
    CSV_CREATE = "csv_create"
    RSS_FEED = "rss_feed"
    WEBHOOK_POST = "webhook_post"
    GMAIL_SEND = "gmail_send"
    REDDIT_HEADLINES = "reddit_headlines"
    GOOGLE_CALENDAR = "google_calendar"
    GITHUB_ACTION = "github_action"
    JOB_SEARCH = "job_search"
    ERRAGENT = "erragent"
    HTTP_RESPONSE = "http_response"
    MONGODB = "mongodb"
    MONGODB_VECTOR_SEARCH = "mongodb_vector_search"
    FILE_UPLOAD = "file_upload"


class Position(BaseModel):
    x: float
    y: float


class WorkflowInput(BaseModel):
    key: str = Field(pattern=r"^[a-zA-Z_]\w*$")
    label: str = Field(min_length=1, max_length=80)
    type: Literal["string", "number", "boolean", "file"] = "string"
    required: bool = False


class RetryPolicy(BaseModel):
    max_attempts: int = Field(default=1, ge=1, le=5)
    initial_delay_ms: int = Field(default=500, ge=0, le=30_000)
    backoff_multiplier: float = Field(default=2, ge=1, le=10)


class LlmNodeConfig(BaseModel):
    prompt: str = ""
    model: str = "gemini-3.6-flash"
    temperature: float = Field(default=0.2, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)
    system_instructions: str | None = None
    json_mode: bool = False
    output_key: str = "response"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class ApiNodeConfig(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict[str, Any] | None = None
    connection_id: str | None = None
    api_key_secret: str | None = None
    api_key_query_param: str | None = None
    api_key_header: str | None = None
    gmail_message: dict[str, str] | None = None
    output_key: str = "api_response"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class ConditionClause(BaseModel):
    input_path: str = ""
    operator: Literal["equals", "not_equals", "exists", "contains"] = "exists"
    value: Any = None


class ConditionNodeConfig(BaseModel):
    input_path: str = ""
    operator: Literal["equals", "not_equals", "exists", "contains"] = "exists"
    value: Any = None
    logic: Literal["and", "or"] = "and"
    conditions: list[ConditionClause] = Field(default_factory=list)


class TransformNodeConfig(BaseModel):
    mappings: dict[str, str] = Field(default_factory=dict)
    merge_arrays: dict[str, list[str]] = Field(default_factory=dict)


class VariableNodeConfig(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z_]\w*$")
    value: Any = ""


class RepeatUntilNodeConfig(BaseModel):
    input_path: str
    operator: Literal["equals", "not_equals", "exists", "contains"] = "exists"
    value: Any = None
    max_iterations: int = Field(default=3, ge=1, le=20)


class ForEachNodeConfig(BaseModel):
    items_path: str
    item_key: str = Field(default="item", pattern=r"^[a-zA-Z_]\w*$")
    body_node_ids: list[str] = Field(min_length=1)
    result_key: str = Field(default="items", pattern=r"^[a-zA-Z_]\w*$")
    max_items: int = Field(default=25, ge=1, le=100)
    continue_on_error: bool = False


class GitHubRepositoryNodeConfig(BaseModel):
    owner: str
    repository: str
    connection_id: str = Field(min_length=1)
    operation: Literal["repository_context", "search_pull_requests", "search_commits", "search_issues"] = "repository_context"
    search_query: str = ""
    search_limit: int = Field(default=10, ge=1, le=50)
    include_readme: bool = True
    auto_select_files: bool = True
    include_paths: list[str] = Field(default_factory=lambda: ["package.json", "pyproject.toml"])
    max_files: int = Field(default=12, ge=1, le=25)
    max_chars: int = Field(default=40_000, ge=1_000, le=100_000)
    output_key: str = "repository_context"


class ResendEmailNodeConfig(BaseModel):
    from_email: str = "Patchy <patchy@sonicassistant.com>"
    to: str = ""
    subject: str = ""
    body: str = ""
    body_type: Literal["text", "html"] = "text"
    output_key: str = "email_response"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class GoogleDriveNodeConfig(BaseModel):
    name: str = ""
    content: str = ""
    mime_type: str = "text/plain"
    folder_id: str | None = None
    file_id: str | None = None
    connection_id: str = ""
    output_key: str = "drive_file"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class GoogleDriveUpdateNodeConfig(BaseModel):
    file_id: str = Field(min_length=1)
    content: str = ""
    mime_type: str = "text/plain"
    connection_id: str = Field(min_length=1)
    output_key: str = "drive_file"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class WeatherForecastNodeConfig(BaseModel):
    output_key: str = "weather"
    user_agent: str = "Circuit workflow builder"


class NewsHeadlinesNodeConfig(BaseModel):
    limit: int = Field(default=5, ge=1, le=20)
    output_key: str = "news"
    user_agent: str = "Circuit workflow builder/1.0"


class GoogleSheetsAppendNodeConfig(BaseModel):
    spreadsheet_id: str = Field(min_length=1)
    range_name: str = "Sheet1!A:Z"
    values: list[Any] = Field(default_factory=list)
    connection_id: str = Field(min_length=1)
    output_key: str = "sheet_append"


class CsvCreateNodeConfig(BaseModel):
    filename: str = "export.csv"
    headers: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    output_key: str = "csv_file"


class RssFeedNodeConfig(BaseModel):
    url: str = Field(min_length=1)
    limit: int = Field(default=10, ge=1, le=50)
    output_key: str = "feed"


class WebhookPostNodeConfig(BaseModel):
    url: str = Field(min_length=1)
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict[str, Any] = Field(default_factory=dict)
    output_key: str = "webhook_response"


class HttpResponseNodeConfig(BaseModel):
    status_code: int = Field(default=200, ge=100, le=599)
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any = Field(default_factory=dict)
    output_key: str = "http_response"


class MongoDbNodeConfig(BaseModel):
    project: str = ""
    cluster_name: str = ""
    database_name: str = Field(min_length=1)
    collection_name: str = Field(min_length=1)
    operation: Literal["find", "update_one"] = "find"
    connection_uri_secret: str | None = None
    filter: dict[str, Any] = Field(default_factory=dict)
    update: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=20, ge=1, le=100)
    output_key: str = "mongodb_result"


class MongoVectorSearchNodeConfig(BaseModel):
    database_name: str = Field(min_length=1)
    collection_name: str = Field(min_length=1)
    index_name: str = "vector_index"
    embedding_path: str = "embedding"
    query: str = ""
    k: int = Field(default=4, ge=1, le=50)
    max_chunks: int = Field(default=4, ge=1, le=50)
    strategy: Literal["vector", "lexical", "hybrid"] = "vector"
    filter: dict[str, Any] = Field(default_factory=dict)
    embedding_model: str = "models/gemini-embedding-001"
    embedding_dimensions: int = Field(default=768, ge=1, le=4096)
    connection_uri_secret: str | None = None
    output_key: str = "retrieved_context"


class FileUploadNodeConfig(BaseModel):
    filename: str = ""
    content: str = Field(default="", max_length=500_000)
    parse_json: bool = True
    input_key: str = ""
    output_key: str = "uploaded_file"


class GmailSendNodeConfig(BaseModel):
    to: str = ""
    subject: str = ""
    body: str = ""
    connection_id: str = Field(min_length=1)
    output_key: str = "gmail_response"


class RedditHeadlinesNodeConfig(BaseModel):
    subreddit: str = "news"
    sort: Literal["hot", "new", "top"] = "top"
    limit: int = Field(default=5, ge=1, le=25)
    user_agent: str = "CircuitWorkflowBot/1.0 (by u/patchy)"
    output_key: str = "reddit"


class GoogleCalendarNodeConfig(BaseModel):
    operation: Literal["list", "create", "update"] = "list"
    calendar_id: str = "primary"
    event_id: str | None = None
    time_min: str | None = None
    time_max: str | None = None
    max_results: int = Field(default=10, ge=1, le=100)
    event: dict[str, Any] = Field(default_factory=dict)
    connection_id: str = Field(min_length=1)
    output_key: str = "calendar"


class GitHubActionNodeConfig(BaseModel):
    action: Literal["create_issue", "comment_issue", "create_pull_request"] = "create_issue"
    owner: str = ""
    repository: str = ""
    issue_number: int | None = None
    title: str = ""
    body: str = ""
    head: str = ""
    base: str = "main"
    connection_id: str = Field(min_length=1)
    output_key: str = "github_action"


class JobSearchNodeConfig(BaseModel):
    provider: Literal["adzuna", "jooble"] = "adzuna"
    keywords: str = "software engineer"
    location: str = "Des Moines, IA"
    radius_miles: int = Field(default=30, ge=0, le=250)
    remote: bool = False
    limit: int = Field(default=25, ge=1, le=100)
    app_id_secret: str | None = None
    app_key_secret: str | None = None
    api_key_secret: str | None = None
    output_key: str = "jobs"


class ErrAgentNodeConfig(BaseModel):
    operation: Literal["plan_workflow", "patch_workflow", "debug_run", "generate_connector", "job_search_flow"] = "debug_run"
    endpoint: str = ""
    goal: str = ""
    incident_id: str | None = None
    api_key_secret: str | None = None
    timeout_seconds: int = Field(default=30, ge=5, le=120)
    output_key: str = "erragent_result"


class ScheduleNodeConfig(BaseModel):
    trigger_mode: Literal["schedule", "event"] = "schedule"
    event_name: str = ""
    event_secret: str | None = None
    interval: Literal["5_minutes", "hourly", "daily", "weekly"] = "hourly"
    time_of_day: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: str = "UTC"
    enabled: bool = True
    days_of_week: list[int] = Field(default_factory=list)
    weeks_interval: int = Field(default=1, ge=1, le=52)
    input_values: dict[str, Any] = Field(default_factory=dict)
    error_handler_node_id: str | None = None
    response_node_id: str | None = None

    @field_validator("time_of_day", mode="before")
    @classmethod
    def normalize_blank_time(cls, value: Any) -> Any:
        return None if value == "" else value


NodeConfig = LlmNodeConfig | ApiNodeConfig | ConditionNodeConfig | TransformNodeConfig | VariableNodeConfig | RepeatUntilNodeConfig | ForEachNodeConfig | GitHubRepositoryNodeConfig | ResendEmailNodeConfig | GoogleDriveNodeConfig | ScheduleNodeConfig | GoogleDriveUpdateNodeConfig | WeatherForecastNodeConfig | NewsHeadlinesNodeConfig | GoogleSheetsAppendNodeConfig | CsvCreateNodeConfig | RssFeedNodeConfig | WebhookPostNodeConfig | HttpResponseNodeConfig | MongoDbNodeConfig | MongoVectorSearchNodeConfig | GmailSendNodeConfig | RedditHeadlinesNodeConfig | GoogleCalendarNodeConfig | GitHubActionNodeConfig | JobSearchNodeConfig | ErrAgentNodeConfig | FileUploadNodeConfig


class WorkflowNode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: NodeType
    label: str = "Untitled node"
    position: Position
    config: dict[str, Any] = Field(default_factory=dict)

    def typed_config(self) -> NodeConfig:
        config_models = {
            NodeType.LLM: LlmNodeConfig,
            NodeType.API: ApiNodeConfig,
            NodeType.CONDITION: ConditionNodeConfig,
            NodeType.TRANSFORM: TransformNodeConfig,
            NodeType.VARIABLE: VariableNodeConfig,
            NodeType.REPEAT_UNTIL: RepeatUntilNodeConfig,
            NodeType.FOR_EACH: ForEachNodeConfig,
            NodeType.GITHUB_REPOSITORY: GitHubRepositoryNodeConfig,
            NodeType.RESEND_EMAIL: ResendEmailNodeConfig,
            NodeType.GOOGLE_DRIVE: GoogleDriveNodeConfig,
            NodeType.SCHEDULE: ScheduleNodeConfig,
            NodeType.GOOGLE_DRIVE_UPDATE: GoogleDriveUpdateNodeConfig,
            NodeType.WEATHER_FORECAST: WeatherForecastNodeConfig,
            NodeType.NEWS_HEADLINES: NewsHeadlinesNodeConfig,
            NodeType.GOOGLE_SHEETS_APPEND: GoogleSheetsAppendNodeConfig,
            NodeType.CSV_CREATE: CsvCreateNodeConfig,
            NodeType.RSS_FEED: RssFeedNodeConfig,
            NodeType.WEBHOOK_POST: WebhookPostNodeConfig,
            NodeType.HTTP_RESPONSE: HttpResponseNodeConfig,
            NodeType.MONGODB: MongoDbNodeConfig,
            NodeType.MONGODB_VECTOR_SEARCH: MongoVectorSearchNodeConfig,
            NodeType.FILE_UPLOAD: FileUploadNodeConfig,
            NodeType.GMAIL_SEND: GmailSendNodeConfig,
            NodeType.REDDIT_HEADLINES: RedditHeadlinesNodeConfig,
            NodeType.GOOGLE_CALENDAR: GoogleCalendarNodeConfig,
            NodeType.GITHUB_ACTION: GitHubActionNodeConfig,
            NodeType.JOB_SEARCH: JobSearchNodeConfig,
            NodeType.ERRAGENT: ErrAgentNodeConfig,
        }
        return config_models[self.type].model_validate(self.config)


class WorkflowEdge(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    source: str
    target: str
    source_handle: str | None = None
    label: str | None = None


class WorkflowGraph(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_graph(self) -> "WorkflowGraph":
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("Workflow node IDs must be unique")

        unknown_edges = [
            edge.id
            for edge in self.edges
            if edge.source not in node_ids or edge.target not in node_ids
        ]
        if unknown_edges:
            raise ValueError(f"Edges reference unknown nodes: {', '.join(unknown_edges)}")

        adjacent_nodes = {node_id: [] for node_id in node_ids}
        for edge in self.edges:
            adjacent_nodes[edge.source].append(edge.target)

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str, path: list[str]) -> None:
            if node_id in visiting:
                cycle = path[path.index(node_id):]
                if not any(next(node for node in self.nodes if node.id == item).type == NodeType.REPEAT_UNTIL for item in cycle):
                    raise ValueError("Workflow graph cycles must include a Repeat Until node")
                return
            if node_id in visited:
                return
            visiting.add(node_id)
            for target_id in adjacent_nodes[node_id]:
                visit(target_id, [*path, target_id])
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in node_ids:
            visit(node_id, [node_id])
        return self


def normalize_template_path(path: str) -> list[str | tuple[str, int]]:
    """
    Parse a template path into segments. Handles:
    - Dot notation: foo.bar.baz
    - Array indices: foo[0].bar[1]
    - Mixed: foo.bar[0].items[1].value

    Returns list where each element is either:
    - str: a dict key (e.g., "bar")
    - tuple[str, int]: dict key + array index (e.g., ("bar", 0))
    """
    # Parse the path to extract segments and indices
    # Matches: identifier, optionally followed by [n], and repeat
    pattern = r"([a-zA-Z_][\w-]*)(?:\[(\d+)\])?"
    matches = re.findall(pattern, path)
    
    if not matches:
        return []
    
    segments: list[str | tuple[str, int]] = []
    for key, index in matches:
        if index:
            segments.append((key, int(index)))
        else:
            segments.append(key)
    
    # Handle input/output prefix
    if segments:
        first = segments[0]
        # Extract the key name from either str or tuple
        first_key = first if isinstance(first, str) else first[0]
        
        if first_key == "input":
            # Replace "input" with "inputs"
            if isinstance(first, str):
                segments[0] = "inputs"
            else:
                segments[0] = ("inputs", first[1])
        elif first_key not in {"inputs", "outputs"}:
            # Add "outputs" prefix
            segments.insert(0, "outputs")
    
    return segments


def node_output_keys(node: WorkflowNode) -> set[str]:
    config = node.typed_config()
    if isinstance(config, TransformNodeConfig):
        return set(config.mappings) | set(config.merge_arrays)
    if isinstance(config, VariableNodeConfig):
        return {config.name}
    output_key = getattr(config, "output_key", None)
    if isinstance(output_key, str) and output_key:
        return {output_key}
    result_key = getattr(config, "result_key", None)
    if isinstance(result_key, str) and result_key:
        return {result_key}
    return set()


def template_paths(value: Any) -> list[str]:
    if isinstance(value, str):
        return TEMPLATE_PATTERN.findall(value)
    if isinstance(value, dict):
        return [path for item in value.values() for path in template_paths(item)]
    if isinstance(value, list):
        return [path for item in value for path in template_paths(item)]
    return []


def validate_template_references(graph: WorkflowGraph, inputs: list[WorkflowInput]) -> None:
    nodes_by_id = {node.id: node for node in graph.nodes}
    input_keys = {workflow_input.key for workflow_input in inputs}
    body_input_keys = {
        body_node_id: node.typed_config().item_key
        for node in graph.nodes
        if node.type == NodeType.FOR_EACH
        for body_node_id in node.typed_config().body_node_ids
    }
    upstream: dict[str, set[str]] = {node.id: set() for node in graph.nodes}
    incoming: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for edge in graph.edges:
        incoming[edge.target].append(edge.source)

    def collect(node_id: str) -> set[str]:
        if upstream[node_id]:
            return upstream[node_id]
        parents = set(incoming[node_id])
        for parent in incoming[node_id]:
            parents.update(collect(parent))
        upstream[node_id] = parents
        return parents

    issues: list[str] = []
    for node in graph.nodes:
        for path in template_paths(node.config):
            segments = normalize_template_path(path)
            if segments[0] == "inputs":
                if len(segments) < 2 or (segments[1] not in input_keys and segments[1] != body_input_keys.get(node.id)):
                    issues.append(f"node '{node.id}' references undeclared input '{{{{{path}}}}}'")
                continue
            if len(segments) < 3 or segments[1] not in nodes_by_id:
                issues.append(f"node '{node.id}' references unknown output '{{{{{path}}}}}'")
                continue
            source_id, output_key = segments[1], segments[2]
            if source_id == node.id:
                issues.append(
                    f"node '{node.id}' cannot reference its own output '{{{{{path}}}}}'. "
                    "Use the upstream API/RSS node output in this Transform instead."
                )
            elif source_id not in collect(node.id):
                issues.append(f"node '{node.id}' references non-upstream output '{{{{{path}}}}}'")
            elif output_key not in node_output_keys(nodes_by_id[source_id]):
                available = sorted(node_output_keys(nodes_by_id[source_id]))
                available_text = ", ".join(available) if available else "none"
                issues.append(
                    f"node '{node.id}' references missing output '{{{{{path}}}}}' "
                    f"from '{source_id}'. Available outputs: {available_text}"
                )
    if issues:
        raise ValueError("Invalid workflow templates: " + "; ".join(issues))


def validate_run_inputs(declarations: list[WorkflowInput], values: dict[str, Any]) -> None:
    declared = {declaration.key: declaration for declaration in declarations}
    unknown = set(values) - set(declared)
    if unknown:
        raise ValueError(f"Unknown workflow input(s): {', '.join(sorted(unknown))}")

    for declaration in declarations:
        if declaration.required and (declaration.key not in values or values[declaration.key] is None):
            raise ValueError(f"Required workflow input '{declaration.key}' is missing")
        if declaration.key not in values or values[declaration.key] is None:
            continue
        value = values[declaration.key]
        expected_type = {"string": str, "number": (int, float), "boolean": bool, "file": str}[declaration.type]
        if declaration.type == "number" and isinstance(value, bool):
            raise ValueError(f"Workflow input '{declaration.key}' must be a number")
        if not isinstance(value, expected_type):
            raise ValueError(f"Workflow input '{declaration.key}' must be a {declaration.type}")


class Workflow(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    owner_id: str = "local-dev-user"
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    inputs: list[WorkflowInput] = Field(default_factory=list)
    graph: WorkflowGraph = Field(default_factory=WorkflowGraph)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_templates(self) -> "Workflow":
        validate_template_references(self.graph, self.inputs)
        return self


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    inputs: list[WorkflowInput] = Field(default_factory=list)
    graph: WorkflowGraph = Field(default_factory=WorkflowGraph)

    @model_validator(mode="after")
    def validate_templates(self) -> "WorkflowCreate":
        validate_template_references(self.graph, self.inputs)
        return self


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    inputs: list[WorkflowInput] | None = None
    graph: WorkflowGraph | None = None


class ExecutionContext(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class RunWorkflowRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)


class WorkflowConsoleRequest(BaseModel):
    event_name: str = Field(min_length=1, max_length=120)
    conversation_id: str = Field(default="console-session", min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=8000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=20)


class PrefightIssueResponse(BaseModel):
    severity: str
    node_id: str
    node_label: str
    message: str


class WorkflowPrefightResponse(BaseModel):
    is_valid: bool
    issues: list[PrefightIssueResponse] = Field(default_factory=list)


class SuggestTemplateRequest(BaseModel):
    node_id: str
    goal: str = Field(min_length=3, max_length=600)
    current_value: str = Field(default="", max_length=4000)


class SuggestTemplateResponse(BaseModel):
    suggestion: str


class TraceEvent(BaseModel):
    node_id: str
    node_label: str
    status: Literal["started", "completed", "failed"]
    message: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    received: dict[str, Any] | None = None
    output: Any = None


class RunWorkflowResponse(BaseModel):
    context: ExecutionContext
    trace: list[TraceEvent]


class WorkflowRunRecord(BaseModel):
    id: str
    workflow_id: str
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    status: Literal["completed", "failed"]
    trigger: Literal["manual", "schedule", "event"]
    context: ExecutionContext
    trace: list[TraceEvent]


class CopilotMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    selected_node_id: str | None = None
    conversation: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    latest_run: dict[str, Any] | None = None


class CopilotMessageResponse(BaseModel):
    message: str
    proposal: dict[str, Any] | None = None


class WorkflowNodePatch(BaseModel):
    id: str
    label: str | None = None
    config: dict[str, Any] | None = None


class WorkflowPatch(BaseModel):
    add_inputs: list[WorkflowInput] = Field(default_factory=list)
    add_nodes: list[WorkflowNode] = Field(default_factory=list)
    update_nodes: list[WorkflowNodePatch] = Field(default_factory=list)
    add_edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowProposal(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    patch: WorkflowPatch
    valid: bool = False
    errors: list[str] = Field(default_factory=list)


class ApplyWorkflowPatchRequest(BaseModel):
    patch: WorkflowPatch