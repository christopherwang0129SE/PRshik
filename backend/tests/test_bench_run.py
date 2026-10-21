"""Per-case bench runner: env isolation, budget, resume, timeout. No network."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from scripts.bench.run import (
    analyze_case,
    child_env,
    is_confirmed,
    is_flagged,
    main,
    run_child,
)


def _case(case_id: str, repo: str = "acme/widget", **extra: object) -> dict:
    row = {
        "case_id": case_id,
        "repo": repo,
        "label": "broke",
        "gt_kind": "revert",
        "confidence": "revert",
        "fix_sha": "f" * 40,
        "fix_subject": "fix the merge",
        "a": {"sha": "a" * 40, "subject": "change A", "pr": 11, "parent": "p", "kind": "squash"},
        "b": {"sha": "b" * 40, "subject": "change B", "pr": 12, "parent": "p", "kind": "merge"},
    }
    row.update(extra)
    return row


def _verdict(
    cost: float = 0.4,
    *,
    level: str = "low",
    verification: str = "skipped",
    branch: str = "passed",
) -> dict:
    return {
        "level": level,
        "score": 12.0,
        "score_source": "git",
        "fallback_reason": "disabled",
        "model_score": None,
        "verification": {"status": verification, "reason": "", "attempts": 0},
        "branch_tests": {"status": branch, "reason": ""},
        "docs_sources": 0,
        "rationale": "independent",
        "usage": {"llm_calls": 0, "total_tokens": 0, "estimated_cost_usd": cost},
    }


def _meta(case: dict, root: Path, *, b: str | None = "bbbb") -> dict:
    return {
        "path": str(Path(root) / str(case["case_id"])),
        "main": "m",
        "a": "aaaa",
        "b": b,
        "a_apply_failed": False,
        "b_apply_failed": b is None,
        "textual_conflict": False,
    }


def _write(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def _read(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _texts(root: Path) -> str:
    chunks: list[str] = []
    if not root.exists():
        return ""
    for path in root.rglob("*"):
        if path.is_file():
            chunks.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(chunks)


def _patch_replay(monkeypatch: pytest.MonkeyPatch, captured: list | None = None, b: str | None = "bbbb") -> None:
    def fake(src: Path, case: dict, root: Path) -> dict:
        if captured is not None:
            captured.append(Path(src))
        return _meta(case, Path(root), b=b)

    monkeypatch.setattr("scripts.bench.run.build_replay", fake)


def _run(
    tmp: Path,
    rows: list[dict],
    monkeypatch: pytest.MonkeyPatch,
    extra: list[str],
    child,
    *,
    b: str | None = "bbbb",
    captured: list | None = None,
) -> tuple[int, Path]:
    cases = tmp / "cases.jsonl"
    _write(cases, rows)
    _patch_replay(monkeypatch, captured, b=b)
    monkeypatch.setattr("scripts.bench.run.run_child", child)
    results = tmp / "results" / "run"
    rc = main(
        [
            "--cases",
            str(cases),
            "--src-root",
            str(tmp / "src"),
            "--replay-root",
            str(tmp / "replay"),
            "--results",
            str(results),
            *extra,
        ]
    )
    return rc, results


def test_child_env_strips_label_and_disables_when_missing(tmp_path: Path) -> None:
    env = child_env(
        {"PATH": "/usr/bin", "NEBIUS_API_KEY": "from-parent", "TOKEN_FACTORY_API_KEY_BENCH": "Some label v1.abc"},
        tmp_path,
    )
    assert env["NEBIUS_API_KEY"] == "v1.abc"
    assert env["NEBIUS_ENABLED"] == "true"
    assert env["PATH"] == "/usr/bin"
    assert "from-parent" not in env.values()
    assert env["VERIFY_ALLOWED_ROOTS"] == str(tmp_path.resolve())

    disabled = child_env({"TOKEN_FACTORY_API_KEY_BENCH": "   "}, tmp_path)
    assert disabled["NEBIUS_API_KEY"] == ""
    assert disabled["NEBIUS_ENABLED"] == "false"
    absent = child_env({})
    assert absent["NEBIUS_API_KEY"] == ""
    assert absent["NEBIUS_ENABLED"] == "false"


def test_child_env_dry_run_forces_disabled(tmp_path: Path) -> None:
    env = child_env({"TOKEN_FACTORY_API_KEY_BENCH": "label v1.live"}, tmp_path, dry_run=True)
    assert env["NEBIUS_API_KEY"] == "v1.live"
    assert env["NEBIUS_ENABLED"] == "false"


def test_key_never_written(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    token = "v1.FAKEBENCHKEY_do_not_leak"
    raw = f"Some label {token}"
    monkeypatch.setenv("TOKEN_FACTORY_API_KEY_BENCH", raw)

    def child(replay_path: Path, *, cwd: Path, env: dict, timeout: float, argv=None) -> dict:
        assert env["NEBIUS_API_KEY"] == token
        assert env["NEBIUS_ENABLED"] == "false"
        assert env["VERIFY_ALLOWED_ROOTS"]
        verdict = _verdict(0.0)
        verdict["rationale"] = f"saw {token}"
        return {"status": "ok", "verdict": verdict, "stderr": f"boom {raw}", "seconds": 0.01}

    rc, results = _run(tmp_path, [_case("c1")], monkeypatch, ["--dry-run", "--max-usd", "9"], child)
    assert rc == 0
    blob = _texts(tmp_path / "results")
    assert token not in blob
    assert raw not in blob
    assert "[redacted]" in blob


def test_budget_stops_after_two(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def child(replay_path: Path, *, cwd: Path, env: dict, timeout: float, argv=None) -> dict:
        calls.append(Path(replay_path).name)
        return {"status": "ok", "verdict": _verdict(0.4), "seconds": 0.01}

    first = tmp_path / "a.jsonl"
    second = tmp_path / "b.jsonl"
    _write(first, [_case(f"c{i}") for i in range(3)])
    _write(second, [_case(f"c{i}") for i in range(3, 5)])
    _patch_replay(monkeypatch)
    monkeypatch.setattr("scripts.bench.run.run_child", child)
    results = tmp_path / "results" / "run"
    rc = main(
        [
            "--cases",
            str(first),
            "--cases",
            str(second),
            "--src-root",
            str(tmp_path / "src"),
            "--replay-root",
            str(tmp_path / "replay"),
            "--results",
            str(results),
            "--max-usd",
            "1",
            "--dry-run",
        ]
    )
    assert rc == 0
    rows = _read(results / "results.jsonl")
    assert [row["case_id"] for row in rows] == ["c0", "c1"]
    assert calls == ["c0", "c1"]
    spend = json.loads((results.parent / "spend.json").read_text(encoding="utf-8"))
    assert spend["cases"] == 2
    assert spend["spent_usd"] == pytest.approx(0.8)
    assert rows[0]["cost"] == pytest.approx(0.4)
    assert rows[0]["a"]["pr"] == 11
    assert rows[0]["b"]["subject"] == "change B"


def test_resume_skips_done_ids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def child(replay_path: Path, *, cwd: Path, env: dict, timeout: float, argv=None) -> dict:
        seen.append(Path(replay_path).name)
        return {"status": "ok", "verdict": _verdict(0.0), "seconds": 0.02}

    results = tmp_path / "results" / "run"
    results.mkdir(parents=True)
    (results / "results.jsonl").write_text(json.dumps({"case_id": "done", "status": "ok"}) + "\n", encoding="utf-8")
    rc, results = _run(tmp_path, [_case("done"), _case("new")], monkeypatch, ["--dry-run"], child)
    assert rc == 0
    assert seen == ["new"]
    ids = [row["case_id"] for row in _read(results / "results.jsonl")]
    assert ids == ["done", "new"]


def test_timeout_kills_process_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    parent_pid = tmp_path / "parent.pid"
    child_pid = tmp_path / "child.pid"
    script = (
        "import os, sys, time, pathlib\n"
        "pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))\n"
        "pid = os.fork()\n"
        "if pid == 0:\n"
        "    pathlib.Path(sys.argv[2]).write_text(str(os.getpid()))\n"
        "    time.sleep(60)\n"
        "time.sleep(60)\n"
    )
    monkeypatch.setattr(
        "scripts.bench.run._child_argv",
        lambda _path: [sys.executable, "-c", script, str(parent_pid), str(child_pid)],
    )
    outcome = run_child(tmp_path, cwd=tmp_path, env=os.environ.copy(), timeout=1.0)
    assert outcome["status"] == "timeout"
    assert parent_pid.is_file()
    assert child_pid.is_file()

    def alive(pid: int) -> bool:
        status = Path(f"/proc/{pid}/status")
        if not status.exists():
            return False
        for line in status.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("State:"):
                return not line.split()[1].startswith("Z")
        return True

    assert not alive(int(parent_pid.read_text()))
    assert not alive(int(child_pid.read_text()))

    def injected(replay_path: Path, *, cwd: Path, env: dict, timeout: float, argv=None) -> dict:
        return {"status": "timeout", "seconds": 0.2}

    rc, results = _run(tmp_path, [_case("slow")], monkeypatch, ["--dry-run", "--timeout", "0.01"], injected)
    assert rc == 0
    row = _read(results / "results.jsonl")[-1]
    assert row["case_id"] == "slow"
    assert row["status"] == "timeout"
    assert row["cost"] == 0


def test_replay_failed_when_b_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def child(*_args, **_kwargs):
        raise AssertionError("child should not run")

    rc, results = _run(tmp_path, [_case("missing-b")], monkeypatch, ["--dry-run"], child, b=None)
    assert rc == 0
    row = _read(results / "results.jsonl")[0]
    assert row["status"] == "replay_failed"
    assert row["b_apply_failed"] is True
    assert row["a"]["sha"] == "a" * 40
    assert "parallel_evidence" not in row


def test_replay_failed_records_parallel_evidence(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(src: Path, case: dict, root: Path) -> dict:
        raise RuntimeError("clone failed")

    monkeypatch.setattr("scripts.bench.run.build_replay", boom)
    cases = tmp_path / "cases.jsonl"
    _write(cases, [_case("bad", **{"parallel_evidence": {"notes": 1}})])
    results = tmp_path / "out" / "run"
    rc = main(
        [
            "--cases",
            str(cases),
            "--src-root",
            str(tmp_path / "src"),
            "--replay-root",
            str(tmp_path / "replay"),
            "--results",
            str(results),
            "--dry-run",
        ]
    )
    assert rc == 0
    row = _read(results / "results.jsonl")[0]
    assert row["status"] == "replay_failed"
    assert row["parallel_evidence"] == {"notes": 1}
    assert "RuntimeError" in row["error"]


def test_src_repo_is_owner_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Path] = []

    def child(*_a, **_k):
        return {"status": "ok", "verdict": _verdict(0.0), "seconds": 0.0}

    rc, _results = _run(
        tmp_path,
        [_case("slash", repo="acme/widget"), _case("flat", repo="acme__widget")],
        monkeypatch,
        ["--dry-run", "--max-usd", "9"],
        child,
        captured=seen,
    )
    assert rc == 0
    assert seen == [tmp_path / "src" / "acme__widget", tmp_path / "src" / "acme__widget"]


def test_flagged_confirmed_mapping(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert is_flagged(_verdict(level="high")) is True
    assert is_confirmed(_verdict(level="high")) is False
    assert is_flagged(_verdict(verification="confirmed")) is True
    assert is_confirmed(_verdict(verification="confirmed")) is True
    assert is_flagged(_verdict(branch="confirmed")) is True
    assert is_confirmed(_verdict(branch="confirmed")) is True
    assert is_flagged(_verdict()) is False
    assert is_confirmed(_verdict()) is False

    def child(*_a, **_k):
        return {
            "status": "ok",
            "verdict": _verdict(0.0, level="medium", verification="suspected", branch="confirmed"),
            "seconds": 0.01,
        }

    _rc, results = _run(tmp_path, [_case("flag")], monkeypatch, ["--dry-run"], child)
    row = _read(results / "results.jsonl")[0]
    assert row["flagged"] is True
    assert row["confirmed"] is True
    assert row["verification"]["status"] == "suspected"
    assert row["branch_tests"]["status"] == "confirmed"


def test_analyze_case_projects_pair(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class Pair:
        level = "high"
        score = 91.5
        score_source = "model"
        fallback_reason = None
        model_score = 88.0
        verification = type("V", (), {"status": "confirmed", "reason": "broke", "attempts": 2})()
        branch_tests = type("B", (), {"status": "passed", "reason": "ok"})()
        docs_sources = [1, 2, 3]
        rationale = "r" * 500

    class Usage:
        llm_calls = 2
        total_tokens = 40
        estimated_cost_usd = 0.02

    def fake_analyze(repo, base, branches, **kwargs):
        captured.update(repo=repo, base=base, branches=branches, **kwargs)
        return type("R", (), {"pairs": [Pair()], "usage": Usage()})()

    import app.services.sentinel as sentinel_mod
    import app.services.verifier as verifier_mod

    monkeypatch.setattr(sentinel_mod, "analyze", fake_analyze)
    monkeypatch.setattr(verifier_mod, "repo_allowed", lambda repo: True)
    monkeypatch.setenv("MG_BENCH_VERIFY", "0")
    payload = analyze_case(tmp_path)
    assert captured["base"] == "main"
    assert captured["branches"] == ["a", "b"]
    assert captured["use_cache"] is True
    assert captured["verify"] is False
    assert captured["verify_allowed"] is True
    assert payload["level"] == "high"
    assert payload["docs_sources"] == 3
    assert payload["rationale"] == "r" * 300
    assert payload["verification"] == {"status": "confirmed", "reason": "broke", "attempts": 2}
    assert payload["branch_tests"] == {"status": "passed", "reason": "ok"}
    assert payload["usage"]["llm_calls"] == 2
    assert is_flagged(payload) is True
    assert is_confirmed(payload) is True


def test_child_crash_scrubs_stderr(tmp_path: Path) -> None:
    token = "v1.CRASHKEY_should_not_stick"
    outcome = run_child(
        tmp_path,
        cwd=tmp_path,
        env={"PATH": os.environ.get("PATH", ""), "TOKEN_FACTORY_API_KEY_BENCH": f"label {token}"},
        timeout=30,
        argv=[sys.executable, "-c", f"import sys; sys.stderr.write('nope {token}\\n'); raise SystemExit(2)"],
    )
    assert outcome["status"] == "error"
    assert token not in outcome["stderr"]
    assert "nope" in outcome["stderr"]
