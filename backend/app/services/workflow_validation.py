import logging
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.workflow import (
    Workflow,
    WorkflowNode,
    NodeType,
    ApiNodeConfig,
    LlmNodeConfig,
    GoogleSheetsAppendNodeConfig,
    GoogleDriveNodeConfig,
    GoogleDriveUpdateNodeConfig,
    GmailSendNodeConfig,
    GoogleCalendarNodeConfig,
    GitHubRepositoryNodeConfig,
    GitHubActionNodeConfig,
    JobSearchNodeConfig,
    ErrAgentNodeConfig,
    ScheduleNodeConfig,
    MongoDbNodeConfig,
    TEMPLATE_PATTERN,
)
from app.config import get_settings
from app.repositories.connections import ConnectionRepository
from app.repositories.secrets import SecretRepository

logger = logging.getLogger(__name__)


class PrefightIssue:
    def __init__(self, severity: str, node_id: str, node_label: str, message: str):
        self.severity = severity  # "error", "warning"
        self.node_id = node_id
        self.node_label = node_label
        self.message = message

    def to_dict(self) -> dict[str, str]:
        return {
            "severity": self.severity,
            "node_id": self.node_id,
            "node_label": self.node_label,
            "message": self.message,
        }


async def validate_workflow_preflight(
    workflow: Workflow,
    connections: ConnectionRepository | None = None,
    secrets: SecretRepository | None = None,
) -> tuple[list[PrefightIssue], bool]:
    """
    Validate workflow before execution. Returns (issues, is_valid).
    """
    issues: list[PrefightIssue] = []
    settings = get_settings()

    for node in workflow.graph.nodes:
        # Skip trigger nodes
        if node.type == NodeType.SCHEDULE:
            config = node.typed_config()
            if isinstance(config, ScheduleNodeConfig) and config.error_handler_node_id:
                handler = next((candidate for candidate in workflow.graph.nodes if candidate.id == config.error_handler_node_id), None)
                if not handler or handler.type != NodeType.ERRAGENT:
                    issues.append(PrefightIssue("error", node.id, node.label, "The selected error handler must be an ErrAgent node"))
            if isinstance(config, ScheduleNodeConfig) and config.response_node_id:
                response_node = next((candidate for candidate in workflow.graph.nodes if candidate.id == config.response_node_id), None)
                if not response_node or response_node.type != NodeType.HTTP_RESPONSE:
                    issues.append(PrefightIssue("error", node.id, node.label, "The selected response must be an HTTP Response node"))
            if isinstance(config, ScheduleNodeConfig) and config.time_of_day:
                try:
                    ZoneInfo(config.timezone)
                except ZoneInfoNotFoundError:
                    issues.append(PrefightIssue("error", node.id, node.label, f"Unknown schedule timezone '{config.timezone}'"))
                if config.interval == "weekly" and not config.days_of_week:
                    issues.append(PrefightIssue("warning", node.id, node.label, "Weekly specific-time schedules have no weekday selected; the current weekday will be used"))
            continue

        # Check LLM nodes
        if node.type == NodeType.LLM:
            config = node.typed_config()
            assert isinstance(config, LlmNodeConfig)
            if not config.prompt or not config.prompt.strip():
                issues.append(
                    PrefightIssue(
                        "error",
                        node.id,
                        node.label,
                        "LLM node has no prompt configured",
                    )
                )
            if config.json_mode and not config.prompt.strip():
                issues.append(
                    PrefightIssue(
                        "error",
                        node.id,
                        node.label,
                        "JSON mode requires a prompt that instructs the model to return JSON",
                    )
                )

        # Check API nodes
        elif node.type == NodeType.API:
            config = node.typed_config()
            assert isinstance(config, ApiNodeConfig)
            if not config.url or not config.url.strip():
                issues.append(
                    PrefightIssue(
                        "error",
                        node.id,
                        node.label,
                        "API node has no URL configured",
                    )
                )
            else:
                parsed = urlparse(config.url)
                if parsed.hostname and parsed.hostname not in settings.api_allowed_hosts:
                    issues.append(
                        PrefightIssue(
                            "warning",
                            node.id,
                            node.label,
                            f"API host '{parsed.hostname}' may not be in API_ALLOWED_HOSTS",
                        )
                    )

        # Check nodes that require connections
        connection_required_types = {
            NodeType.GOOGLE_SHEETS_APPEND: GoogleSheetsAppendNodeConfig,
            NodeType.GOOGLE_DRIVE: GoogleDriveNodeConfig,
            NodeType.GOOGLE_DRIVE_UPDATE: GoogleDriveUpdateNodeConfig,
            NodeType.GMAIL_SEND: GmailSendNodeConfig,
            NodeType.GOOGLE_CALENDAR: GoogleCalendarNodeConfig,
            NodeType.GITHUB_REPOSITORY: GitHubRepositoryNodeConfig,
            NodeType.GITHUB_ACTION: GitHubActionNodeConfig,
        }

        if node.type in connection_required_types:
            config = node.typed_config()
            connection_id = getattr(config, "connection_id", None)
            if not connection_id:
                issues.append(
                    PrefightIssue(
                        "error",
                        node.id,
                        node.label,
                        f"{node.type.value} node requires a connection",
                    )
                )
            elif connections:
                connection = await connections.get_document(
                    connection_id, workflow.owner_id
                )
                if not connection:
                    issues.append(
                        PrefightIssue(
                            "error",
                            node.id,
                            node.label,
                            f"Connection '{connection_id}' not found or not accessible",
                        )
                    )

        # Check Job Search node secrets
        if node.type == NodeType.JOB_SEARCH:
            config = node.typed_config()
            assert isinstance(config, JobSearchNodeConfig)
            settings = get_settings()
            if config.provider == "adzuna":
                if (not config.app_id_secret and not settings.adzuna_app_id) or (not config.app_key_secret and not (settings.adzuna_app_key or settings.adzuna_api_key)):
                    issues.append(
                        PrefightIssue(
                            "error",
                            node.id,
                            node.label,
                            "Adzuna requires node secrets or ADZUNA_APP_ID and ADZUNA_APP_KEY environment variables",
                        )
                    )
            elif config.provider == "jooble":
                if not config.api_key_secret and not (settings.jooble_api_key or settings.joobq_api_key):
                    issues.append(
                        PrefightIssue(
                            "error",
                            node.id,
                            node.label,
                            "Jooble requires a node secret or JOOBLE_API_KEY environment variable",
                        )
                    )

        if node.type == NodeType.ERRAGENT:
            config = node.typed_config()
            assert isinstance(config, ErrAgentNodeConfig)
            endpoint = config.endpoint or settings.erragent_api_url
            if not endpoint:
                issues.append(PrefightIssue("error", node.id, node.label, "ErrAgent requires an endpoint or ERRAGENT_API_URL"))
            else:
                parsed = urlparse(endpoint)
                if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                    issues.append(PrefightIssue("error", node.id, node.label, "ErrAgent endpoint must be an absolute HTTP or HTTPS URL"))
                elif endpoint != settings.erragent_api_url and parsed.hostname not in settings.api_allowed_hosts:
                    issues.append(PrefightIssue("warning", node.id, node.label, f"ErrAgent host '{parsed.hostname}' is not in API_ALLOWED_HOSTS"))
            if not config.goal.strip():
                issues.append(PrefightIssue("error", node.id, node.label, "ErrAgent requires a goal"))
            if config.api_key_secret and secrets:
                secret = await secrets.get(workflow.owner_id, config.api_key_secret)
                if not secret:
                    issues.append(PrefightIssue("error", node.id, node.label, f"Secret '{config.api_key_secret}' is not configured in your dashboard"))
            elif not config.api_key_secret and not settings.erragent_api_key:
                issues.append(PrefightIssue("warning", node.id, node.label, "ErrAgent has no API key configured; continue only if the bridge permits unauthenticated access"))

        if node.type == NodeType.MONGODB:
            config = node.typed_config()
            assert isinstance(config, MongoDbNodeConfig)
            if not config.connection_uri_secret and not settings.mongo_workflow_uri:
                issues.append(PrefightIssue("error", node.id, node.label, "MongoDB requires MONGO_WORKFLOW_URI or a connection URI secret"))
            if config.operation == "update_one" and not config.update:
                issues.append(PrefightIssue("error", node.id, node.label, "MongoDB update_one requires an update document"))
            if config.connection_uri_secret and secrets:
                secret = await secrets.get(workflow.owner_id, config.connection_uri_secret)
                if not secret:
                    issues.append(PrefightIssue("error", node.id, node.label, f"Secret '{config.connection_uri_secret}' is not configured in your dashboard"))

        # Check secret references
        secret_references = extract_secret_references(node)
        if secret_references and secrets:
            for secret_name in secret_references:
                secret = await secrets.get(workflow.owner_id, secret_name)
                if not secret:
                    issues.append(
                        PrefightIssue(
                            "error",
                            node.id,
                            node.label,
                            f"Secret '{secret_name}' is not configured in your dashboard",
                        )
                    )

    return issues, len([i for i in issues if i.severity == "error"]) == 0


def extract_secret_references(node: WorkflowNode) -> set[str]:
    """Extract all $secret references from node config."""
    secrets = set()

    def extract_from_value(value: Any) -> None:
        if isinstance(value, dict):
            if "$secret" in value:
                secrets.add(str(value["$secret"]))
            else:
                for v in value.values():
                    extract_from_value(v)
        elif isinstance(value, list):
            for v in value:
                extract_from_value(v)
        elif isinstance(value, str):
            # Check for inline secret references like {"$secret":"NAME"}
            pass

    for key, value in node.config.items():
        extract_from_value(value)

    return secrets
