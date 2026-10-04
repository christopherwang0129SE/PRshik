"""Read and filter open pull requests from a configured GitHub repository."""
from __future__ import annotations

import re

import httpx
from pydantic import ValidationError

from app.schemas import GitHubPullRequest

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
