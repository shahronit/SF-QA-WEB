"""Authentication routes: login, register, list users."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings
from core import user_auth

router = APIRouter()


class LoginRequest(BaseModel):
    """Credentials for login."""

    username: str
    password: str


class RegisterRequest(BaseModel):
    """Fields for new user registration."""

    username: str
    display_name: str = ""
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""

    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    """Authenticate and return a JWT."""
    user = user_auth.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(401, "Invalid credentials")
    token = user_auth.create_access_token(
        {"sub": user["username"]},
        settings.JWT_SECRET,
        settings.JWT_ALGORITHM,
        settings.JWT_EXPIRE_MINUTES,
    )
    return TokenResponse(access_token=token, user=user)


@router.post("/register", response_model=TokenResponse)
async def register(body: RegisterRequest):
    """Create a new user and return a JWT."""
    if not user_auth.register(body.username, body.display_name, body.password):
        raise HTTPException(400, "Username taken or invalid")
    user = user_auth.authenticate(body.username, body.password)
    token = user_auth.create_access_token(
        {"sub": user["username"]},
        settings.JWT_SECRET,
        settings.JWT_ALGORITHM,
        settings.JWT_EXPIRE_MINUTES,
    )
    return TokenResponse(access_token=token, user=user)


@router.get("/users")
async def list_users():
    """Return all registered usernames."""
    return {"users": user_auth.list_usernames()}
