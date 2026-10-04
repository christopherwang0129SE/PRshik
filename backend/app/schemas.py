"""Pydantic models for the Sentinel API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """Analyze conflict risk across branches of a repo.

    Provide either a local `repo_path` or a `repo_url` to clone.
    """

    repo_path: str | None = Field(None, description="Absolute path to a local git repo.")
    repo_url: str | None = Field(None, description="Git URL to clone (https).")
    base_branch: str | None = Field(None, description="Integration branch (default: main).")
    branches: list[str] | None = Field(
        None, description="Branches to compare. Defaults to all non-base local branches."
    )


class ChangedFile(BaseModel):
    path: str
    added_lines: int
    removed_lines: int
    # Changed line ranges on the *new* side, as (start, end) inclusive.
    hunks: list[tuple[int, int]]


class BranchDiff(BaseModel):
    branch: str
    base: str
    merge_base: str | None
    ahead: int
    files: list[ChangedFile]


class FileCollision(BaseModel):
    path: str
    # Whether changed regions actually overlap/are adjacent (true conflict risk),
    # vs. merely touching the same file.
    overlapping: bool
    branch_a_hunks: list[tuple[int, int]]
    branch_b_hunks: list[tuple[int, int]]


RiskLevel = Literal["none", "low", "medium", "high"]


class PairRisk(BaseModel):
    branch_a: str
    branch_b: str
    score: float = Field(ge=0, le=100)
    level: RiskLevel
    shared_files: int
    overlapping_files: int
    collisions: list[FileCollision]
    rationale: str


class AnalyzeResponse(BaseModel):
    base_branch: str
    branches: list[str]
    diffs: list[BranchDiff]
    pairs: list[PairRisk]


class GitHubPullRequest(BaseModel):
    number: int
    title: str
    author: str
    url: str
    head_branch: str
    base_branch: str
    updated_at: str


class GitHubPullRequestSyncResponse(BaseModel):
    repository: str
    pull_requests: list[GitHubPullRequest]
    analysis: AnalyzeResponse
