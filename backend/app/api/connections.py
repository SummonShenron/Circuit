from typing import Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from app.config import get_settings
from app.auth import get_current_user_id
from app.database import Database
from app.main_dependencies import get_database
from app.models.connection import Connection, GitHubConnectionCreate, GoogleAuthorizationStart
from app.repositories.connections import ConnectionRepository
from app.services.google_oauth import GoogleCalendarOAuth
from app.services.github_connection import GitHubConnectionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/connections", tags=["connections"])
DatabaseDependency = Annotated[Database, Depends(get_database)]
UserDependency = Annotated[str, Depends(get_current_user_id)]


def repository(database: DatabaseDependency) -> ConnectionRepository:
    if not database.configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MongoDB is not configured")
    return ConnectionRepository(database)


RepositoryDependency = Annotated[ConnectionRepository, Depends(repository)]


@router.post("/google/start", response_model=GoogleAuthorizationStart)
async def start_google_connection(request: Request, connections: RepositoryDependency, user_id: UserDependency) -> GoogleAuthorizationStart:
    try:
        url, state, code_verifier = GoogleCalendarOAuth(get_settings()).authorization_url()
        return_to = request.query_params.get("return_to")
        if return_to:
            parsed = urlparse(return_to)
            if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost"}:
                raise ValueError("OAuth return target must be a local application URL")
        await connections.create_pending(state, user_id, code_verifier, return_to)
        return GoogleAuthorizationStart(authorization_url=url)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@router.get("/google/callback")
async def google_callback(request: Request, state: str, connections: RepositoryDependency):
    owner_id = await connections.get_pending_owner(state)
    if not owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state")
    if not await connections.has_pending(state, owner_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state")
    return_to = await connections.get_pending_return_to(state, owner_id)
    oauth_error = request.query_params.get("error")
    if oauth_error:
        await connections.consume_pending(state, owner_id)
        target = return_to or "http://127.0.0.1:8090/"
        parsed = urlparse(target)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query["connection_error"] = "Google authorization was cancelled."
        return RedirectResponse(urlunparse(parsed._replace(query=urlencode(query))))
    try:
        code_verifier = await connections.get_pending_verifier(state, owner_id)
        if not code_verifier:
            raise ValueError("OAuth verifier is missing. Start the connection again.")
        connection = GoogleCalendarOAuth(get_settings()).build_connection(str(request.url), state, owner_id, code_verifier)
        await connections.create(connection)
        await connections.consume_pending(state, owner_id)
    except Exception as error:
        logger.exception("Google Calendar OAuth callback failed error_type=%s", type(error).__name__)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google authorization could not be completed. Start the connection again.") from error
    target = return_to or "http://127.0.0.1:8090/"
    parsed = urlparse(target)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["connection"] = "google_calendar"
    return RedirectResponse(urlunparse(parsed._replace(query=urlencode(query))))


@router.post("/github", response_model=Connection, status_code=status.HTTP_201_CREATED)
async def create_github_connection(payload: GitHubConnectionCreate, connections: RepositoryDependency, user_id: UserDependency) -> Connection:
    try:
        connection = await GitHubConnectionService(get_settings()).create(payload.token, payload.display_name, user_id)
        return await connections.create(connection)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.get("", response_model=list[Connection])
async def list_connections(connections: RepositoryDependency, user_id: UserDependency) -> list[Connection]:
    return await connections.list(user_id)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(connection_id: str, connections: RepositoryDependency, user_id: UserDependency) -> None:
    connection = await connections.get_document(connection_id, user_id)
    if connection and connection.provider == "google_calendar":
        try:
            await GoogleCalendarOAuth(get_settings()).revoke(connection)
        except Exception:
            logger.warning("Google token revocation failed during disconnect", exc_info=True)
    if not await connections.delete(connection_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")