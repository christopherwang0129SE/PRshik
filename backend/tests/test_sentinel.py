"""End-to-end test: build a real git repo with conflicting branches."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.config import settings
from app.schemas import BranchDiff, BranchTests, PairRisk, Verification
from app.services import sentinel
from app.services.nemotron import build_pair_prompt


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _adjacent_repo(tmp_path: Path) -> Path:
    """Two edits two lines apart: the hunk heuristic overlaps, git merges cleanly."""
    repo = tmp_path / "near"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "Test")
    base = [f"line {i}" for i in range(1, 21)]
    (repo / "app.py").write_text("\n".join(base) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")

    def branch(name: str, index: int, text: str) -> None:
        _git(repo, "checkout", "-q", "main")
        _git(repo, "checkout", "-q", "-b", name)
        lines = list(base)
        lines[index] = text
        (repo / "app.py").write_text("\n".join(lines) + "\n")
        _git(repo, "commit", "-qam", name)

    branch("near-a", 4, "line 5 CHANGED BY A")
    branch("near-b", 6, "line 7 CHANGED BY B")
    _git(repo, "checkout", "-q", "main")
    return repo


def test_overlap_is_high_risk(repo: Path) -> None:
    res = sentinel.analyze(repo, "main", ["feat-a", "feat-b", "feat-c"])
    pair = {frozenset((p.branch_a, p.branch_b)): p for p in res.pairs}

    ab = pair[frozenset(("feat-a", "feat-b"))]
    assert ab.overlapping_files == 1
    assert ab.level in ("medium", "high")
    assert ab.score >= 40

    # a and c share app.py but edit far-apart lines -> no overlap.
    ac = pair[frozenset(("feat-a", "feat-c"))]
    assert ac.shared_files == 1
    assert ac.overlapping_files == 0
    assert ac.score < ab.score


def test_highest_risk_pair_first(repo: Path) -> None:
    res = sentinel.analyze(repo, "main", ["feat-a", "feat-b", "feat-c"])
    assert {res.pairs[0].branch_a, res.pairs[0].branch_b} == {"feat-a", "feat-b"}


def test_finding_separates_textual_conflicts(repo: Path) -> None:
    res = sentinel.analyze(repo, "main", ["feat-a", "feat-b", "feat-c"])
    pair = {frozenset((p.branch_a, p.branch_b)): p for p in res.pairs}

    ab = pair[frozenset(("feat-a", "feat-b"))]
    assert ab.textual_conflict is True
    assert ab.level in ("medium", "high")
    assert ab.finding == "textual_conflict"

    ac = pair[frozenset(("feat-a", "feat-c"))]
    assert ac.textual_conflict is False
    assert ac.overlapping_files == 0
    assert ac.level == "low"
    assert ac.finding == "none"

    bc = pair[frozenset(("feat-b", "feat-c"))]
    assert bc.textual_conflict is False
    assert bc.finding == "none"


def test_pair_finding_confirmed_is_semantic_unless_git_conflicts() -> None:
    low = PairRisk(
        branch_a="a", branch_b="b", score=10, level="low",
        shared_files=0, overlapping_files=0, collisions=[], rationale="r",
        textual_conflict=False,
    )
    assert sentinel._pair_finding(low) == "none"
    verified = low.model_copy(update={"verification": Verification(status="confirmed")})
    assert sentinel._pair_finding(verified) == "semantic"
    branched = low.model_copy(update={"branch_tests": BranchTests(status="confirmed")})
    assert sentinel._pair_finding(branched) == "semantic"
    conflict = verified.model_copy(update={"textual_conflict": True, "level": "high"})
    assert sentinel._pair_finding(conflict) == "textual_conflict"
    unknown = low.model_copy(update={"textual_conflict": None, "level": "medium"})
    assert sentinel._pair_finding(unknown) == "semantic"


def _low_model(prompt: str) -> str:
    return json.dumps({"risk_score": 10, "risk_level": "low", "rationale": "No joint break."})


def test_clean_overlap_skips_the_hunk_floor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr("app.services.nemotron.complete", _low_model)
    pair = sentinel.analyze(_adjacent_repo(tmp_path), "main", ["near-a", "near-b"]).pairs[0]
    assert pair.textual_conflict is False
    assert pair.overlapping_files == 1
    assert pair.git_score is not None and pair.git_score > 10
    plain = round((0.5 * pair.git_score) + (0.5 * 10), 1)
    assert pair.score == plain
    assert pair.score < pair.git_score
    assert pair.level == "low"
    assert pair.finding == "none"


def test_unknown_merge_keeps_the_hunk_floor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr("app.services.git_service.textual_conflict", lambda *_a, **_k: None)
    monkeypatch.setattr("app.services.nemotron.complete", _low_model)
    pair = sentinel.analyze(_adjacent_repo(tmp_path), "main", ["near-a", "near-b"]).pairs[0]
    assert pair.textual_conflict is None
    assert pair.overlapping_files == 1
    assert pair.git_score is not None
    assert pair.score == pair.git_score
    assert pair.finding == "semantic"


def test_real_conflict_keeps_the_floor(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr("app.services.nemotron.complete", _low_model)
    pair = sentinel.analyze(repo, "main", ["feat-a", "feat-b"]).pairs[0]
    assert pair.textual_conflict is True
    assert pair.overlapping_files == 1
    assert pair.git_score is not None and pair.score == pair.git_score
    assert pair.score > 10
    assert pair.finding == "textual_conflict"


def test_textual_conflict_does_not_change_the_prompt() -> None:
    diff_a = BranchDiff(branch="a", base="main", merge_base="x", ahead=1, files=[])
    diff_b = BranchDiff(branch="b", base="main", merge_base="x", ahead=1, files=[])
    shared = dict(
        branch_a="a", branch_b="b", score=47.5, level="medium", rationale="overlap",
        shared_files=1, overlapping_files=1, collisions=[], git_score=47.5,
        git_rationale="overlap",
    )
    kwargs = dict(
        base_branch="main", diff_a=diff_a, diff_b=diff_b,
        commits_a=["a edits top"], commits_b=["b edits top"], excerpt="diff",
    )
    clean = build_pair_prompt(pair=PairRisk(**shared, textual_conflict=False, finding="none"), **kwargs)
    unknown = build_pair_prompt(pair=PairRisk(**shared, textual_conflict=None), **kwargs)
    conflict = build_pair_prompt(
        pair=PairRisk(**shared, textual_conflict=True, finding="textual_conflict"), **kwargs
    )
    assert clean == unknown == conflict
    assert "textual_conflict" not in clean
