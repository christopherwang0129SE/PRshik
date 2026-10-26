"""Read and filter open pull requests from a configured GitHub repository."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from pydantic import ValidationError

from app.schemas import GitHubPullRequest, GitHubReviewQueueItem
from app.services.git_service import redact_secrets

_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_API_URL = "https://api.github.com"
_PR_URL_RE = re.compile(
    r"^https://github\.com/"
    r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)/pull/(?P<number>[1-9]\d*)/?$"
)
_REPO_URL_RE = re.compile(
    r"^https://github\.com/"
    r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)


class GitHubError(RuntimeError):
    pass


def validate_repository(repository: str) -> str:
    normalized = repository.strip().removesuffix(".git")
    if (
        not _REPOSITORY_RE.fullmatch(normalized)
        or any(part in {".", ".."} for part in normalized.split("/"))
    ):
        raise GitHubError("GITHUB_REPOSITORY must use the owner/repository format")
    return normalized


@dataclass(frozen=True)
class GitHubUrl:
    """A parsed ``https://github.com/owner/repo`` or ``.../pull/N`` URL."""

    owner: str
    repo: str
    number: int | None = None

    @property
    def repository(self) -> str:
        return f"{self.owner}/{self.repo}"

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}.git"


def _name_ok(part: str) -> bool:
    return part not in {".", ".."} and bool(part)


def parse_github_url(url: str) -> GitHubUrl | None:
    """Parse a GitHub repo or pull request URL. Other URLs return None.

    Accepts ``https://github.com/o/r``, ``https://github.com/o/r.git``, and
    ``https://github.com/o/r/pull/N`` (optional trailing slash).
    """
    text = url.strip()
    pull = _PR_URL_RE.fullmatch(text)
    if pull:
        owner, repo = pull.group("owner"), pull.group("repo")
        if _name_ok(owner) and _name_ok(repo):
            return GitHubUrl(owner=owner, repo=repo, number=int(pull.group("number")))
        return None
    repo_match = _REPO_URL_RE.fullmatch(text)
    if repo_match:
        owner, repo = repo_match.group("owner"), repo_match.group("repo")
        if repo.endswith(".git"):
            repo = repo[: -len(".git")]
        if _name_ok(owner) and _name_ok(repo):
            return GitHubUrl(owner=owner, repo=repo)
    return None


def _headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _transport_error(exc: Exception, token: str | None) -> GitHubError:
    if isinstance(exc, httpx.HTTPStatusError):
        return GitHubError(f"GitHub API returned HTTP {exc.response.status_code}")
    return GitHubError(f"Could not reach the GitHub API: {redact_secrets(str(exc), token)}")


def _pull_from_record(
    pull: object,
    *,
    authors: set[str] | None,
    base_branch: str | None,
) -> GitHubPullRequest | None:
    """Parse one API record. ``None`` means the caller filtered it out."""
    if not isinstance(pull, dict):
        raise GitHubError("GitHub returned an invalid pull-request record")
    author = pull.get("user")
    head = pull.get("head")
    base = pull.get("base")
    if not isinstance(author, dict) or not isinstance(head, dict) or not isinstance(base, dict):
        raise GitHubError("GitHub returned an incomplete pull-request record")
    login = author.get("login")
    head_ref = head.get("ref")
    base_ref = base.get("ref")
    if not isinstance(login, str) or not isinstance(head_ref, str) or not isinstance(base_ref, str):
        raise GitHubError("GitHub returned invalid pull-request fields")
    if authors is not None and login.lower() not in authors:
        return None
    if base_branch is not None and base_ref != base_branch:
        return None
    requested = pull.get("requested_reviewers") or []
    if not isinstance(requested, list):
        raise GitHubError("GitHub returned invalid requested reviewers")
    requested_logins = [
        reviewer["login"]
        for reviewer in requested
        if isinstance(reviewer, dict) and isinstance(reviewer.get("login"), str)
    ]
    try:
        return GitHubPullRequest(
            number=pull["number"],
            title=pull["title"],
            author=login,
            url=pull["html_url"],
            head_branch=head_ref,
            base_branch=base_ref,
            updated_at=pull["updated_at"],
            requested_reviewers=requested_logins,
        )
    except (KeyError, ValidationError) as exc:
        raise GitHubError("GitHub returned invalid pull-request fields") from exc


def _collect_pulls(
    repository: str,
    base_branch: str,
    token: str | None,
    *,
    authors: set[str] | None,
    limit: int | None = None,
) -> list[GitHubPullRequest]:
    pulls: list[GitHubPullRequest] = []
    page = 1
    try:
        with httpx.Client(timeout=15.0, headers=_headers(token)) as client:
            while True:
                response = client.get(
                    f"{_API_URL}/repos/{repository}/pulls",
                    params={
                        "state": "open",
                        "base": base_branch,
                        "per_page": 100,
                        "page": page,
                    },
                )
                response.raise_for_status()
                try:
                    page_pulls = response.json()
                except ValueError as exc:
                    raise GitHubError("GitHub returned invalid JSON") from exc
                if not isinstance(page_pulls, list):
                    raise GitHubError("GitHub returned an invalid pull-request response")
                for pull in page_pulls:
                    parsed = _pull_from_record(pull, authors=authors, base_branch=base_branch)
                    if parsed is None:
                        continue
                    pulls.append(parsed)
                    if limit is not None and len(pulls) >= limit:
                        return pulls
                if len(page_pulls) < 100:
                    break
                page += 1
    except GitHubError:
        raise
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise _transport_error(exc, token) from exc
    return pulls


