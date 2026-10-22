"""End-to-end test: build a real git repo with conflicting branches."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.config import settings
from app.schemas import BranchDiff, BranchTests, ChangedFile, FileCollision, PairRisk, Verification
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


def _line_after(text: str, prefix: str) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            return lines[index + 1]
    raise AssertionError(f"no line starts with {prefix!r}")


def _prompt_for(textual_conflict: bool | None, rationale: str, **extra: object) -> str:
    diff_a = BranchDiff(branch="a", base="main", merge_base="x", ahead=1, files=[])
    diff_b = BranchDiff(branch="b", base="main", merge_base="x", ahead=1, files=[])
    pair = PairRisk(
        branch_a="a", branch_b="b", score=47.5, level="medium", rationale=rationale,
        shared_files=1, overlapping_files=1, collisions=[], git_score=47.5,
        git_rationale=rationale, textual_conflict=textual_conflict, **extra,
    )
    return build_pair_prompt(
        base_branch="main", pair=pair, diff_a=diff_a, diff_b=diff_b,
        commits_a=["a edits top"], commits_b=["b edits top"], excerpt="diff",
    )


def test_prompt_states_git_merge_tree_result() -> None:
    likely = (
        "1 file(s) changed in overlapping regions by both branches — "
        "a textual merge conflict is likely."
    )
    clean = _prompt_for(False, likely, finding="none")
    unknown = _prompt_for(None, likely)
    conflict = _prompt_for(True, likely, finding="textual_conflict")

    assert _line_after(clean, "Git heuristic") == "Git merge (git merge-tree): merges cleanly"
    assert _line_after(unknown, "Git heuristic") == "Git merge (git merge-tree): unknown"
    assert _line_after(conflict, "Git heuristic") == (
        "Git merge (git merge-tree): reports a TEXTUAL CONFLICT "
        "(reported separately; score only semantic effects)"
    )
    # The merge line sits between the heuristic and the rationale.
    assert _line_after(clean, "Git merge (git merge-tree):").startswith("Git rationale:")
    assert _line_after(unknown, "Git merge (git merge-tree):") == f"Git rationale: {likely}"
    assert _line_after(conflict, "Git merge (git merge-tree):") == f"Git rationale: {likely}"


def test_clean_merge_replaces_conflict_likely_rationale() -> None:
    likely = (
        "1 file(s) changed in overlapping regions by both branches — "
        "a textual merge conflict is likely."
    )
    calm = (
        "1 shared file(s) but no overlapping regions — "
        "merges cleanly today, but coordinate before divergence grows."
    )
    clean = _prompt_for(False, likely)
    assert _line_after(clean, "Git merge (git merge-tree):") == (
        "Git rationale: Hunks are close together, but git merges them cleanly."
    )
    assert "conflict is likely" not in clean

    kept = _prompt_for(False, calm)
    assert "Git merge (git merge-tree): merges cleanly" in kept
    assert f"Git rationale: {calm}" in kept
    assert "Hunks are close together" not in kept


def _risk(**kwargs: object) -> PairRisk:
    data: dict = dict(
        branch_a="a", branch_b="b", score=10, level="low",
        shared_files=0, overlapping_files=0, collisions=[], rationale="r",
    )
    data.update(kwargs)
    return PairRisk(**data)


def _collision(path: str, overlapping: bool) -> FileCollision:
    return FileCollision(
        path=path, overlapping=overlapping,
        branch_a_hunks=[(1, 2)], branch_b_hunks=[(1, 2)],
    )


def test_excerpt_paths_shared_source_beats_changelog() -> None:
    pair = _risk(
        shared_files=3, overlapping_files=1,
        collisions=[
            _collision("lib.py", False),
            _collision("app.py", True),
            _collision("CHANGES.md", False),
        ],
    )
    files_a = [
        ChangedFile(path="lib.py", added_lines=1, removed_lines=0, hunks=[(10, 12)]),
        "CHANGES.md",
        ChangedFile(path="app.py", added_lines=1, removed_lines=0, hunks=[(1, 2)]),
        "README.rst",
    ]
    files_b = ["lib.py", "CHANGES.md", "app.py", "docs/guide.txt"]
    assert sentinel._excerpt_paths(pair, files_a, files_b) == ["app.py", "lib.py"]


def test_excerpt_paths_includes_config_only_one_branch_changed() -> None:
    pair = _risk(shared_files=1, collisions=[_collision("CHANGES.md", False)])
    got = sentinel._excerpt_paths(pair, ["CHANGES.md"], ["CHANGES.md", "pyproject.toml"])
    assert got == ["pyproject.toml"]


def test_excerpt_paths_docs_last_only_when_nothing_else() -> None:
    pair = _risk(
        shared_files=3,
        collisions=[
            _collision("CHANGES.md", True),
            _collision("docs/guide.py", False),
            _collision("tests/data/fixture.json", False),
        ],
    )
    files = ["tests/data/fixture.json", "CHANGES.md", "docs/guide.py"]
    assert sentinel._excerpt_paths(pair, files, files) == [
        "CHANGES.md", "docs/guide.py", "tests/data/fixture.json",
    ]

    # A real source file, a focus path, or a config file drops the docs.
    with_source = sentinel._excerpt_paths(
        pair, [*files, "src/app.py"], [*files, "src/app.py"],
    )
    assert with_source == ["src/app.py"]


def test_excerpt_paths_focus_before_config_and_caps_at_three() -> None:
    pair = _risk(
        shared_files=1, overlapping_files=1,
        collisions=[_collision("src/app.py", True)],
        symbol_evidence=["parse: changed by a (src/app.py), called by b (src/caller.py)"],
    )
    got = sentinel._excerpt_paths(
        pair,
        ["src/app.py", "CHANGES.md"],
        ["src/app.py", "CHANGES.md", "pyproject.toml", "setup.cfg", "tox.ini"],
    )
    assert got == ["src/app.py", "src/caller.py", "pyproject.toml"]


def test_excerpt_paths_non_code_and_test_data_rank_with_docs() -> None:
    pair = _risk(
        shared_files=4,
        collisions=[
            _collision("src/app.py", False),
            _collision("tests/data/sample.py", True),
            _collision("locales/en.json", False),
            _collision("README.md", False),
        ],
    )
    files = ["README.md", "locales/en.json", "tests/data/sample.py", "src/app.py"]
    assert sentinel._excerpt_paths(pair, files, files) == ["src/app.py"]

    pair = _risk(
        shared_files=3,
        collisions=[
            _collision("README.md", False),
            _collision("locales/en.json", False),
            _collision("tests/data/sample.py", True),
        ],
    )
    files = ["locales/en.json", "README.md", "tests/data/sample.py"]
    assert sentinel._excerpt_paths(pair, files, files) == [
        "README.md", "tests/data/sample.py", "locales/en.json",
    ]


@pytest.mark.parametrize("path", [
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
    ".flake8",
    "ruff.toml",
    ".ruff.toml",
    "mypy.ini",
    ".pre-commit-config.yaml",
    "frontend/package.json",
    "tsconfig.json",
    "web/tsconfig.app.json",
    ".eslintrc",
    "pkg/.eslintrc.cjs",
    "biome.json",
])
def test_excerpt_paths_counts_tooling_files_as_config(path: str) -> None:
    pair = _risk(shared_files=1, collisions=[_collision("CHANGES.md", False)])
    assert sentinel._excerpt_paths(pair, ["CHANGES.md"], ["CHANGES.md", path]) == [path]
