import re
import logging
import base64
import csv
import io
import json
import math
import asyncio
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlparse, urlunsplit

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from ..models.workflow import (
    ConditionNodeConfig,
    GitHubRepositoryNodeConfig,
    GoogleDriveNodeConfig,
    GoogleDriveUpdateNodeConfig,
    ApiNodeConfig,
    LlmNodeConfig,
    NodeType,
    RepeatUntilNodeConfig,
    TransformNodeConfig,
    VariableNodeConfig,
    ResendEmailNodeConfig,
    WeatherForecastNodeConfig,
    NewsHeadlinesNodeConfig,
    GoogleSheetsAppendNodeConfig,
    CsvCreateNodeConfig,
    RssFeedNodeConfig,
    WebhookPostNodeConfig,
    HttpResponseNodeConfig,
    MongoDbNodeConfig,
    MongoVectorSearchNodeConfig,
    FileUploadNodeConfig,
    GmailSendNodeConfig,
    RedditHeadlinesNodeConfig,
    GoogleCalendarNodeConfig,
    GitHubActionNodeConfig,
    JobSearchNodeConfig,
    ErrAgentNodeConfig,
    WorkflowNode,
    normalize_template_path,
)
from ..config import get_settings

from ..services.llm import GoogleFlashModel, response_text
from ..repositories.connections import ConnectionRepository
from ..services.google_oauth import GoogleCalendarOAuth
from ..services.github_connection import GitHubConnectionService
from ..repositories.secrets import SecretRepository
from ..services.secrets import SecretService

logger = logging.getLogger(__name__)
llm = GoogleFlashModel(get_settings())