def _get_list(client: httpx.Client, url: str) -> list:
    """GET every page of a GitHub list endpoint."""
    results: list = []
    page = 1
    while True:
        response = client.get(url, params={"per_page": 100, "page": page})
        response.raise_for_status()
        try:
            page_items = response.json()
        except ValueError as exc:
            raise GitHubError("GitHub returned invalid JSON") from exc
        if not isinstance(page_items, list):
            raise GitHubError("GitHub returned an invalid list response")
        results.extend(page_items)
        if len(page_items) < 100:
            return results
        page += 1


def _parse_time(value: str) -> datetime:
    """Parse a GitHub timestamp such as 2026-10-16T09:00:00Z."""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GitHubError("GitHub returned an invalid timestamp") from exc


def list_review_queue(
    repository: str,
    seated_users: set[str],
    base_branch: str,
    review_sla_hours: int,
    token: str | None = None,
    now: datetime | None = None,
) -> list[GitHubReviewQueueItem]:
    now = now or datetime.now(timezone.utc)
    pulls = list_open_pull_requests(repository, seated_users, base_branch, token)

    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    items: list[GitHubReviewQueueItem] = []
    try:
        with httpx.Client(timeout=15.0, headers=headers) as client:
            for pull in pulls:
                # Step 1: each person's latest review decides whether they approved.
                reviews = _get_list(
                    client, f"{_API_URL}/repos/{repository}/pulls/{pull.number}/reviews"
                )
                latest: dict[str, str] = {}
                for review in reviews:
                    user = review.get("user") if isinstance(review, dict) else None
                    login = user.get("login") if isinstance(user, dict) else None
                    state = review.get("state") if isinstance(review, dict) else None
                    if isinstance(login, str) and isinstance(state, str):
                        latest[login.lower()] = state

                author = pull.author.lower()
                approved_by = sorted(
                    login
                    for login, state in latest.items()
                    if state == "APPROVED" and login in seated_users and login != author
                )

                # Step 2: reviewers are everyone still requested plus everyone who reviewed.
                requested = {login.lower() for login in pull.requested_reviewers}
                reviewers = sorted(
                    login
                    for login in requested | latest.keys()
                    if login in seated_users and login != author
                )

                # Step 3: the clock starts when a still-pending reviewer was last requested.
                events = _get_list(
                    client, f"{_API_URL}/repos/{repository}/issues/{pull.number}/timeline"
                )
                requested_at: dict[str, str] = {}
                for event in events:
                    if not isinstance(event, dict) or event.get("event") != "review_requested":
                        continue
                    reviewer = event.get("requested_reviewer")
                    login = reviewer.get("login") if isinstance(reviewer, dict) else None
                    created_at = event.get("created_at")
                    if isinstance(login, str) and isinstance(created_at, str):
                        requested_at[login.lower()] = created_at
                pending = [
                    requested_at[login]
                    for login in requested
                    if login in seated_users and login != author and login in requested_at
                ]
                waiting_since = min(pending) if pending else None

                # Step 4: pick the status, most decisive first, and add the item.
                if approved_by:
                    status = "approved"
                elif not reviewers:
                    status = "needs_reviewer"
                elif waiting_since and now - _parse_time(waiting_since) > timedelta(
                    hours=review_sla_hours
                ):
                    status = "review_late"
                else:
                    status = "awaiting_review"
                items.append(
                    GitHubReviewQueueItem(
                        number=pull.number,
                        title=pull.title,
                        author=pull.author,
                        url=pull.url,
                        status=status,
                        reviewers=reviewers,
                        approved_by=approved_by,
                        waiting_since=waiting_since,
                    )
                )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        raise GitHubError(f"GitHub API returned HTTP {status}") from exc
    except httpx.RequestError as exc:
        raise GitHubError(f"Could not reach the GitHub API: {exc}") from exc

    return items


def list_open_pull_requests(
    repository: str,
    seated_users: set[str],
    base_branch: str,
    token: str | None = None,
) -> list[GitHubPullRequest]:
    repository = validate_repository(repository)
    if not seated_users:
        raise GitHubError("Configure at least one seated GitHub username")
    return _collect_pulls(repository, base_branch, token, authors=seated_users)


def list_open_pulls(
    repository: str,
    base_branch: str,
    token: str | None = None,
    *,
    limit: int | None = None,
) -> list[GitHubPullRequest]:
    """Open pull requests targeting ``base_branch``, any author.

    Unauthenticated unless ``token`` is set. The token is never included in
    the error text. ``limit`` stops once that many pulls have been kept.
    """
    repository = validate_repository(repository)
    return _collect_pulls(repository, base_branch, token, authors=None, limit=limit)


def get_pull_request(
    repository: str,
    number: int,
    token: str | None = None,
) -> GitHubPullRequest:
    """One pull request, open or closed. Unauthenticated unless ``token`` is set."""
    repository = validate_repository(repository)
    try:
        with httpx.Client(timeout=15.0, headers=_headers(token)) as client:
            response = client.get(f"{_API_URL}/repos/{repository}/pulls/{number}")
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise GitHubError("GitHub returned invalid JSON") from exc
    except GitHubError:
        raise
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise _transport_error(exc, token) from exc
    parsed = _pull_from_record(payload, authors=None, base_branch=None)
    if parsed is None:
        raise GitHubError("GitHub returned an invalid pull-request record")
    return parsed
