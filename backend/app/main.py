"""MergeGuard Sentinel — FastAPI entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import cors_middleware_kwargs

app = FastAPI(
    title="MergeGuard Sentinel",
    version="0.1.0",
    description="Predicts merge-conflict risk across in-flight branches.",
)

app.add_middleware(CORSMiddleware, **cors_middleware_kwargs())

app.include_router(router, prefix="/api")


@app.get("/")
def root() -> dict:
    return {"service": "mergeguard-sentinel", "docs": "/docs"}
