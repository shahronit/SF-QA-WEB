"""Salesforce org connection and metadata fetching routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.sf_org_fetcher import (
    LOGIN_CUSTOM,
    LOGIN_PRODUCTION,
    LOGIN_SANDBOX,
    SFOrgFetcher,
)
from routers.deps import get_current_user

router = APIRouter()


class SFLoginRequest(BaseModel):
    """Credentials for Salesforce org login."""

    username: str
    password: str
    security_token: str = ""
    login_type: str = LOGIN_SANDBOX
    custom_domain: str = ""


@router.post("/login")
async def sf_login(body: SFLoginRequest, user=Depends(get_current_user)):
    """Authenticate to a Salesforce org and return metadata summary."""
    try:
        fetcher = SFOrgFetcher(
            username=body.username,
            password=body.password,
            security_token=body.security_token,
            login_type=body.login_type,
            custom_domain=body.custom_domain,
        )
        summary = fetcher.fetch_summary()
        return {
            "summary": summary,
            "org_label": fetcher.org_label(),
            "is_sandbox": fetcher.is_sandbox(),
            "instance_url": fetcher.instance_url,
        }
    except ConnectionError as e:
        raise HTTPException(400, str(e))
