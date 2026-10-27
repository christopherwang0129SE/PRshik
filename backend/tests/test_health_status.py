import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import nemotron
from app.config import settings


@pytest.mark.parametrize("status", ["not_configured", "unchecked", "ok", "auth_failed", "unreachable", "error"])
def test_health_reports_last_operational_status(monkeypatch, status):
    error = "Token Factory call failed" if status in ("auth_failed", "unreachable", "error") else None
    monkeypatch.setattr(nemotron, "operational_status", lambda: (status, error))
    body = TestClient(app).get("/api/health").json()
    assert body["nebius_status"] == status
    assert body["nebius_last_error"] == error


@pytest.mark.parametrize("code,status", [(401, "auth_failed"), (403, "auth_failed"), (500, "error")])
def test_recorder_classifies_http_failure_without_retaining_details(monkeypatch, code, status):
    monkeypatch.setattr(nemotron, "_last_call", ("unchecked", None))
    exc = RuntimeError("sensitive response body")
    exc.status_code = code
    nemotron.record_call_result(exc)
    assert nemotron._last_call[0] == status
    assert "sensitive" not in nemotron._last_call[1]


def test_recorder_success_and_connection_errors(monkeypatch):
    monkeypatch.setattr(nemotron, "_last_call", ("unchecked", None))
    for exc in (TimeoutError(), ConnectionError()):
        nemotron.record_call_result(exc)
        assert nemotron._last_call[0] == "unreachable"
    nemotron.record_call_result()
    assert nemotron._last_call == ("ok", None)


def test_status_before_first_call_and_without_configuration(monkeypatch):
    monkeypatch.setattr(nemotron, "_last_call", ("unchecked", None))
    monkeypatch.setattr(type(settings), "nebius_ready", property(lambda self: True))
    assert nemotron.operational_status() == ("unchecked", None)
    monkeypatch.setattr(type(settings), "nebius_ready", property(lambda self: False))
    assert nemotron.operational_status() == ("not_configured", None)
