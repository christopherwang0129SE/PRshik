import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.routes import health
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


@pytest.fixture
def probe_client(monkeypatch):
    from unittest.mock import MagicMock

    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr(nemotron, "_last_call", ("unchecked", None))
    monkeypatch.setattr(nemotron, "_last_probe", None)
    monkeypatch.setattr(nemotron, "_real_call_generation", 0)
    monkeypatch.setattr(nemotron, "_probe_generation", 0)
    monkeypatch.setattr(nemotron, "_probe_in_flight", False)
    client = MagicMock()
    factory = MagicMock()
    factory.return_value.__enter__.return_value = client
    monkeypatch.setattr(nemotron, "OpenAI", factory)
    return client, factory


@pytest.mark.parametrize("code,status", [(None, "ok"), (401, "auth_failed"), (403, "auth_failed"), (500, "error")])
def test_probe_maps_response(probe_client, code, status):
    client, factory = probe_client
    if code:
        error = RuntimeError("sensitive response body")
        error.status_code = code
        client.models.list.side_effect = error
    nemotron.probe_status()
    assert nemotron.operational_status()[0] == status
    assert "sensitive" not in str(nemotron.operational_status())
    assert factory.call_args.kwargs["timeout"] == 3.0
    assert factory.call_args.kwargs["max_retries"] == 0


@pytest.mark.parametrize("error", [ConnectionError(), TimeoutError()])
def test_probe_connection_failure(probe_client, error):
    probe_client[0].models.list.side_effect = error
    nemotron.probe_status()
    assert nemotron.operational_status()[0] == "unreachable"


def test_probe_throttle_and_refresh(monkeypatch, probe_client):
    now = [100.0]
    monkeypatch.setattr(nemotron.time, "monotonic", lambda: now[0])
    nemotron.probe_status()
    now[0] += 599
    nemotron.probe_status()
    assert probe_client[0].models.list.call_count == 1
    now[0] += 1
    nemotron.probe_status()
    assert probe_client[0].models.list.call_count == 2
    nemotron.record_call_result()
    now[0] += 601
    nemotron.probe_status()
    assert probe_client[0].models.list.call_count == 2


def test_probe_without_key(monkeypatch, probe_client):
    monkeypatch.setattr(settings, "nebius_api_key", "")
    nemotron.probe_status()
    probe_client[1].assert_not_called()
    assert nemotron.operational_status() == ("not_configured", None)


@pytest.mark.parametrize("code", [None, 401, 500])
def test_health_does_not_request_models_when_status_known(probe_client, code):
    error = None
    if code:
        error = RuntimeError("private")
        error.status_code = code
    nemotron.record_call_result(error)
    body = health()
    assert body["nebius_status"] == {None: "ok", 401: "auth_failed", 500: "error"}[code]
    probe_client[1].assert_not_called()


def test_health_probes_before_reporting_status(probe_client):
    body = health()
    assert body["nebius_status"] == "ok"
    probe_client[0].models.list.assert_called_once()


def test_probe_preserves_concurrent_real_call(probe_client):
    probe_client[0].models.list.side_effect = lambda: nemotron.record_call_result(TimeoutError())
    nemotron.probe_status()
    assert nemotron.operational_status()[0] == "unreachable"


def test_probe_concurrent_requests_do_not_wait_or_repeat(probe_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    started, release = Event(), Event()

    def list_models():
        started.set()
        assert release.wait(2)

    probe_client[0].models.list.side_effect = list_models
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(nemotron.probe_status)
        try:
            assert started.wait(2)
            pool.submit(nemotron.probe_status).result(timeout=1)
            probe_client[0].models.list.assert_called_once()
        finally:
            release.set()
        first.result(timeout=1)
