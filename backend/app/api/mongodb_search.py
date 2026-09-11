from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import get_current_user_id
from ..config import get_settings
from ..services.shared_search_index import ensure_shared_search_index

router = APIRouter(prefix="/mongodb-search", tags=["mongodb-search"])
UserDependency = Annotated[str, Depends(get_current_user_id)]


@router.post("/shared-index")
async def create_shared_index(_: UserDependency) -> dict[str, Any]:
    """Seed Circuit's shared knowledge base index so any user can select it without their own Mongo index."""
    try:
        return await ensure_shared_search_index(get_settings())
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
