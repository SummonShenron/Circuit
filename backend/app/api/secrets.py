from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth import get_current_user_id
from app.config import get_settings
from app.database import Database
from app.main_dependencies import get_database
from app.models.secret import Secret, SecretCreate
from app.repositories.secrets import SecretRepository
from app.services.secrets import SecretService

router = APIRouter(prefix="/secrets", tags=["secrets"])
DatabaseDependency = Annotated[Database, Depends(get_database)]
UserDependency = Annotated[str, Depends(get_current_user_id)]


def repository(database: DatabaseDependency) -> SecretRepository:
    if not database.configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MongoDB is not configured")
    return SecretRepository(database)


RepositoryDependency = Annotated[SecretRepository, Depends(repository)]


@router.get("", response_model=list[Secret])
async def list_secrets(secrets: RepositoryDependency, user_id: UserDependency) -> list[Secret]:
    return await secrets.list(user_id)


@router.put("/{name}", response_model=Secret)
async def save_secret(name: str, payload: SecretCreate, secrets: RepositoryDependency, user_id: UserDependency) -> Secret:
    if name != payload.name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Secret name in the URL must match the payload")
    try:
        return await SecretService(get_settings()).save(secrets, user_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_secret(name: str, secrets: RepositoryDependency, user_id: UserDependency) -> Response:
    if not await secrets.delete(user_id, name):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
