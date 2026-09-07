from fastapi import Request

from .database import Database


def get_database(request: Request) -> Database:
    return request.app.state.database