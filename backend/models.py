"""Pydantic request schemas."""
from typing import Literal, Optional
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    title: str = Field(default="Untitled meeting", max_length=200)
    meeting_date: Optional[str] = Field(default=None, description="YYYY-MM-DD; defaults to today")
    transcript: str = Field(min_length=10, max_length=60000)


class ActionUpdate(BaseModel):
    task: Optional[str] = None
    owner: Optional[str] = None
    deadline: Optional[str] = None
    priority: Optional[Literal["low", "medium", "high"]] = None
    status: Optional[Literal["approved", "rejected", "pending"]] = None


class ConflictResolution(BaseModel):
    resolution: Literal["adopt_new", "keep_old", "dismiss"]


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
