"""Authentication routes: login, register, list users, who-am-I."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import settings
from core import notifications, user_auth
from routers.deps import get_admin_user, get_current_user

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
    # Best-effort fan-out: surface this signup as an in-app notification
    # to every existing admin. Any storage failure is swallowed so a
    # blip in Firestore / disk never blocks the user from completing
    # registration.
    try:
        notifications.notify_user_registered(user)
    except Exception:
        pass
    token = user_auth.create_access_token(
        {"sub": user["username"]},
        settings.JWT_SECRET,
        settings.JWT_ALGORITHM,
        settings.JWT_EXPIRE_MINUTES,
    )
    return TokenResponse(access_token=token, user=user)


@router.get("/users")
async def list_users(_admin: dict = Depends(get_admin_user)):
    """Return all registered usernames.

    Locked behind the admin guard — non-admins get a 403. The legacy
    pre-admin behaviour (anyone could list usernames) was a privacy
    leak; the admin panel uses ``GET /api/admin/users`` for the
    full per-user metadata, this endpoint stays for any tools that
    only need the lite list.
    """
    return {"users": user_auth.list_usernames()}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    """Return the current user's public profile (incl. admin metadata).

    The frontend calls this from ``AuthContext.refreshUser()`` so it
    can pick up admin/visibility/access changes (made via the admin
    panel) without forcing the user to log out and back in.
    """
    return {"user": user}
