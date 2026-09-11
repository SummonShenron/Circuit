from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Database
from .logging_config import configure_logging
from .services.scheduler import run_scheduler

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = Database(settings)
    app.state.database = database
    logger.info("application startup")
    await database.connect()
    scheduler_task = asyncio.create_task(run_scheduler(database))
    yield
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        logger.info("workflow scheduler stopped")
    await database.close()
    logger.info("application shutdown")


settings = get_settings()
configure_logging(settings.log_level)
app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .api.workflows import router as workflows_router
from .api.connections import router as connections_router
from .api.secrets import router as secrets_router
from .api.mongodb_search import router as mongodb_search_router

app.include_router(workflows_router, prefix=settings.api_prefix)
app.include_router(connections_router, prefix=settings.api_prefix)
app.include_router(secrets_router, prefix=settings.api_prefix)
app.include_router(mongodb_search_router, prefix=settings.api_prefix)


@app.get("/health")
async def health_check() -> dict[str, str]:
    logger.debug("health check requested")
    return {"status": "ok"}