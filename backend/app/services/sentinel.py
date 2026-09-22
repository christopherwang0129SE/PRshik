"""Sentinel — predicts merge-conflict risk between in-flight branches.

Given a repo and a set of branches, each branch is diffed against the merge-base
with the integration branch. For every branch *pair* we look at the files both
touch, and within those files whether their changed line-ranges overlap or sit
close together. That yields a 0-100 risk score with an explainable rationale.

This is intentionally dependency-free (pure git). Symbol/AST-level overlap is a
planned upgrade that plugs into `_file_collision`.
"""
from __future__ import annotations

from itertools import combinations
from pathlib import Path

from app.schemas import (
    AnalyzeResponse,
    BranchDiff,
    ChangedFile,
    FileCollision,
    PairRisk,
    RiskLevel,
)
from app.services import git_service

# Two changed regions within this many lines of each other are treated as
# colliding — git conflicts arise from adjacency, not just exact overlap.
ADJACENCY_LINES = 3


def _ranges_collide(a: tuple[int, int], b: tuple[int, int], pad: int = ADJACENCY_LINES) -> bool:
    return a[0] - pad <= b[1] and b[0] - pad <= a[1]


def _hunks_collide(
    a_hunks: list[tuple[int, int]], b_hunks: list[tuple[int, int]]
) -> bool:
    return any(_ranges_collide(a, b) for a in a_hunks for b in b_hunks)


def _file_collision(a: ChangedFile, b: ChangedFile) -> FileCollision:
    return FileCollision(
        path=a.path,
        overlapping=_hunks_collide(a.hunks, b.hunks),
        branch_a_hunks=a.hunks,
        branch_b_hunks=b.hunks,
    )


def _level(score: float) -> RiskLevel:
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    if score > 0:
        return "low"
    return "none"


def _score_pair(diff_a: BranchDiff, diff_b: BranchDiff) -> PairRisk:
    files_a = {f.path: f for f in diff_a.files}
    files_b = {f.path: f for f in diff_b.files}
    shared = sorted(set(files_a) & set(files_b))

    collisions: list[FileCollision] = []
    overlapping = 0
    for path in shared:
        col = _file_collision(files_a[path], files_b[path])
        collisions.append(col)
        if col.overlapping:
            overlapping += 1

    # Scoring: touching the same file is a warning; overlapping regions are the
    # real risk. Overlaps dominate; shared-but-disjoint files add a smaller base.
    score = 0.0
    if shared:
        score += 25.0 * (1 - 0.6 ** len(shared))  # up to ~25 from shared files
    if overlapping:
        score += 75.0 * (1 - 0.5 ** overlapping)  # up to ~75 from real overlaps
    score = round(min(score, 100.0), 1)

    if overlapping:
        rationale = (
            f"{overlapping} file(s) changed in overlapping regions by both branches — "
            f"a textual merge conflict is likely."
        )
    elif shared:
        rationale = (
            f"{len(shared)} shared file(s) but no overlapping regions — "
            f"merges cleanly today, but coordinate before divergence grows."
        )
    else:
        rationale = "No shared files — these branches are independent."

    return PairRisk(
        branch_a=diff_a.branch,
        branch_b=diff_b.branch,
        score=score,
        level=_level(score),
        shared_files=len(shared),
        overlapping_files=overlapping,
        collisions=[c for c in collisions if c.overlapping] or collisions,
        rationale=rationale,
    )


def analyze(
    repo: Path,
    base_branch: str,
    branches: list[str],
) -> AnalyzeResponse:
    diffs = [git_service.diff_against_base(repo, b, base_branch) for b in branches]
    diff_by_branch = {d.branch: d for d in diffs}

    pairs: list[PairRisk] = []
    for a, b in combinations(branches, 2):
        pairs.append(_score_pair(diff_by_branch[a], diff_by_branch[b]))
    pairs.sort(key=lambda p: p.score, reverse=True)

    return AnalyzeResponse(
        base_branch=base_branch,
        branches=branches,
        diffs=diffs,
        pairs=pairs,
    )
