"""Jira integration routes: connect and create bugs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.jira_client import JiraClient
from routers.deps import get_current_user

router = APIRouter()


class JiraConnectRequest(BaseModel):
    """Credentials for connecting to Jira Cloud."""

    jira_url: str
    email: str
    api_token: str


class JiraCreateBugRequest(BaseModel):
    """Payload for creating a Jira bug issue."""

    jira_url: str
    email: str
    api_token: str
    project_key: str
    summary: str
    description: str


@router.post("/connect")
async def connect(body: JiraConnectRequest, user=Depends(get_current_user)):
    """Test Jira connection and return available projects."""
    try:
        client = JiraClient(body.jira_url, body.email, body.api_token)
        projects = client.list_projects()
        return {"projects": projects}
    except ConnectionError as e:
        raise HTTPException(400, str(e))


@router.post("/create-bug")
async def create_bug(body: JiraCreateBugRequest, user=Depends(get_current_user)):
    """Create a Bug issue in Jira and return the issue key and URL."""
    try:
        client = JiraClient(body.jira_url, body.email, body.api_token)
        result = client.create_bug(body.project_key, body.summary, body.description)
        return result
    except ConnectionError as e:
        raise HTTPException(400, str(e))
