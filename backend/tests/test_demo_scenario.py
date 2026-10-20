"""Exercise the real API analysis path with no provider credentials."""
import importlib.util
from pathlib import Path

from app.config import settings


def test_checkout_demo_without_keys(monkeypatch, tmp_path, capsys):
    script = Path(__file__).resolve().parents[2] / "demo/run_demo.py"
    spec = importlib.util.spec_from_file_location("checkout_demo_runner", script)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    repo = tmp_path / "checkout-demo"
    monkeypatch.setattr(runner.make_demo_repo, "DEMO_DIR", repo)
    monkeypatch.setattr(settings, "verify_allowed_roots", str(tmp_path))
    monkeypatch.setattr(settings, "branch_tests_enabled", True)
    monkeypatch.setattr(settings, "nebius_api_key", "")
    monkeypatch.setattr(settings, "tavily_api_key", "")

    assert runner.main() == 0
    report = capsys.readouterr().out
    assert "Git: clean merge" in report
    assert "no LLM" in report
    assert "90/100, high" in report
    assert "test_total_with_cap" in report
    assert "200.0 != 198.0" in report
    assert "PASS: pair flagged and proven." in report
