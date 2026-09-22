"""End-to-end test: build a real git repo with conflicting branches."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.services import sentinel


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _write(repo: Path, name: str, content: str) -> None:
    (repo / name).write_text(content)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    r = tmp_path / "demo"
    r.mkdir()
    _git(r, "init", "-q", "-b", "main")
    _git(r, "config", "user.email", "t@example.com")
    _git(r, "config", "user.name", "Test")

    base_lines = "\n".join(f"line {i}" for i in range(1, 21)) + "\n"
    _write(r, "app.py", base_lines)
    _write(r, "readme.md", "# demo\n")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "base")

    # feat-a: edit lines ~2-4 of app.py
    _git(r, "checkout", "-q", "-b", "feat-a")
    lines = base_lines.splitlines()
    lines[2] = "line 3 CHANGED BY A"
    _write(r, "app.py", "\n".join(lines) + "\n")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "a edits top")

    # feat-b: edit line ~3 too (overlaps feat-a) + an unrelated file
    _git(r, "checkout", "-q", "main")
    _git(r, "checkout", "-q", "-b", "feat-b")
    lines = base_lines.splitlines()
    lines[2] = "line 3 CHANGED BY B"
    _write(r, "app.py", "\n".join(lines) + "\n")
    _write(r, "unrelated.py", "print('b only')\n")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "b edits top + new file")

    # feat-c: edits far-away lines of app.py (shared file, no overlap)
    _git(r, "checkout", "-q", "main")
    _git(r, "checkout", "-q", "-b", "feat-c")
    lines = base_lines.splitlines()
    lines[18] = "line 19 CHANGED BY C"
    _write(r, "app.py", "\n".join(lines) + "\n")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "c edits bottom")

    _git(r, "checkout", "-q", "main")
    return r


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
