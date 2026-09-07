import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pymongo import ReturnDocument
from dotenv import dotenv_values

from app.database import Database
from app.repositories.connections import ConnectionRepository
from app.repositories.workflows import WorkflowRepository
from app.repositories.workflow_runs import WorkflowRunRepository
from app.repositories.secrets import SecretRepository
from app.services.secrets import SecretService
from app.config import get_settings
from app.services.workflow_engine import run_workflow
from app.models.workflow import NodeType, ScheduleNodeConfig

logger = logging.getLogger(__name__)
SCHEDULER_TICK_SECONDS = 15
INTERVALS = {"5_minutes": timedelta(minutes=5), "hourly": timedelta(hours=1), "daily": timedelta(days=1), "weekly": timedelta(weeks=1)}
ENV_REFERENCE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{2,127}$")
LOCAL_ENV = dotenv_values(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env"))


def schedule_key(config: ScheduleNodeConfig) -> str:
    return "|".join([
        config.interval,
        config.time_of_day or "",
        config.timezone,
        ",".join(str(day) for day in config.days_of_week),
        str(config.weeks_interval),
    ])


def next_scheduled_run(now: datetime, config: ScheduleNodeConfig, previous: datetime | None = None) -> datetime:
    """Return the next UTC run for a specific local wall-clock schedule."""
    try:
        local_zone = ZoneInfo(config.timezone)
    except ZoneInfoNotFoundError as error:
        raise ValueError(f"Unknown schedule timezone '{config.timezone}'") from error
    local_now = now.astimezone(local_zone)
    hour, minute = (int(part) for part in config.time_of_day.split(":"))
    candidate = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    allowed_days = set(config.days_of_week)
    if config.interval == "weekly" and not allowed_days:
        allowed_days = {local_now.weekday()}
    if config.interval == "daily":
        if candidate <= local_now:
            candidate += timedelta(days=1)
    else:
        for offset in range(0, 8 * max(config.weeks_interval, 1)):
            possible = candidate + timedelta(days=offset)
            if possible > local_now and possible.weekday() in allowed_days:
                candidate = possible
                break
    if previous is not None:
        while candidate.astimezone(timezone.utc) <= previous.astimezone(timezone.utc):
            candidate += timedelta(days=7 if config.interval == "weekly" else 1)
    return candidate.astimezone(timezone.utc)


def resolve_scheduled_inputs(value, secret_service: SecretService | None = None, secret_repository: SecretRepository | None = None, owner_id: str | None = None):
    """Resolve explicit environment references without persisting or logging secrets."""
    if isinstance(value, dict):
        if set(value) == {"$env"}:
            name = value["$env"]
            if not isinstance(name, str) or not ENV_REFERENCE_PATTERN.fullmatch(name):
                raise ValueError("Scheduled environment references must use uppercase variable names")
            resolved = os.environ.get(name) or LOCAL_ENV.get(name)
            if not resolved:
                raise ValueError(f"Scheduled workflow secret '{name}' is not configured")
            return resolved
        if set(value) == {"$secret"}:
            return value
        return {key: resolve_scheduled_inputs(item, secret_service, secret_repository, owner_id) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_scheduled_inputs(item, secret_service, secret_repository, owner_id) for item in value]
    return value


async def resolve_scheduled_inputs_for_owner(value, owner_id: str, secret_service: SecretService, secret_repository: SecretRepository):
    if isinstance(value, dict) and set(value) == {"$secret"}:
        name = value["$secret"]
        if not isinstance(name, str) or not ENV_REFERENCE_PATTERN.fullmatch(name):
            raise ValueError("Scheduled secret references must use valid secret names")
        secret = await secret_repository.get(owner_id, name)
        if not secret:
            raise ValueError(f"Scheduled workflow secret '{name}' is not configured for this user")
        return secret_service.decrypt(secret)
    if isinstance(value, dict):
        return {key: await resolve_scheduled_inputs_for_owner(item, owner_id, secret_service, secret_repository) for key, item in value.items()}
    if isinstance(value, list):
        return [await resolve_scheduled_inputs_for_owner(item, owner_id, secret_service, secret_repository) for item in value]
    return value


def schedule_config(workflow):
    for node in workflow.graph.nodes:
        if node.type == NodeType.SCHEDULE:
            config = node.typed_config()
            if isinstance(config, ScheduleNodeConfig) and config.enabled:
                return config
    return None


async def run_scheduler(database: Database) -> None:
    if not database.configured:
        logger.warning("workflow scheduler disabled because MongoDB is not configured")
        return
    workflows = WorkflowRepository(database)
    run_history = WorkflowRunRepository(database)
    connections = ConnectionRepository(database)
    secrets = SecretRepository(database)
    secret_service = SecretService(get_settings())
    logger.info("workflow scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        for workflow in await workflows.list_scheduled():
            config = schedule_config(workflow)
            if not config:
                continue
            if config.trigger_mode != "schedule":
                continue
            if config.days_of_week and not config.time_of_day and now.weekday() not in config.days_of_week:
                continue
            interval = INTERVALS[config.interval]
            if config.interval == "weekly":
                interval = timedelta(weeks=config.weeks_interval)
            specific_time = bool(config.time_of_day)
            key = schedule_key(config)
            existing = await database.database.workflow_schedules.find_one({"workflow_id": workflow.id, "owner_id": workflow.owner_id})
            if specific_time:
                existing_next = existing.get("next_run_at") if existing else None
                if not existing or existing.get("schedule_key") != key:
                    next_run = next_scheduled_run(now, config)
                    await database.database.workflow_schedules.update_one(
                        {"workflow_id": workflow.id, "owner_id": workflow.owner_id},
                        {"$set": {"next_run_at": next_run, "schedule_key": key, "updated_at": now}, "$setOnInsert": {"workflow_id": workflow.id, "owner_id": workflow.owner_id}},
                        upsert=True,
                    )
                else:
                    next_run = existing_next or next_scheduled_run(now, config)
            else:
                next_run = now + interval
            await database.database.workflow_schedules.update_one(
                {"workflow_id": workflow.id},
                {"$setOnInsert": {"workflow_id": workflow.id, "owner_id": workflow.owner_id, "next_run_at": next_run, "schedule_key": key, "updated_at": now}},
                upsert=True,
            )
            next_after_claim = next_scheduled_run(now, config, now) if specific_time else now + interval
            claim = await database.database.workflow_schedules.find_one_and_update(
                {"workflow_id": workflow.id, "owner_id": workflow.owner_id, "next_run_at": {"$lte": now}},
                {"$set": {"next_run_at": next_after_claim, "last_started_at": now, "schedule_key": key, "updated_at": now}},
                return_document=ReturnDocument.AFTER,
            )
            if claim:
                logger.info("starting scheduled workflow workflow_id=%s interval=%s", workflow.id, config.interval)
                try:
                    inputs = resolve_scheduled_inputs(config.input_values)
                    inputs = await resolve_scheduled_inputs_for_owner(inputs, workflow.owner_id, secret_service, secrets)
                    started_at = datetime.now(timezone.utc)
                    result = await run_workflow(workflow, inputs, connections, workflow.owner_id)
                    await run_history.record(workflow.id, workflow.owner_id, result, started_at, "schedule")
                except Exception:
                    logger.exception("scheduled workflow failed workflow_id=%s", workflow.id)
        await asyncio.sleep(SCHEDULER_TICK_SECONDS)