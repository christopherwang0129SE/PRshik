"""Read and filter open pull requests from a configured GitHub repository."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import httpx
from pydantic import ValidationError

from app.schemas import GitHubPullRequest, GitHubReviewQueueItem

_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_API_URL = "https://api.github.com"


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


def list_open_pull_requests(
    repository: str,
    seated_users: set[str],
    base_branch: str,
    token: str | None = None,
) -> list[GitHubPullRequest]:
    repository = validate_repository(repository)
    if not seated_users:
        raise GitHubError("Configure at least one seated GitHub username")

    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    pulls: list[GitHubPullRequest] = []
    page = 1
    try:
        with httpx.Client(timeout=15.0, headers=headers) as client:
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
                    if not isinstance(pull, dict):
                        raise GitHubError("GitHub returned an invalid pull-request record")
                    author = pull.get("user")
                    head = pull.get("head")
                    base = pull.get("base")
                    if (
                        not isinstance(author, dict)
                        or not isinstance(head, dict)
                        or not isinstance(base, dict)
                    ):
                        raise GitHubError("GitHub returned an incomplete pull-request record")
                    login = author.get("login")
                    head_ref = head.get("ref")
                    base_ref = base.get("ref")
                    if (
                        not isinstance(login, str)
                        or not isinstance(head_ref, str)
                        or not isinstance(base_ref, str)
                    ):
                        raise GitHubError("GitHub returned invalid pull-request fields")
                    if login.lower() not in seated_users or base_ref != base_branch:
                        continue
                    requested = pull.get("requested_reviewers") or []
                    if not isinstance(requested, list):
                        raise GitHubError("GitHub returned invalid requested reviewers")
                    requested_logins = [
                        reviewer["login"]
                        for reviewer in requested
                        if isinstance(reviewer, dict) and isinstance(reviewer.get("login"), str)
                    ]
                    try:
                        pulls.append(
                            GitHubPullRequest(
                                number=pull["number"],
                                title=pull["title"],
                                author=login,
                                url=pull["html_url"],
                                head_branch=head_ref,
                                base_branch=base_ref,
                                updated_at=pull["updated_at"],
                                requested_reviewers=requested_logins,
                            )
                        )
                    except (KeyError, ValidationError) as exc:
                        raise GitHubError("GitHub returned invalid pull-request fields") from exc

                if len(page_pulls) < 100:
                    break
                page += 1
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        raise GitHubError(f"GitHub API returned HTTP {status}") from exc
    except httpx.RequestError as exc:
        raise GitHubError(f"Could not reach the GitHub API: {exc}") from exc

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