TEMPLATE_PATTERN = re.compile(r"{{\s*([a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*)\s*}}")
SKIPPED_REPOSITORY_PATHS = (".env", "secret", "credential", "node_modules/", "vendor/", ".lock", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip")


def select_repository_paths(tree: list[dict[str, Any]], max_files: int) -> list[str]:
    candidates = [item["path"] for item in tree if item.get("type") == "blob" and isinstance(item.get("path"), str) and not any(marker in item["path"].lower() for marker in SKIPPED_REPOSITORY_PATHS)]
    def priority(path: str) -> tuple[int, str]:
        name = path.lower().split("/")[-1]
        if name in {"readme.md", "package.json", "pyproject.toml", "requirements.txt", "docker-compose.yml"}: return (0, path)
        if name in {"main.py", "app.py", "index.ts", "index.tsx", "main.tsx", "server.ts"}: return (1, path)
        if any(segment in path.lower() for segment in ("/api/", "/routes/", "/services/", "/models/", "/src/")): return (2, path)
        return (3, path)
    return sorted(candidates, key=priority)[:max_files]


def read_path(context: dict[str, Any], path: str) -> Any:
    segments = normalize_template_path(path)

    value: Any = context
    for segment in segments:
        if not segment:
            continue
        
        # Handle tuple segments (key, index) for array access
        if isinstance(segment, tuple):
            key, index = segment
            if not isinstance(value, dict) or key not in value:
                return None
            value = value[key]
            if not isinstance(value, list) or index < 0 or index >= len(value):
                return None
            value = value[index]
        # Handle string segments (normal dict key access)
        else:
            if not isinstance(value, dict) or segment not in value:
                return None
            value = value[segment]
    return value


def resolve_template(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: resolve_template(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_template(item, context) for item in value]
    if not isinstance(value, str):
        return value

    full_match = TEMPLATE_PATTERN.fullmatch(value)
    if full_match:
        return read_path(context, full_match.group(1))
    return TEMPLATE_PATTERN.sub(
        lambda match: ""
        if (resolved := read_path(context, match.group(1))) is None
        else str(resolved),
        value,
    )


async def run_transform(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, TransformNodeConfig)
    result = {key: resolve_template(value, context) for key, value in config.mappings.items()}
    
    # Handle array merging
    for output_key, template_paths in config.merge_arrays.items():
        arrays = []
        for template_path in template_paths:
            resolved = resolve_template(template_path, context)
            if isinstance(resolved, list):
                arrays.extend(resolved)
            elif resolved is not None:
                arrays.append(resolved)
        result[output_key] = arrays
    
    return result


async def run_variable(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, VariableNodeConfig)
    return {config.name: resolve_template(config.value, context)}


async def run_condition(node: WorkflowNode, context: dict[str, Any]) -> str:
    config = node.typed_config()
    assert isinstance(config, ConditionNodeConfig)
    clauses = config.conditions or [{"input_path": config.input_path, "operator": config.operator, "value": config.value}]

    def evaluate(clause: dict[str, Any]) -> bool:
        candidate = read_path(context, clause["input_path"])
        operator = clause["operator"]
        expected = clause.get("value")
        if operator == "equals":
            matched = candidate == expected
        elif operator == "not_equals":
            matched = candidate != expected
        elif operator == "contains":
            if candidate is None:
                matched = False
            elif isinstance(candidate, (dict, list)):
                serialized = json.dumps(candidate, ensure_ascii=False)
                compact_serialized = json.dumps(candidate, separators=(",", ":"), ensure_ascii=False)
                expected_text = str(expected)
                normalized_expected = re.sub(r"\s+", "", expected_text)
                matched = expected_text in serialized or expected_text in compact_serialized or normalized_expected in compact_serialized
            else:
                matched = str(expected) in str(candidate)
        else:
            matched = candidate is not None
        logger.info(
            "condition evaluated node_id=%s path=%s operator=%s expected=%r candidate_type=%s matched=%s",
            node.id,
            clause["input_path"],
            operator,
            expected,
            type(candidate).__name__,
            matched,
        )
        return matched

    results = [evaluate(clause if isinstance(clause, dict) else clause.model_dump()) for clause in clauses]
    passed = all(results) if config.logic == "and" else any(results)
    return "true" if passed else "false"


async def run_repeat_until(node: WorkflowNode, context: dict[str, Any], iteration: int) -> str:
    config = node.typed_config()
    assert isinstance(config, RepeatUntilNodeConfig)
    candidate = read_path(context, config.input_path)
    passed = candidate == config.value if config.operator == "equals" else candidate is not None
    if passed:
        return "done"
    return "limit_reached" if iteration >= config.max_iterations else "continue"


async def run_llm(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, LlmNodeConfig)
    missing_paths = [
        match.group(1)
        for match in TEMPLATE_PATTERN.finditer(config.prompt)
        if read_path(context, match.group(1)) is None
    ]
    skipped_paths = []
    failed_node_ids = {
        event["node_id"]
        for event in context.get("latest_run", {}).get("trace", [])
        if event.get("status") == "failed"
    }
    workflow_node_ids = {
        item["id"]
        for item in context.get("workflow", {}).get("nodes", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    for path in missing_paths:
        segments = normalize_template_path(path)
        source_id = segments[1] if len(segments) > 1 and isinstance(segments[1], str) else None
        if source_id in workflow_node_ids and source_id not in failed_node_ids:
            skipped_paths.append(path)
    unresolved_paths = [path for path in missing_paths if path not in skipped_paths]
    if unresolved_paths:
        available_outputs = ", ".join(sorted(context.get("outputs", {}).keys())) or "none"
        raise ValueError(
            f"LLM node '{node.label}' could not resolve template reference(s): "
            + ", ".join(f"{{{{{path}}}}}" for path in unresolved_paths)
            + f". Available node outputs: {available_outputs}"
        )
    if skipped_paths:
        logger.info("LLM node skipped unavailable conditional references node_id=%s paths=%s", node.id, skipped_paths)
    prompt = resolve_template(config.prompt, context)
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("LLM node prompt must not be empty")
    logger.info("calling LLM node node_id=%s model=%s json_mode=%s", node.id, config.model, config.json_mode)
    messages = [HumanMessage(content=prompt)]
    if config.system_instructions:
        messages.insert(0, SystemMessage(content=config.system_instructions))
    response = await llm.get(config.model, config.temperature, config.max_tokens).ainvoke(messages)
    content = response_text(response.content)
    
    if config.json_mode:
        import json
        try:
            # Try to extract JSON from the response (handles markdown code blocks)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            parsed = json.loads(content)
            logger.info("LLM node completed node_id=%s (JSON mode)", node.id)
            return {config.output_key: parsed}
        except (json.JSONDecodeError, IndexError) as error:
            raise ValueError(f"LLM node '{node.label}' failed to parse JSON response: {str(error)}")
    
    logger.info("LLM node completed node_id=%s", node.id)
    return {config.output_key: content}


async def run_github_repository(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GitHubRepositoryNodeConfig)
    if not connections or not owner_id:
        raise ValueError("GitHub Repository Context requires connection storage")
    connection = await connections.get_document(config.connection_id, owner_id)
    if not connection or connection.provider != "github":
        raise ValueError("Select a valid GitHub connection for this node")
    owner, repository = resolve_template(config.owner, context), resolve_template(config.repository, context)
    if not isinstance(owner, str) or not isinstance(repository, str) or not owner or not repository:
        raise ValueError("GitHub owner and repository must resolve to text values")
    logger.info("GitHub repository resolved node_id=%s owner=%s repository=%s operation=%s", node.id, owner, repository, config.operation)
    token = await GitHubConnectionService(get_settings()).access_token(connections, config.connection_id, owner_id)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    if config.operation != "repository_context":
        query = resolve_template(config.search_query, context)
        if not isinstance(query, str):
            query = str(query)
        query = query.strip()
        if not query:
            raise ValueError("GitHub search requires a query")
        search_type = "commits" if config.operation == "search_commits" else "issues"
        qualifiers = f"repo:{owner}/{repository}"
        if config.operation == "search_pull_requests":
            qualifiers += " type:pr"
        elif config.operation == "search_issues":
            qualifiers += " type:issue"
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"https://api.github.com/search/{search_type}",
                headers=headers,
                params={"q": f"{query} {qualifiers}", "per_page": config.search_limit},
            )
        if response.status_code >= 400:
            raise ValueError(f"GitHub search failed (HTTP {response.status_code}): {response.text[:500]}")
        result = response.json()
        items = result.get("items", []) if isinstance(result, dict) else []
        return {
            config.output_key: {
                "operation": config.operation,
                "query": query,
                "total_count": result.get("total_count", len(items)) if isinstance(result, dict) else len(items),
                "items": items[:config.search_limit],
            }
        }
    requested_paths = (["README.md"] if config.include_readme else []) + config.include_paths
    async with httpx.AsyncClient(timeout=20.0) as client:
        repository_response = await client.get(f"https://api.github.com/repos/{owner}/{repository}", headers=headers)
        if repository_response.status_code != 200:
            raise ValueError(f"GitHub repository could not be read (HTTP {repository_response.status_code})")
        metadata = repository_response.json()
        if config.auto_select_files:
            tree_response = await client.get(f"https://api.github.com/repos/{owner}/{repository}/git/trees/{metadata['default_branch']}?recursive=1", headers=headers)
            if tree_response.status_code == 200:
                requested_paths.extend(select_repository_paths(tree_response.json().get("tree", []), config.max_files))
        safe_paths = [path for path in dict.fromkeys(requested_paths) if not any(marker in path.lower() for marker in SKIPPED_REPOSITORY_PATHS)][:config.max_files]
        sections = [f"Repository: {metadata.get('full_name', f'{owner}/{repository}')}\nDescription: {metadata.get('description') or ''}\nLanguage: {metadata.get('language') or ''}\nTopics: {', '.join(metadata.get('topics') or [])}"]
        remaining = config.max_chars - len(sections[0])
        for path in safe_paths:
            if remaining <= 0:
                break
            response = await client.get(f"https://api.github.com/repos/{owner}/{repository}/contents/{path}", headers=headers)
            if response.status_code != 200:
                continue
            file_data = response.json()
            if not isinstance(file_data, dict) or file_data.get("encoding") != "base64" or not isinstance(file_data.get("content"), str):
                continue
            try:
                text = base64.b64decode(file_data["content"].replace("\n", "")).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                continue
            text = text[:remaining]
            sections.append(f"\n--- {path} ---\n{text}")
            remaining -= len(text)
    logger.info("GitHub repository context completed node_id=%s files=%s", node.id, len(sections) - 1)
    return {config.output_key: "\n".join(sections)}


async def run_github_action(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GitHubActionNodeConfig)
    if not connections or not owner_id:
        raise ValueError("GitHub action requires connection storage")
    values = resolve_template({"owner": config.owner, "repository": config.repository, "issue_number": config.issue_number, "title": config.title, "body": config.body, "head": config.head, "base": config.base}, context)
    if not isinstance(values.get("owner"), str) or not values["owner"].strip():
        raise ValueError("GitHub action owner resolved to an empty value. Connect an upstream value or enter an owner.")
    if not isinstance(values.get("repository"), str) or not values["repository"].strip():
        raise ValueError("GitHub action repository resolved to an empty value. Connect an upstream value or enter a repository.")
    token = await GitHubConnectionService(get_settings()).access_token(connections, config.connection_id, owner_id)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"}
    base = f"https://api.github.com/repos/{values['owner']}/{values['repository']}"
    if config.action == "create_issue":
        url, payload = f"{base}/issues", {"title": values["title"], "body": values["body"]}
    elif config.action == "comment_issue":
        if not values.get("issue_number"): raise ValueError("GitHub issue comment requires an issue number")
        url, payload = f"{base}/issues/{values['issue_number']}/comments", {"body": values["body"]}
    else:
        url, payload = f"{base}/pulls", {"title": values["title"], "body": values["body"], "head": values["head"], "base": values["base"]}
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(url, headers=headers, json=payload)
    if response.status_code >= 400:
        raise ValueError(f"GitHub action failed (HTTP {response.status_code}): {response.text[:500]}")
    return {config.output_key: response.json()}


async def run_job_search(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, JobSearchNodeConfig)
    if not connections or not owner_id:
        raise ValueError("Job search requires an authenticated owner")
    values = resolve_template({"keywords": config.keywords, "location": config.location}, context)
    secrets = SecretRepository(connections._database)
    secret_service = SecretService(get_settings())
    settings = get_settings()
    async def secret_value(name: str | None, shared_value: str | None, label: str) -> str:
        if name:
            secret = await secrets.get(owner_id, name)
            if not secret:
                raise ValueError(f"Job search secret '{name}' was not found for this user")
            return secret_service.decrypt(secret)
        if shared_value:
            return shared_value
        raise ValueError(f"{config.provider} job search is missing {label}. Set the node secret or configure the shared environment variable.")

    async with httpx.AsyncClient(timeout=20.0) as client:
        if config.provider == "adzuna":
            app_id = await secret_value(config.app_id_secret, settings.adzuna_app_id, "ADZUNA_APP_ID")
            app_key = await secret_value(config.app_key_secret, settings.adzuna_app_key or settings.adzuna_api_key, "ADZUNA_APP_KEY or ADZUNA_API_KEY")
            params = {"app_id": app_id, "app_key": app_key, "what": values["keywords"], "where": values["location"], "results_per_page": config.limit, "distance": config.radius_miles}
            response = await client.get("https://api.adzuna.com/v1/api/jobs/us/search/1", params=params)
            payload = response.json() if response.headers.get("content-type", "").lower().find("json") >= 0 else {}
            raw_jobs = payload.get("results", [])
        else:
            api_key = await secret_value(config.api_key_secret, settings.jooble_api_key or settings.joobq_api_key, "JOOBLE_API_KEY")
            response = await client.post(f"https://jooble.org/api/{api_key}", json={"keywords": values["keywords"], "location": values["location"], "radius": config.radius_miles, "page": 1})
            payload = response.json() if response.headers.get("content-type", "").lower().find("json") >= 0 else {}
            raw_jobs = payload.get("jobs", [])
    if response.status_code >= 400:
        raise ValueError(f"{config.provider} job search failed (HTTP {response.status_code}): {response.text[:500]}")
    jobs = [{"title": item.get("title", ""), "company": (item.get("company") or {}).get("display_name", "") if isinstance(item.get("company"), dict) else item.get("company", ""), "location": (item.get("location") or {}).get("display_name", values["location"]) if isinstance(item.get("location"), dict) else item.get("location", values["location"]), "description": item.get("description", ""), "url": item.get("redirect_url") or item.get("link") or item.get("url", ""), "source": config.provider, "posted_at": item.get("created") or item.get("updated"), "salary": item.get("salary_min") or item.get("salary", None)} for item in raw_jobs[:config.limit]]
    return {config.output_key: {"provider": config.provider, "query": values, "jobs": jobs}}


async def run_erragent(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, ErrAgentNodeConfig)
    settings = get_settings()
    endpoint = resolve_template(config.endpoint or settings.erragent_api_url or "", context)
    goal = resolve_template(config.goal, context)
    incident_id = resolve_template(config.incident_id, context) if config.incident_id else None
    if not isinstance(endpoint, str) or not endpoint.strip():
        raise ValueError("ErrAgent requires an endpoint or ERRAGENT_API_URL")
    parsed_endpoint = urlparse(endpoint)
    if parsed_endpoint.hostname == "www.erragent.onrender.com":
        endpoint = urlunsplit((parsed_endpoint.scheme, "erragent.onrender.com", parsed_endpoint.path, parsed_endpoint.query, parsed_endpoint.fragment))
    if not isinstance(goal, str) or not goal.strip():
        raise ValueError("ErrAgent requires a goal")
    headers = {"Content-Type": "application/json"}
    api_key = settings.erragent_api_key
    if config.api_key_secret:
        if not connections or not owner_id:
            raise ValueError("ErrAgent secret references require connection storage")
        secret = await SecretRepository(connections._database).get(owner_id, config.api_key_secret)
        if not secret:
            raise ValueError(f"ErrAgent secret '{config.api_key_secret}' was not found for this user")
        api_key = SecretService(settings).decrypt(secret)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    logger.info(f"ErrAgent request: endpoint={endpoint}, has_api_key={bool(api_key)}, headers={list(headers.keys())}")
    available_connections: list[dict[str, Any]] = []
    available_secret_names: list[str] = []
    if connections and owner_id:
        available_connections = [
            {
                "id": item.id,
                "provider": item.provider,
                "display_name": item.display_name,
                "account_email": item.account_email,
            }
            for item in await connections.list(owner_id)
        ]
        available_secret_names = [
            item.name
            for item in await SecretRepository(connections._database).list(owner_id)
        ]
    
    # Remove additionalProperties from workflow (not supported in Gemini 3.5 Flash Developer API)
    def clean_additional_properties(obj: Any) -> Any:
        """Recursively remove additionalProperties from dict/list structures"""
        if isinstance(obj, dict):
            # Remove additionalProperties from this dict
            obj = {k: v for k, v in obj.items() if k != "additionalProperties"}
            # Recursively clean all values
            return {k: clean_additional_properties(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [clean_additional_properties(item) for item in obj]
        else:
            return obj
    
    workflow_dict = context.get("workflow")
    if workflow_dict:
        workflow_dict = clean_additional_properties(workflow_dict)
    
    latest_run = context.get("latest_run")
    if latest_run:
        latest_run = clean_additional_properties(latest_run)
    
    payload = {
        "operation": config.operation,
        "goal": goal,
        "incident_id": incident_id,
        "context": {
            "workflow_json": json.dumps(workflow_dict) if workflow_dict else None,
            "latest_run_json": json.dumps(latest_run) if latest_run else None,
            "available_node_types": context.get("available_node_types", []),
            "available_connections": available_connections,
            "available_secret_names": available_secret_names,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
            payload_str = json.dumps(payload)
            logger.info(f"ErrAgent payload contains additionalProperties: {'additionalProperties' in payload_str}")
            logger.info(f"ErrAgent payload sample: {payload_str[:300]}")
            
            response = await client.post(endpoint, headers=headers, content=payload_str.encode())
    except httpx.ConnectError as error:
        logger.error(f"ErrAgent TLS connection failed to {endpoint}")
        raise ValueError(f"ErrAgent bridge could not establish TLS connection to {endpoint}. Check the production API hostname and certificate.") from error
    
    logger.info(f"ErrAgent response: status={response.status_code}, body={response.text[:200]}")
    
    if response.status_code >= 400:
        logger.error(f"ErrAgent failed: {response.text}")
        raise ValueError(f"ErrAgent request failed (HTTP {response.status_code}): {response.text[:500]}")
    try:
        result = response.json()
    except ValueError as error:
        raise ValueError("ErrAgent returned a non-JSON response") from error
    return {config.output_key: result}


async def run_resend_email(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, ResendEmailNodeConfig)
    settings = get_settings()
    if not settings.resend_api_key:
        raise ValueError("Resend is not configured. Set RESEND_API_KEY in the backend environment.")
    values = resolve_template({"from": config.from_email, "to": config.to, "subject": config.subject, "body": config.body}, context)
    if not all(isinstance(values[key], str) and values[key].strip() for key in ("from", "to", "subject", "body")):
        raise ValueError("Resend email requires From, To, Subject, and Body")
    payload: dict[str, Any] = {
        "from": values["from"],
        "to": [address.strip() for address in values["to"].split(",") if address.strip()],
        "subject": values["subject"],
        config.body_type: values["body"],
    }
    if not payload["to"]:
        raise ValueError("Resend email requires at least one recipient")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"}, json=payload)
    if response.status_code >= 400:
        raise ValueError(f"Resend rejected the email (HTTP {response.status_code})")
    response_body = response.json()
    message_id = response_body.get("id") if isinstance(response_body, dict) else None
    logger.info(
        "Resend accepted email node_id=%s message_id=%s from=%s to=%s subject=%s",
        node.id,
        message_id,
        values["from"],
        ",".join(payload["to"]),
        values["subject"],
    )
    return {config.output_key: {
        "status_code": response.status_code,
        "message_id": message_id,
        "from": values["from"],
        "to": payload["to"],
        "subject": values["subject"],
        "body": response_body,
    }}


async def run_google_drive(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GoogleDriveNodeConfig)
    if not connections or not owner_id or not config.connection_id:
        raise ValueError("Google Drive requires a connected Google Workspace account")
    values = resolve_template({"name": config.name, "content": config.content, "folder_id": config.folder_id, "file_id": config.file_id}, context)
    if not isinstance(values["name"], str) or not values["name"].strip():
        raise ValueError("Google Drive requires a file name")
    if not isinstance(values["content"], str):
        raise ValueError("Google Drive content must resolve to text")
    connection = await connections.get_document(config.connection_id, owner_id)
    if not connection or connection.provider != "google_calendar":
        raise ValueError("Select a valid Google Workspace connection for this node")
    drive_scopes = {"https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.file"}
    if not drive_scopes.intersection(connection.scopes):
        raise ValueError("This Google connection does not have Drive permission. Disconnect it and reconnect Google Workspace, then approve Drive access.")
    token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id)
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        file_id = values.get("file_id")
        if file_id:
            target = f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media"
            response = await client.patch(target, headers={**headers, "Content-Type": config.mime_type}, content=values["content"].encode())
        else:
            metadata: dict[str, Any] = {"name": values["name"], "mimeType": config.mime_type}
            if values.get("folder_id"):
                metadata["parents"] = [values["folder_id"]]
            create_response = await client.post("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", headers={**headers, "Content-Type": "application/json"}, json=metadata)
            if create_response.status_code == 401:
                token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id, force_refresh=True)
                headers["Authorization"] = f"Bearer {token}"
                create_response = await client.post("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", headers={**headers, "Content-Type": "application/json"}, json=metadata)
            if create_response.status_code >= 400:
                detail = create_response.text[:500]
                suffix = " Reconnect Google Workspace and select the new connection." if create_response.status_code == 401 else ""
                raise ValueError(f"Google Drive file creation failed (HTTP {create_response.status_code}): {detail}{suffix}")
            file_id = create_response.json().get("id")
            response = await client.patch(f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media", headers={**headers, "Content-Type": config.mime_type}, content=values["content"].encode())
            if response.status_code == 401:
                token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id, force_refresh=True)
                headers["Authorization"] = f"Bearer {token}"
                response = await client.patch(f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media", headers={**headers, "Content-Type": config.mime_type}, content=values["content"].encode())
    if response.status_code >= 400:
        detail = response.text[:500]
        suffix = " Reconnect Google Workspace and select the new connection." if response.status_code == 401 else ""
        raise ValueError(f"Google Drive write failed (HTTP {response.status_code}): {detail}{suffix}")
    return {config.output_key: {"file_id": file_id, "name": values["name"], "status_code": response.status_code}}


async def run_google_drive_update(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GoogleDriveUpdateNodeConfig)
    if not connections or not owner_id:
        raise ValueError("Google Drive update requires a connected Google Workspace account")
    values = resolve_template({"file_id": config.file_id, "content": config.content}, context)
    connection = await connections.get_document(config.connection_id, owner_id)
    if not connection or connection.provider != "google_calendar":
        raise ValueError("Select a valid Google Workspace connection for this node")
    if not {"https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.file"}.intersection(connection.scopes):
        raise ValueError("This Google connection does not have Drive permission. Reconnect Google Workspace.")
    token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id)
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.patch(f"https://www.googleapis.com/upload/drive/v3/files/{values['file_id']}?uploadType=media", headers={"Authorization": f"Bearer {token}", "Content-Type": config.mime_type}, content=str(values["content"]).encode())
    if response.status_code >= 400:
        raise ValueError(f"Google Drive file update failed (HTTP {response.status_code}): {response.text[:500]}")
    return {config.output_key: {"file_id": values["file_id"], "status_code": response.status_code}}


async def run_public_connector(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    if isinstance(config, WeatherForecastNodeConfig):
        url, headers, output_key = "https://api.weather.gov/gridpoints/DMX/47,58/forecast", {"User-Agent": config.user_agent}, config.output_key
    elif isinstance(config, NewsHeadlinesNodeConfig):
        url, headers, output_key = f"https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage={config.limit}", {"User-Agent": config.user_agent}, config.output_key
    else:
        raise ValueError("Unsupported public connector")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers)
    content_type = response.headers.get("content-type", "").lower()
    body: Any = response.json() if "json" in content_type else response.text
    if response.status_code >= 400:
        raise ValueError(f"Public connector failed (HTTP {response.status_code}): {str(body)[:500]}")
    return {output_key: {"status_code": response.status_code, "body": body}}


async def run_reddit_headlines(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, RedditHeadlinesNodeConfig)
    subreddit = str(resolve_template(config.subreddit, context)).strip().strip("/")
    url = f"https://www.reddit.com/r/{subreddit}/{config.sort}.json?limit={config.limit}&raw_json=1"
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        response = await client.get(url, headers={"User-Agent": config.user_agent, "Accept": "application/json"})
    if response.status_code >= 400:
        raise ValueError(f"Reddit request failed (HTTP {response.status_code}): {response.text[:500]}")
    payload = response.json()
    posts = [
        {"title": item.get("data", {}).get("title", ""), "url": item.get("data", {}).get("url", ""), "permalink": f"https://www.reddit.com{item.get('data', {}).get('permalink', '')}", "score": item.get("data", {}).get("score", 0), "author": item.get("data", {}).get("author", "")}
        for item in payload.get("data", {}).get("children", [])
        if isinstance(item, dict) and item.get("kind") == "t3"
    ]
    return {config.output_key: {"subreddit": subreddit, "sort": config.sort, "posts": posts}}


async def google_token(connections: ConnectionRepository | None, connection_id: str, owner_id: str) -> tuple[str, Any]:
    if not connections or not owner_id or not connection_id:
        raise ValueError("Google connector requires a selected Google Workspace connection")
    connection = await connections.get_document(connection_id, owner_id)
    if not connection or connection.provider != "google_calendar":
        raise ValueError("Select a valid Google Workspace connection")
    token = await GoogleCalendarOAuth(get_settings()).access_token(connections, connection_id, owner_id)
    return token, connection


async def run_google_sheets_append(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GoogleSheetsAppendNodeConfig)
    values = resolve_template(config.values, context)
    token, _ = await google_token(connections, config.connection_id, owner_id or "")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{config.spreadsheet_id}/values/{config.range_name}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json={"values": [values]})
    if response.status_code >= 400:
        raise ValueError(f"Google Sheets append failed (HTTP {response.status_code}): {response.text[:500]}")
    return {config.output_key: response.json()}


async def run_csv_create(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, CsvCreateNodeConfig)
    headers = resolve_template(config.headers, context)
    rows = resolve_template(config.rows, context)
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    if headers:
        writer.writerow(headers)
    writer.writerows(rows)
    return {config.output_key: {"filename": config.filename, "content": output.getvalue(), "mime_type": "text/csv"}}


async def run_rss_feed(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, RssFeedNodeConfig)
    url = resolve_template(config.url, context)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        response = await client.get(url, headers={"User-Agent": "Circuit workflow builder/1.0"})
    if response.status_code >= 400:
        raise ValueError(f"RSS feed request failed (HTTP {response.status_code})")
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as error:
        raise ValueError("RSS feed returned invalid XML") from error
    items = []
    for item in root.findall(".//item")[:config.limit]:
        items.append({"title": item.findtext("title", ""), "link": item.findtext("link", ""), "description": item.findtext("description", ""), "published": item.findtext("pubDate", "")})
    return {config.output_key: {"url": url, "items": items}}


async def run_webhook_post(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, WebhookPostNodeConfig)
    url = resolve_template(config.url, context)
    parsed = urlparse(url)
    if parsed.hostname not in get_settings().api_allowed_hosts:
        raise ValueError(f"Webhook host '{parsed.hostname}' is not included in API_ALLOWED_HOSTS")
    headers = resolve_template(config.headers, context)
    body = resolve_template(config.body, context)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, json=body)
    content_type = response.headers.get("content-type", "").lower()
    result_body = response.json() if "json" in content_type else response.text
    if response.status_code >= 400:
        raise ValueError(f"Webhook POST failed (HTTP {response.status_code}): {str(result_body)[:500]}")
    return {config.output_key: {"status_code": response.status_code, "body": result_body}}


async def run_http_response(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, HttpResponseNodeConfig)
    body = resolve_template(config.body, context)
    headers = resolve_template(config.headers, context)
    if not isinstance(headers, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in headers.items()):
        raise ValueError("HTTP Response headers must be a string-to-string object")
    return {config.output_key: {"status_code": config.status_code, "headers": headers, "body": body}}


async def run_mongodb(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, MongoDbNodeConfig)
    settings = get_settings()
    uri = settings.mongo_workflow_uri
    if config.connection_uri_secret:
        if not connections or not owner_id:
            raise ValueError("MongoDB secret references require connection storage")
        secret = await SecretRepository(connections._database).get(owner_id, config.connection_uri_secret)
        if not secret:
            raise ValueError(f"MongoDB secret '{config.connection_uri_secret}' was not found for this user")
        uri = SecretService(settings).decrypt(secret)
    if not uri:
        raise ValueError("MongoDB requires MONGO_WORKFLOW_URI or a connection URI secret")
    values = resolve_template({"filter": config.filter, "update": config.update}, context)
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=10_000)
    try:
        collection = client[config.database_name][config.collection_name]
        if config.operation == "find":
            records = await collection.find(values["filter"]).limit(config.limit).to_list(config.limit)
            for record in records:
                record.pop("_id", None)
            result = {"operation": "find", "count": len(records), "records": records}
        else:
            if not values["update"]:
                raise ValueError("MongoDB update_one requires an update document")
            update_result = await collection.update_one(values["filter"], values["update"])
            result = {"operation": "update_one", "matched_count": update_result.matched_count, "modified_count": update_result.modified_count}
    except Exception as error:
        raise ValueError(f"MongoDB operation failed: {error}") from error
    finally:
        client.close()
    return {config.output_key: result}


def _chunk_text(document: dict[str, Any]) -> str:
    for key in ("text", "page_content", "content", "chunk", "body"):
        value = document.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return " ".join(value for value in document.values() if isinstance(value, str))


def _score_lexical_chunks(candidates: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    keywords = [word for word in re.findall(r"\w+", query.lower()) if len(word) > 2]
    if not keywords or not candidates:
        return candidates[:limit]
    texts = [_chunk_text(document).lower() for document in candidates]
    doc_count = len(candidates)
    doc_frequency = {keyword: sum(1 for text in texts if keyword in text) for keyword in keywords}
    scored: list[tuple[dict[str, Any], float]] = []
    for document, text in zip(candidates, texts):
        score = 0.0
        for keyword in keywords:
            occurrences = text.count(keyword)
            if occurrences:
                term_frequency = 1 + math.log(occurrences)
                inverse_doc_frequency = math.log(1 + (doc_count / (1 + doc_frequency.get(keyword, 0))))
                score += term_frequency * inverse_doc_frequency
        scored.append((document, score))
    scored.sort(key=lambda item: item[1], reverse=True)
    ranked = [document for document, score in scored if score > 0][:limit]
    return ranked or candidates[:limit]


def _fuse_rankings(vector_ranked: list[dict[str, Any]], lexical_ranked: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    scores: dict[int, float] = {}
    lookup: dict[int, dict[str, Any]] = {}
    for ranked in (vector_ranked, lexical_ranked):
        for rank, document in enumerate(ranked):
            key = id(document)
            lookup[key] = document
            scores[key] = scores.get(key, 0.0) + 1.0 / (60.0 + rank + 1)
    ordered = sorted(scores, key=lambda key: scores[key], reverse=True)
    return [lookup[key] for key in ordered][:limit]


async def run_mongodb_vector_search(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, MongoVectorSearchNodeConfig)
    settings = get_settings()
    uri = settings.mongo_workflow_uri
    if config.connection_uri_secret:
        if not connections or not owner_id:
            raise ValueError("MongoDB Search secret references require connection storage")
        secret = await SecretRepository(connections._database).get(owner_id, config.connection_uri_secret)
        if not secret:
            raise ValueError(f"MongoDB Search secret '{config.connection_uri_secret}' was not found for this user")
        uri = SecretService(settings).decrypt(secret)
    if not uri:
        raise ValueError("MongoDB Search requires MONGO_WORKFLOW_URI or a connection URI secret")
    if not settings.google_api_key:
        raise ValueError("MongoDB Search requires GOOGLE_API_KEY to generate query embeddings")
    query = resolve_template(config.query, context)
    if not isinstance(query, str) or not query.strip():
        raise ValueError("MongoDB Search query must resolve to non-empty text")
    filter_value = resolve_template(config.filter, context) or {}
    if not isinstance(filter_value, dict):
        raise ValueError("MongoDB Search filter must resolve to a JSON object")
    embeddings = GoogleGenerativeAIEmbeddings(model=config.embedding_model, google_api_key=settings.google_api_key, output_dimensionality=config.embedding_dimensions)
    query_vector = await asyncio.to_thread(embeddings.embed_query, query)
    fetch_limit = max(config.k, config.max_chunks)
    stage: dict[str, Any] = {
        "index": config.index_name,
        "path": config.embedding_path,
        "queryVector": query_vector,
        "numCandidates": max(100, fetch_limit * 10),
        "limit": fetch_limit,
    }
    if filter_value:
        stage["filter"] = filter_value
    pipeline = [{"$vectorSearch": stage}, {"$addFields": {"score": {"$meta": "vectorSearchScore"}}}]
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=10_000)
    try:
        collection = client[config.database_name][config.collection_name]
        try:
            raw_results = await collection.aggregate(pipeline).to_list(length=fetch_limit)
        except Exception as error:
            raise ValueError(f"MongoDB vector search failed: {error}") from error
    finally:
        client.close()
    documents: list[dict[str, Any]] = []
    for record in raw_results:
        document = dict(record)
        document.pop(config.embedding_path, None)
        if "_id" in document:
            document["_id"] = str(document["_id"])
        documents.append(document)
    if config.strategy == "lexical":
        selected = _score_lexical_chunks(documents, query, config.max_chunks)
    elif config.strategy == "hybrid":
        vector_ranked = documents[: config.k]
        lexical_ranked = _score_lexical_chunks(documents, query, config.k)
        selected = _fuse_rankings(vector_ranked, lexical_ranked, config.max_chunks)
    else:
        selected = documents[: config.max_chunks]
    logger.info(
        "MongoDB vector search completed node_id=%s strategy=%s index=%s candidates=%s selected=%s",
        node.id,
        config.strategy,
        config.index_name,
        len(documents),
        len(selected),
    )
    return {config.output_key: {"strategy": config.strategy, "query": query, "count": len(selected), "chunks": selected}}


async def run_file_upload(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, FileUploadNodeConfig)
    content = config.content
    if config.input_key:
        run_value = context["inputs"].get(config.input_key)
        if isinstance(run_value, str) and run_value.strip():
            content = run_value
    if not content.strip():
        raise ValueError(f"File Upload node '{node.label}' has no uploaded file. Open the node and upload a file, or provide '{config.input_key or 'a run input'}' when running the workflow.")
    if not config.parse_json:
        return {config.output_key: {"filename": config.filename, "text": content}}
    try:
        data = json.loads(content)
    except json.JSONDecodeError as error:
        raise ValueError(f"File Upload node '{node.label}' could not parse '{config.filename or 'the uploaded file'}' as JSON: {error}") from error
    return {config.output_key: {"filename": config.filename, "data": data}}


async def run_gmail_send(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GmailSendNodeConfig)
    token, connection = await google_token(connections, config.connection_id, owner_id or "")
    values = resolve_template({"to": config.to, "subject": config.subject, "body": config.body}, context)
    if not all(isinstance(values[key], str) and values[key].strip() for key in ("to", "subject", "body")):
        raise ValueError("Gmail send requires To, Subject, and Body")
    raw_message = f"To: {values['to']}\r\nSubject: {values['subject']}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{values['body']}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", headers={"Authorization": f"Bearer {token}"}, json={"raw": base64.urlsafe_b64encode(raw_message.encode()).decode().rstrip("=")})
    if response.status_code >= 400:
        raise ValueError(f"Gmail send failed (HTTP {response.status_code}): {response.text[:500]}")
    return {config.output_key: response.json()}


async def run_google_calendar(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None, owner_id: str | None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, GoogleCalendarNodeConfig)
    token, connection = await google_token(connections, config.connection_id, owner_id or "")
    values = resolve_template({"calendar_id": config.calendar_id, "event_id": config.event_id, "time_min": config.time_min, "time_max": config.time_max, "event": config.event}, context)
    base = f"https://www.googleapis.com/calendar/v3/calendars/{values['calendar_id']}/events"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if config.operation == "list":
        params = {"maxResults": config.max_results, "singleEvents": "true", "orderBy": "startTime"}
        if values.get("time_min"): params["timeMin"] = values["time_min"]
        if values.get("time_max"): params["timeMax"] = values["time_max"]
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(base, headers=headers, params=params)
    else:
        if not values.get("event_id") and config.operation == "update":
            raise ValueError("Google Calendar update requires an event ID")
        if not isinstance(values.get("event"), dict) or not values["event"]:
            raise ValueError("Google Calendar create/update requires an event JSON object")
        method = "post" if config.operation == "create" else "patch"
        url = base if config.operation == "create" else f"{base}/{values['event_id']}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await getattr(client, method)(url, headers=headers, json=values["event"])
    if response.status_code == 401:
        token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id or "", force_refresh=True)
        headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            if config.operation == "list":
                response = await client.get(base, headers=headers, params=params)
            else:
                response = await getattr(client, method)(url, headers=headers, json=values["event"])
    if response.status_code >= 400:
        raise ValueError(f"Google Calendar {config.operation} failed (HTTP {response.status_code}): {response.text[:500]}")
    return {config.output_key: response.json()}


async def run_api(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None = None, owner_id: str | None = None) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, ApiNodeConfig)
    url = resolve_template(config.url, context)
    parsed_url = urlparse(url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
        raise ValueError("API node URL must be an absolute HTTP or HTTPS URL")

    allowed_hosts = get_settings().api_allowed_hosts
    if parsed_url.hostname not in allowed_hosts:
        raise ValueError(f"API node host '{parsed_url.hostname}' is not included in API_ALLOWED_HOSTS")

    if parsed_url.hostname == "www.googleapis.com" and "/calendar/" in parsed_url.path and not config.connection_id:
        raise ValueError("Google Calendar requires a selected Google Workspace connection. Open the node inspector and choose your account.")

    headers = resolve_template(config.headers, context)
    if config.api_key_secret:
        if not owner_id or not config.api_key_query_param and not config.api_key_header:
            raise ValueError("API key connector requires an owner and a query parameter or header name")
        if not owner_id:
            raise ValueError("API key connector requires an authenticated owner")
        secret = await SecretRepository(connections._database).get(owner_id, config.api_key_secret) if connections else None
        if not secret:
            raise ValueError(f"API key secret '{config.api_key_secret}' was not found for this user")
        api_key = SecretService(get_settings()).decrypt(secret)
        if config.api_key_query_param:
            from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
            parts = urlsplit(url)
            query = dict(parse_qsl(parts.query, keep_blank_values=True))
            query[config.api_key_query_param] = api_key
            url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
        if config.api_key_header:
            headers[config.api_key_header] = api_key
    google_connection = None
    if config.connection_id:
        if not connections or not owner_id:
            raise ValueError("Connection-backed API nodes require connection storage")
        connection = await connections.get_document(config.connection_id, owner_id)
        if not connection:
            raise ValueError("Selected API connection was not found")
        google_connection = connection if connection.provider == "google_calendar" else None
        token = await (GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id) if google_connection else GitHubConnectionService(get_settings()).access_token(connections, config.connection_id, owner_id))
        headers["Authorization"] = f"Bearer {token}"
    body = resolve_template(config.body, context)
    if config.gmail_message:
        message = resolve_template(config.gmail_message, context)
        required_fields = {"to", "subject", "body"}
        if not required_fields.issubset(message) or not all(message[field] for field in required_fields):
            raise ValueError("Gmail message requires To, Subject, and Body")
        raw_message = f"To: {message['to']}\r\nSubject: {message['subject']}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{message['body']}"
        body = {"raw": base64.urlsafe_b64encode(raw_message.encode()).decode().rstrip("=")}
    logger.info("calling API node node_id=%s host=%s method=%s", node.id, parsed_url.hostname, config.method)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        response = await client.request(
            config.method,
            url,
            headers=headers,
            json=body,
        )
        if response.status_code == 401 and google_connection:
            token = await GoogleCalendarOAuth(get_settings()).access_token(connections, config.connection_id, owner_id, force_refresh=True)
            response = await client.request(config.method, url, headers={**headers, "Authorization": f"Bearer {token}"}, json=body)
    content_type = response.headers.get("content-type", "").lower()
    body: Any = response.json() if "json" in content_type else response.text
    if response.status_code == 401 and google_connection:
        raise ValueError("Google authorization was rejected after a token refresh. Reconnect Google Workspace and select the new connection.")
    logger.info("API node completed node_id=%s status_code=%s", node.id, response.status_code)
    return {config.output_key: {"status_code": response.status_code, "body": body}}


