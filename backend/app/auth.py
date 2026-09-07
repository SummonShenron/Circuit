from functools import lru_cache
import logging

import jwt
from fastapi import Header, HTTPException, status

from app.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def clerk_jwks(issuer: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{issuer.rstrip('/')}/.well-known/jwks.json")


async def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    settings = get_settings()
    if not settings.clerk_issuer:
        return settings.dev_user_id
    if not authorization or not authorization.startswith("Bearer "):
        logger.warning("Clerk authentication rejected request: missing bearer token")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A Clerk session token is required")
    token = authorization.removeprefix("Bearer ")
    try:
        signing_key = clerk_jwks(settings.clerk_issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            leeway=settings.clerk_clock_skew_seconds,
        )
    except jwt.PyJWTError as error:
        logger.warning("Clerk authentication rejected request: invalid session token (%s)", type(error).__name__)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Clerk session token") from error
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        logger.warning("Clerk authentication rejected request: token has no subject")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Clerk token has no user identity")
    return subject