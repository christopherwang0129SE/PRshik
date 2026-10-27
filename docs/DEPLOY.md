# Public hosted demo: one Render free service

Use the **Deploy to Render** button in [README](../README.md#public-hosting-on-render-free).
The Blueprint uses the `main` branch. Dima applies it from an existing
Render account, then shares the service's public HTTPS URL. Judges do not sign
in. No keys or CORS variables are required. Do not create a separate Vercel app.
Keep `DEMO_MODE=true` and the free plan selected. Automatic deploys are disabled;
after pushing changes, use Render's manual deploy action. Delete the service in
Render when the demo is no longer needed.

## Build and runtime

The Node 22 Docker stage runs `npm ci` and `npm run build`. It embeds the demo
paths `/app/demo/checkout-demo` and `/app/demo/api-demo`. The Python 3.12 stage
installs backend requirements plus requests, creates both git demos, copies the
built dashboard into `/app/frontend/dist`, and runs as the unprivileged app user.
Working directory is `/app/backend`. The command is:

```sh
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

FastAPI handles `/api` first and serves the dashboard at `/` and its assets at
`/assets`. Production builds default to a same-origin API base. Local Vite dev
still defaults to `http://localhost:8000`; `VITE_API_BASE_URL` is an optional build
override for separately hosted dashboards. Health check: `GET /api/health`.

No authentication gate is installed. Demo mode allows only the two bundled
repositories for analyze, the analyze stream, pair diff, plan, and resolve.
Remote URLs and other paths return 403. `/api/github/pull-requests`,
`/api/github/queue`, and `/api/github/pulls` return 403. No GitHub token,
Nebius key, or Tavily key is needed. Without model keys, deterministic branch
tests still prove the checkout regression (200 instead of 198).

## Cold starts

The free service sleeps after 15 minutes idle and can take about one minute to
wake. When the whole service is asleep, Render controls the initial response and
may display its own loading page. App code cannot run before its HTML arrives.
Once loaded, the dashboard shows a friendly wake-up notice until `/api/health`
succeeds. Requests time out after 10 seconds; failures retry after 1, 2, 4, 8,
then 10 seconds between attempts. Buttons remain disabled while waking, and
become available automatically. There is no keep-alive polling after success.

## Local verification without Docker

Use Node 22. Run the same frontend install/build commands as the Dockerfile,
with its two `VITE_*_REPO_PATH` values. In a temporary simulation layout, place
`backend`, generated `demo` repositories, and `frontend/dist` under one root.
Install `backend/requirements.txt` and requests, then run the command above from
`backend` with `DEMO_MODE=true`, a free `PORT`, and no API keys. Open `/`, run
**Try demo repo**, and check the restricted routes return 403. For a delayed
backend test, serve the built frontend first through a local proxy that forwards
`/api` to the not-yet-started backend, then start that backend and check recovery.

The older [Railway checklist](DEPLOY_CHECKLIST.md) describes a separate legacy
hosting option; it is not needed for this Render Blueprint.

Blueprint branch selection and manual deploy syntax follow the
[Render button guide](https://render.com/docs/deploy-to-render) and
[Blueprint reference](https://render.com/docs/blueprint-spec).
