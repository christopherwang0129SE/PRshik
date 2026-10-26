# One public service: Node builds the dashboard; Python serves it and /api.
FROM node:22-bookworm-slim AS dashboard
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_DEMO_REPO_PATH=/app/demo/checkout-demo \
    VITE_API_DEMO_REPO_PATH=/app/demo/api-demo
RUN npm run build

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory "*"

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
# pytest and pydantic are direct requirements. requests is too, via
# tavily-python; the extra pin keeps the API demo's import if that changes.
RUN pip install --no-cache-dir -r /app/backend/requirements.txt "requests>=2.32,<3" \
    && python -c "import pytest, pydantic, requests"

COPY backend/ /app/backend/
COPY demo/ /app/demo/
COPY --from=dashboard /frontend/dist/ /app/frontend/dist/

RUN python3 /app/demo/make_demo_repo.py \
    && python3 /app/demo/make_api_demo_repo.py

RUN useradd --create-home --uid 1000 --user-group --shell /bin/sh app \
    && chown -R app:app /app
USER app

WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEMO_MODE=true

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
