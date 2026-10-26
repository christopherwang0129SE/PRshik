from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.api import routes
from app.services import github_service
from app.schemas import GitHubPullRequest

client = TestClient(app)


def test_repository_catalog_lists_real_branches(monkeypatch, repo, tmp_path):
    monkeypatch.setattr(routes, 'bundled_demo_repos', lambda: [repo, tmp_path / 'missing'])
    result = client.get('/api/repositories')
    assert result.status_code == 200
    available, missing = result.json()['repositories']
    assert available['available'] is True
    assert set(available['branches']) == {'feat-a', 'feat-b', 'feat-c'}
    assert available['repo_path'] == str(repo)
    assert missing['available'] is False
    assert missing['branches'] == []


def test_pull_queue_reads_without_clone_or_analysis(monkeypatch):
    def listing(repository, base, token, limit):
        assert repository == 'owner/repo' and base == 'develop' and limit == 30
        return [GitHubPullRequest(number=4, title='Fix checkout', author='dev',
                url='https://github.com/owner/repo/pull/4', head_branch='fix',
                base_branch='develop', updated_at='2026-10-25T12:00:00Z')]
    monkeypatch.setattr(github_service, 'list_open_pulls', listing)
    result = client.get('/api/github/pulls?repository=owner/repo&base_branch=develop')
    assert result.status_code == 200
    assert result.json()['pull_requests'][0]['number'] == 4


def test_pull_queue_empty_and_invalid(monkeypatch):
    monkeypatch.setattr(github_service, 'list_open_pulls', lambda *a, **kw: [])
    assert client.get('/api/github/pulls?repository=owner/repo').json()['pull_requests'] == []
    assert client.get('/api/github/pulls?repository=invalid').status_code == 400
    monkeypatch.setattr(settings, 'github_repository', '')
    assert client.get('/api/github/pulls').status_code == 400


def test_pull_queue_respects_demo_lock_and_redacts_errors(monkeypatch):
    monkeypatch.setattr(settings, 'demo_mode', True)
    assert client.get('/api/github/pulls?repository=owner/repo').status_code == 403
    monkeypatch.setattr(settings, 'demo_mode', False)
    monkeypatch.setattr(settings, 'github_token', 'test-private-token')
    def fail(*a, **kw):
        raise github_service.GitHubError('Request failed test-private-token')
    monkeypatch.setattr(github_service, 'list_open_pulls', fail)
    result = client.get('/api/github/pulls?repository=owner/repo')
    assert result.status_code == 400
    assert 'test-private-token' not in result.text
