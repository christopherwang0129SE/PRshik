# MergeGuard

**An agent-based system that minimises merge conflicts.**
Built for the **Nebius & Tavily Hackathon 2026**.

Naive parallel development — whether by humans or a fleet of AI coding agents —
collides. Nordvakt watches in-flight branches and works to **predict**, **prevent**,
and **resolve** merge conflicts before they cost anyone a day.

## The three agents

| Agent | Role | Status |
|-------|------|--------|
| **Sentinel** | *Predict* — scores conflict risk between every pair of in-flight branches by diffing them at the region (and, later, symbol) level. | ✅ MVP |
| **Planner** | *Prevent* — decomposes work into non-overlapping "zones" and suggests merge/rebase order. | ⏳ planned |
| **Merger** | *Resolve* — semantic 3-way merge; uses **Tavily** to check current library docs, runs tests, explains the resolution. | ⏳ planned |

- **LLM inference:** Nebius Token Factory (OpenAI-compatible API)
- **Web research:** Tavily
- **Backend:** FastAPI (Python) · **Frontend:** dashboard (branch graph + risk heatmap)

## Quickstart (backend)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env    # fill in keys (optional for Sentinel)
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs for the API.

### Try the Sentinel on any repo

```bash
curl -s -X POST http://localhost:8000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"repo_path": "/path/to/some/repo", "base_branch": "main"}' | python3 -m json.tool
```

Returns a per-branch diff summary and a ranked list of branch-pair **conflict-risk
scores** with human-readable rationales.

### Sync open GitHub pull requests

Set `GITHUB_REPOSITORY` to `owner/repository` and `GITHUB_SEATED_USERS` to a
comma-separated list of seated GitHub usernames in `backend/.env`. Set
`GITHUB_TOKEN` for private repositories or higher API rate limits. The
`GET /api/github/pull-requests` endpoint syncs open pull requests targeting
`DEFAULT_BASE_BRANCH`, includes only authors in the seated-user list, fetches
their GitHub PR refs into the local workspace clone, and returns the PR details
alongside Sentinel's conflict-risk analysis against the latest fetched
`origin/DEFAULT_BASE_BRANCH`. It does not assign reviewers or merge pull
requests.

## Tests

```bash
cd backend && source .venv/bin/activate && pytest -q
```

The test suite builds a throwaway git repo with intentionally overlapping branches
and asserts the Sentinel flags them.

## Repo layout

```
backend/            FastAPI service
  app/
    main.py         entrypoint + CORS
    config.py       env-driven settings (Nebius/Tavily keys)
    schemas.py      API models
    api/routes.py   /api/health, /api/analyze
    services/
      git_service.py  pure-git diff/branch helpers (subprocess)
      sentinel.py     conflict-risk scoring
  tests/
frontend/           dashboard (to be scaffolded)
docs/               customer discovery + notes
```

## Why "MergeGuard"

Something is always on guard at the merge point — watching every in-flight
branch so a conflict never lands as a surprise.