async def run_node(node: WorkflowNode, context: dict[str, Any], connections: ConnectionRepository | None = None, owner_id: str | None = None) -> dict[str, Any]:
    logger.debug("running node node_id=%s node_type=%s", node.id, node.type)
    if node.type == NodeType.TRANSFORM:
        return await run_transform(node, context)
    if node.type == NodeType.VARIABLE:
        return await run_variable(node, context)
    if node.type == NodeType.CONDITION:
        return {"__branch__": await run_condition(node, context)}
    if node.type == NodeType.LLM:
        return await run_llm(node, context)
    if node.type == NodeType.GITHUB_REPOSITORY:
        return await run_github_repository(node, context, connections, owner_id)
    if node.type == NodeType.GITHUB_ACTION:
        return await run_github_action(node, context, connections, owner_id)
    if node.type == NodeType.JOB_SEARCH:
        return await run_job_search(node, context, connections, owner_id)
    if node.type == NodeType.ERRAGENT:
        return await run_erragent(node, context, connections, owner_id)
    if node.type == NodeType.RESEND_EMAIL:
        return await run_resend_email(node, context)
    if node.type == NodeType.GOOGLE_DRIVE:
        return await run_google_drive(node, context, connections, owner_id)
    if node.type == NodeType.GOOGLE_DRIVE_UPDATE:
        return await run_google_drive_update(node, context, connections, owner_id)
    if node.type in {NodeType.WEATHER_FORECAST, NodeType.NEWS_HEADLINES}:
        return await run_public_connector(node, context)
    if node.type == NodeType.GOOGLE_SHEETS_APPEND:
        return await run_google_sheets_append(node, context, connections, owner_id)
    if node.type == NodeType.CSV_CREATE:
        return await run_csv_create(node, context)
    if node.type == NodeType.RSS_FEED:
        return await run_rss_feed(node, context)
    if node.type == NodeType.WEBHOOK_POST:
        return await run_webhook_post(node, context)
    if node.type == NodeType.HTTP_RESPONSE:
        return await run_http_response(node, context)
    if node.type == NodeType.MONGODB:
        return await run_mongodb(node, context, connections, owner_id)
    if node.type == NodeType.MONGODB_VECTOR_SEARCH:
        return await run_mongodb_vector_search(node, context, connections, owner_id)
    if node.type == NodeType.FILE_UPLOAD:
        return await run_file_upload(node, context)
    if node.type == NodeType.GMAIL_SEND:
        return await run_gmail_send(node, context, connections, owner_id)
    if node.type == NodeType.REDDIT_HEADLINES:
        return await run_reddit_headlines(node, context)
    if node.type == NodeType.GOOGLE_CALENDAR:
        return await run_google_calendar(node, context, connections, owner_id)
    if node.type == NodeType.API:
        return await run_api(node, context, connections, owner_id)
    raise ValueError(f"Unsupported node type: {node.type}")