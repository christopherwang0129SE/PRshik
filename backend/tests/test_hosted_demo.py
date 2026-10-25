"""CORS origin parsing and the DEMO_MODE lock on analyze, resolve and the GitHub routes."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.routes import bundled_demo_repos
from app.config import Settings, cors_middleware_kwargs, parse_cors_origins, settings
from app.main import app
from app.services import verifier


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _init_branch_repo(path: Path) -> None:
    path.mkdir(parents=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@example.com")
    _git(path, "config", "user.name", "Test")
    (path / "app.py").write_text("x = 1\n")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "base")
    _git(path, "checkout", "-q", "-b", "feat-a")
    (path / "app.py").write_text("x = 2\n")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "a")
    _git(path, "checkout", "-q", "main")
    _git(path, "checkout", "-q", "-b", "feat-b")
    (path / "app.py").write_text("x = 3\n")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "b")
    _git(path, "checkout", "-q", "main")


def test_parse_cors_origins_splits_trims_and_drops_blanks() -> None:
    assert parse_cors_origins("http://localhost:3000,http://127.0.0.1:3000") == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    assert parse_cors_origins(" https://demo.example , , https://other.example ") == [
        "https://demo.example",
        "https://other.example",
    ]
    assert parse_cors_origins("") == []
    assert parse_cors_origins(" , ") == []


def test_cors_defaults_keep_local_vite_and_disable_regex() -> None:
    origins = Settings.model_fields["cors_allow_origins"].default
    assert parse_cors_origins(origins) == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    assert Settings.model_fields["cors_allow_origin_regex"].default == ""
    assert Settings.model_fields["demo_mode"].default is False


def test_cors_middleware_kwargs_pass_regex_and_omit_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cors_allow_origins", "https://a.example, https://b.example")
    monkeypatch.setattr(settings, "cors_allow_origin_regex", "  ")
    kwargs = cors_middleware_kwargs()
    assert kwargs["allow_origins"] == ["https://a.example", "https://b.example"]
    assert kwargs["allow_origin_regex"] is None
    assert kwargs["allow_methods"] == ["*"]
    assert kwargs["allow_headers"] == ["*"]

    pattern = r"https://mergeguard-demo.*\.vercel\.app"
    monkeypatch.setattr(settings, "cors_allow_origin_regex", pattern)
    assert cors_middleware_kwargs()["allow_origin_regex"] == pattern
    compiled = re.compile(pattern)
    assert compiled.fullmatch("https://mergeguard-demo.vercel.app")
    assert compiled.fullmatch("https://mergeguard-demo-git-feat-team.vercel.app")
    assert compiled.fullmatch("https://evil.vercel.app") is None
    assert compiled.fullmatch("https://mergeguard-demo.vercel.app.evil.com") is None


def test_bundled_demo_repos_follow_demo_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(verifier, "DEMO_ROOT", tmp_path)
    assert bundled_demo_repos() == [
        (tmp_path / "checkout-demo").resolve(),
        (tmp_path / "api-demo").resolve(),
    ]


def test_demo_mode_off_still_analyzes_other_repos(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "demo_mode", False)
    response = TestClient(app).post(
        "/api/analyze",
        json={"repo_path": str(repo), "branches": ["feat-a", "feat-b"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["pairs"][0]["score_source"] == "git"
    assert body["pairs"][0]["fallback_reason"] == "no_api_key"


def test_demo_mode_rejects_urls_and_other_paths(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(verifier, "DEMO_ROOT", tmp_path / "bundled")
    client = TestClient(app)

    other = client.post("/api/analyze", json={"repo_path": str(repo)})
    assert other.status_code == 403
    assert "bundled demo" in other.json()["detail"]
    assert "not allowed" in other.json()["detail"]

    remote = client.post(
        "/api/analyze",
        json={"repo_url": "https://github.com/example/huge.git"},
    )
    assert remote.status_code == 403
    assert "repo_url" in remote.json()["detail"]

    both = client.post(
        "/api/analyze",
        json={
            "repo_path": str(tmp_path / "bundled" / "checkout-demo"),
            "repo_url": "https://github.com/example/huge.git",
        },
    )
    assert both.status_code == 403

    missing = client.post("/api/analyze", json={})
    assert missing.status_code == 403

    outside = client.post("/api/analyze", json={"repo_path": "/etc"})
    assert outside.status_code == 403

    parent = client.post("/api/analyze", json={"repo_path": str(tmp_path / "bundled")})
    assert parent.status_code == 403


def test_demo_mode_allows_only_the_two_bundled_repos(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "demo"
    checkout = root / "checkout-demo"
    api_demo = root / "api-demo"
    _init_branch_repo(checkout)
    _init_branch_repo(api_demo)
    monkeypatch.setattr(verifier, "DEMO_ROOT", root)
    monkeypatch.setattr(settings, "demo_mode", True)
    client = TestClient(app)

    for path in (checkout, api_demo):
        response = client.post(
            "/api/analyze",
            json={"repo_path": str(path) + "/", "branches": ["feat-a", "feat-b"]},
        )
        assert response.status_code == 200, response.text
        pair = response.json()["pairs"][0]
        assert pair["score_source"] == "git"
        assert pair["fallback_reason"] == "no_api_key"

    nested = client.post(
        "/api/analyze",
        json={"repo_path": str(checkout / "app.py")},
    )
    assert nested.status_code == 403

    escape = client.post(
        "/api/analyze",
        json={"repo_path": str(checkout / ".." / ".." / "etc")},
    )
    assert escape.status_code == 403


def test_demo_mode_missing_git_repo_is_400_not_a_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "demo"
    empty = root / "checkout-demo"
    empty.mkdir(parents=True)
    monkeypatch.setattr(verifier, "DEMO_ROOT", root)
    monkeypatch.setattr(settings, "demo_mode", True)
    response = TestClient(app).post("/api/analyze", json={"repo_path": str(empty)})
    assert response.status_code == 400
    assert "not a git repository" in response.json()["detail"]


def test_demo_mode_leaves_health_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "demo_mode", True)
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["nebius_ready"] is False
    assert "nebius_api_key" not in body


def test_demo_mode_resolve_accepts_only_bundled_repos(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "demo"
    checkout = root / "checkout-demo"
    _init_branch_repo(checkout)
    monkeypatch.setattr(verifier, "DEMO_ROOT", root)
    monkeypatch.setattr(settings, "demo_mode", True)
    client = TestClient(app)
    body = {"target_branch": "feat-a", "source_branch": "feat-b"}

    for path in (str(repo), "/etc", str(root)):
        response = client.post("/api/resolve", json={**body, "repo_path": path})
        assert response.status_code == 403, path
        assert "bundled demo" in response.json()["detail"]

    allowed = client.post("/api/resolve", json={**body, "repo_path": str(checkout)})
    assert allowed.status_code != 403


def test_demo_mode_turns_off_github_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(settings, "github_repository", "example/repo")
    monkeypatch.setattr(settings, "github_seated_users", "someone")
    client = TestClient(app)
    for route in ("/api/github/pull-requests", "/api/github/queue"):
        assert client.get(route).status_code == 403, route
