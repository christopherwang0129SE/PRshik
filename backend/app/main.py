"""PRshik — FastAPI entrypoint."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import cors_middleware_kwargs

app = FastAPI(
    title="PRshik",
    version="0.1.0",
    description="Predicts merge-conflict risk and proposes reviewable merge resolutions.",
)

app.add_middleware(CORSMiddleware, **cors_middleware_kwargs())

app.include_router(router, prefix="/api")


# Mount last so API routes (including their 403 guards) retain precedence.
dashboard = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dashboard.is_dir():
    app.mount("/", StaticFiles(directory=dashboard, html=True), name="dashboard")
else:
    @app.get("/")
    def root() -> dict:
        return {"service": "mergeguard-sentinel", "docs": "/docs"}
