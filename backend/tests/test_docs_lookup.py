"""Tavily doc lookup: detection, no-ops, failures, prompt wiring. No network."""
from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path

import pytest

from app.config import Settings, settings
from app.schemas import BranchDiff, ChangedFile, DocSource, PairRisk
from app.services import cache, docs_lookup, git_service, sentinel, verifier

SECRET = "tvly-TEST-secret-value"

PY_SAMPLE = """
import os
import requests
import requests as req
from fastapi import FastAPI, Depends
from fastapi.routing import APIRouter
from pathlib import Path
from .local_mod import thing
from ..pkg import helper
import checkout
from checkout.billing import pay
import httpx
from __future__ import annotations
import json, sys
"""

JS_SAMPLE = """
import { useState, useEffect } from 'react';
import {
  useMemo
} from "react-dom/client";
import fs from 'node:fs';
import path from 'fs';
import local from './local';
import up from '../util';
import alias from '@/components/Button';
const _ = require('lodash');
export { useQuery } from '@tanstack/react-query';
import type { ZodType } from "zod";
"""

DIFF_SAMPLE = """diff --git a/app.py b/app.py
index 111..222 100644
--- a/app.py
+++ b/app.py
@@ -1,3 +1,6 @@
+import requests
+from fastapi import FastAPI
 import os
-from pathlib import Path
+from .local_mod import thing
+import checkout
"""


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _init_repo(path: Path) -> None:
    path.mkdir()
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@example.com")
    _git(path, "config", "user.name", "Test")


def _install(monkeypatch: pytest.MonkeyPatch, calls: list, *, results=None, error: Exception | None = None) -> None:
    class Client:
        def __init__(self, api_key: str) -> None:
            calls.append("init")

        def search(self, query: str, *, max_results: int, timeout: float) -> dict:
            calls.append(("search", query, max_results, timeout))
            if error is not None:
                raise error
            if results is not None:
                return results
            return {
                "results": [{
                    "title": query.split()[0],
                    "url": f"https://example.com/{query.split()[0]}",
                    "content": f"documentation for {query}",
                }]
            }

    monkeypatch.setattr(docs_lookup, "TavilyClient", Client)


def _enable(monkeypatch: pytest.MonkeyPatch, *, key: str = SECRET, enabled: bool = True) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", key)
    monkeypatch.setattr(settings, "tavily_enabled", enabled)
    monkeypatch.setattr(settings, "tavily_timeout_seconds", 8.0)
    monkeypatch.setattr(settings, "tavily_max_results", 3)
    docs_lookup.clear_cache()


def test_settings_defaults() -> None:
    assert Settings.model_fields["tavily_api_key"].default == ""
    assert Settings.model_fields["tavily_enabled"].default is True
    assert Settings.model_fields["tavily_timeout_seconds"].default == 8.0
    assert Settings.model_fields["tavily_max_results"].default == 3


def test_detects_python_and_js_third_party_imports() -> None:
    py_hits = docs_lookup.detect_imports(PY_SAMPLE, paths=["checkout.py", "pkg/app.py"])
    py_libs = [hit.library for hit in py_hits]
    assert py_libs[0] == "requests"
    assert "fastapi" in py_libs
    assert "httpx" in py_libs
    assert "os" not in py_libs
    assert "pathlib" not in py_libs
    assert "json" not in py_libs
    assert "sys" not in py_libs
    assert "checkout" not in py_libs
    assert "__future__" not in py_libs
    fastapi = next(hit for hit in py_hits if hit.library == "fastapi")
    assert fastapi.symbol == "FastAPI"
    assert docs_lookup.build_queries(py_hits) == [
        "requests documentation",
        "fastapi FastAPI documentation",
    ]

    js_hits = docs_lookup.detect_imports(JS_SAMPLE, paths=["src/local.ts", "src/util.ts"])
    js_pairs = [(hit.library, hit.symbol) for hit in js_hits]
    assert ("react", "useState") in js_pairs
    assert ("react-dom", "useMemo") in js_pairs
    assert ("lodash", "") in js_pairs
    assert ("@tanstack/react-query", "useQuery") in js_pairs
    assert ("zod", "ZodType") in js_pairs
    assert all(hit.library not in {"fs", "path", "node:fs", "node:path", "local", "util"} for hit in js_hits)

    # A symbol seen on a later import of the same library is kept.
    upgraded = docs_lookup.detect_imports("import fastapi\nfrom fastapi import FastAPI\nimport httpx\n")
    assert docs_lookup.build_queries(upgraded) == [
        "fastapi FastAPI documentation",
        "httpx documentation",
    ]


def test_diff_prefixes_and_relative_imports_are_skipped() -> None:
    hits = docs_lookup.detect_imports(DIFF_SAMPLE, paths=["checkout.py", "app.py"])
    libs = {hit.library for hit in hits}
    assert libs == {"requests", "fastapi"}


def test_noop_without_key_does_not_construct_a_client(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch, key="")
    assert docs_lookup.lookup(["import requests\nfrom fastapi import FastAPI\n"]) == []
    assert calls == []


def test_noop_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch, enabled=False)
    assert docs_lookup.active() is False
    assert docs_lookup.lookup(["import requests\n"]) == []
    assert calls == []


def test_noop_when_nothing_third_party_is_imported(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch)
    text = "import os\nfrom pathlib import Path\nfrom .local import x\nimport helper from './helper'\n"
    assert docs_lookup.lookup([text], paths=["helper.py"]) == []
    assert calls == []


def test_search_errors_are_swallowed_and_the_key_is_not_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    calls: list = []
    _install(monkeypatch, calls, error=TimeoutError(f"timed out talking to {SECRET}"))
    _enable(monkeypatch)
    with caplog.at_level(logging.WARNING, logger="app.services.docs_lookup"):
        assert docs_lookup.lookup(["import requests\n"]) == []
    assert calls and calls[0] == "init"
    assert calls[1][0] == "search"
    assert "TimeoutError" in caplog.text
    assert SECRET not in caplog.text


def test_returned_snippets_never_contain_the_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list = []

    class Client:
        def __init__(self, api_key: str) -> None:
            calls.append("init")

        def search(self, query: str, *, max_results: int, timeout: float) -> dict:
            calls.append("search")
            return {"results": [{
                "title": SECRET,
                "url": "https://example.com/docs",
                "content": f"token {SECRET} in the page",
            }]}

    monkeypatch.setattr(docs_lookup, "TavilyClient", Client)
    _enable(monkeypatch)
    snippets = docs_lookup.lookup(["import requests\n"])
    blob = " ".join(f"{item.title} {item.url} {item.content} {item.query}" for item in snippets)
    assert snippets and snippets[0].url == "https://example.com/docs"
    assert SECRET not in blob
    assert "[redacted]" in snippets[0].title
    assert "[redacted]" in snippets[0].content
    assert calls == ["init", "search"]


def test_client_repr_does_not_include_the_key() -> None:
    client = docs_lookup.TavilyClient(api_key=SECRET)
    assert SECRET not in repr(client)
    assert "redacted" in repr(client)


def test_snippets_are_trimmed_and_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list = []

    class Client:
        def __init__(self, api_key: str) -> None:
            calls.append("init")

        def search(self, query: str, *, max_results: int, timeout: float) -> dict:
            calls.append(("search", query, max_results, timeout))
            return {
                "results": [
                    {"title": f"T{i}", "url": f"https://example.com/{i}", "content": "y" * 5000}
                    for i in range(5)
                ]
            }

    monkeypatch.setattr(docs_lookup, "TavilyClient", Client)
    _enable(monkeypatch)
    text = "import requests\nimport httpx\nfrom fastapi import FastAPI\n"
    snippets = docs_lookup.lookup([text])
    assert snippets
    assert sum(len(item.content) for item in snippets) <= docs_lookup.CONTENT_BUDGET
    assert all(len(item.content) <= docs_lookup.PER_SNIPPET_CHARS for item in snippets)
    assert all(item.url.startswith("https://") and item.title for item in snippets)
    searches = [item for item in calls if isinstance(item, tuple)]
    assert len(searches) == 2
    assert searches[0][1:] == ("requests documentation", 3, 8.0)
    assert searches[1][1] == "httpx documentation"
    again = docs_lookup.lookup([text])
    assert [(item.url, item.content) for item in again] == [(item.url, item.content) for item in snippets]
    assert [item for item in calls if isinstance(item, tuple)] == searches


def test_prompts_include_docs_only_when_snippets_exist(repo: Path) -> None:
    section = docs_lookup.format_docs_section([
        docs_lookup.DocSnippet(
            title="Requests",
            url="https://requests.readthedocs.io/en/latest/",
            content="HTTP for Humans.",
            query="requests documentation",
        )
    ])
    assert section.startswith("Library documentation (via Tavily web search)")
    assert docs_lookup.format_docs_section([]) == ""

    plain = verifier.build_test_prompt(repo, "main", "feat-a", "feat-b")
    assert plain == verifier.build_test_prompt(repo, "main", "feat-a", "feat-b", docs="")
    assert "Tavily" not in plain
    enriched = verifier.build_test_prompt(repo, "main", "feat-a", "feat-b", docs=section)
    assert "Library documentation (via Tavily web search)" in enriched
    assert "https://requests.readthedocs.io/en/latest/" in enriched
    assert "HTTP for Humans." in enriched

    diff = BranchDiff(branch="a", base="main", merge_base="x", ahead=1, files=[
        ChangedFile(path="app.py", added_lines=1, removed_lines=0, hunks=[(1, 1)]),
    ])
    pair = PairRisk(
        branch_a="a", branch_b="b", score=10, level="low", shared_files=1,
        overlapping_files=0, collisions=[], rationale="git",
    )
    kwargs = dict(
        base_branch="main", pair=pair, diff_a=diff, diff_b=diff,
        commits_a=["a"], commits_b=["b"], excerpt="line 3 CHANGED",
    )
    from app.services.nemotron import build_pair_prompt

    risk_plain = build_pair_prompt(**kwargs)
    assert risk_plain == build_pair_prompt(**kwargs, docs="")
    assert "Tavily" not in risk_plain
    risk_docs = build_pair_prompt(**kwargs, docs=section)
    assert "Library documentation (via Tavily web search)" in risk_docs
    assert "https://requests.readthedocs.io/en/latest/" in risk_docs
    assert "line 3 CHANGED" in risk_docs


def test_docs_sources_default_empty() -> None:
    pair = PairRisk(
        branch_a="a", branch_b="b", score=0, level="none", shared_files=0,
        overlapping_files=0, collisions=[], rationale="r",
    )
    assert pair.docs_sources == []
    assert pair.model_dump()["docs_sources"] == []
    filled = pair.model_copy(update={
        "docs_sources": [DocSource(title="Requests", url="https://example.com/requests",
                                   query="requests documentation")],
    })
    assert filled.model_dump()["docs_sources"] == [{
        "title": "Requests",
        "url": "https://example.com/requests",
        "query": "requests documentation",
    }]


def _pair_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "librepo"
    _init_repo(repo)
    (repo / "app.py").write_text("import os\n\ndef run():\n    return 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    _git(repo, "checkout", "-q", "-b", "feat-a")
    (repo / "app.py").write_text(
        "import os\nimport requests\nfrom fastapi import FastAPI\n\ndef run():\n    return FastAPI\n"
    )
    _git(repo, "commit", "-qam", "a adds clients")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "checkout", "-q", "-b", "feat-b")
    (repo / "app.py").write_text(
        "import os\nimport requests\n\ndef run():\n    return 2\n"
    )
    _git(repo, "commit", "-qam", "b changes run")
    _git(repo, "checkout", "-q", "main")
    return repo


def test_analyze_puts_docs_in_the_risk_prompt_and_on_the_pair(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _pair_repo(tmp_path)
    prompts: list[str] = []

    def fake_complete(prompt: str, **_kwargs) -> str:
        prompts.append(prompt)
        return json.dumps({"risk_score": 42, "risk_level": "medium", "rationale": "Both call run."})

    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "nebius_api_key", "test-nebius-key")
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)

    res = sentinel.analyze(repo, "main", ["feat-a", "feat-b"], verify=False)
    pair = res.pairs[0]
    assert pair.score_source == "model"
    assert prompts
    assert "Library documentation (via Tavily web search)" in prompts[0]
    assert "https://example.com/requests" in prompts[0]
    assert SECRET not in prompts[0]
    assert pair.docs_sources
    dumped = pair.model_dump()["docs_sources"]
    assert {item["url"] for item in dumped} >= {"https://example.com/requests"}
    assert all({"title", "url", "query"} <= set(item) for item in dumped)
    assert all(item["query"] for item in dumped)
    assert calls  # the client was actually used


def test_disk_cache_hit_restores_docs_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second analyze is a disk-cache hit: same docs_sources, no LLM, no Tavily."""
    repo = _pair_repo(tmp_path)
    llm_calls: list[str] = []

    def fake_complete(prompt: str, **_kwargs) -> str:
        llm_calls.append(prompt)
        return json.dumps({
            "risk_score": 42,
            "risk_level": "medium",
            "rationale": "Both change run and import requests.",
        })

    tavily_calls: list = []
    _install(monkeypatch, tavily_calls)
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "nebius_api_key", "test-nebius-key")
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)

    first = sentinel.analyze(repo, "main", ["feat-a", "feat-b"], verify=False)
    pair = first.pairs[0]
    assert pair.score_source == "model"
    assert pair.model_cached is False
    sources = pair.model_dump()["docs_sources"]
    assert sources
    assert {item["url"] for item in sources} >= {"https://example.com/requests"}
    assert all({"title", "url", "query"} <= set(item) for item in sources)
    assert llm_calls
    assert tavily_calls
    stored = list((Path(settings.workspace_dir) / "nemotron-cache").glob("*.json"))
    assert len(stored) == 1
    assert json.loads(stored[0].read_text(encoding="utf-8"))["docs_sources"] == sources

    # The in-process query cache would hide a second lookup. Drop it so a
    # repeated search has to construct the client again.
    docs_lookup.clear_cache()
    llm_n = len(llm_calls)
    tavily_n = len(tavily_calls)

    second = sentinel.analyze(repo, "main", ["feat-a", "feat-b"], verify=False)
    again = second.pairs[0]
    assert len(llm_calls) == llm_n
    assert len(tavily_calls) == tavily_n
    assert second.usage is not None
    assert second.usage.llm_calls == 0
    assert second.usage.cache_hits == 1
    assert again.model_cached is True
    assert again.prompt_tokens == 0
    assert again.completion_tokens == 0
    assert again.model_dump()["docs_sources"] == sources


def test_legacy_cache_entry_without_docs_sources_loads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A file written before docs_sources existed still hits and yields []."""
    repo = _pair_repo(tmp_path)
    key = cache.cache_key(
        base_sha=git_service.rev_parse(repo, "main"),
        head_a=git_service.rev_parse(repo, "feat-a"),
        head_b=git_service.rev_parse(repo, "feat-b"),
        model=settings.nebius_model,
    )
    legacy = {
        "cached_at": 1.0,
        "completion_tokens": 4,
        "estimated_cost_usd": 0.0,
        "model": settings.nebius_model,
        "prompt_tokens": 10,
        "prompt_version": cache.PROMPT_VERSION,
        "rationale": "legacy assessment",
        "risk_level": "medium",
        "risk_score": 55.0,
        "total_tokens": 14,
    }
    directory = Path(settings.workspace_dir) / "nemotron-cache"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{key}.json").write_text(json.dumps(legacy), encoding="utf-8")

    loaded = cache.get(key)
    assert loaded is not None
    assert loaded.docs_sources == []
    assert loaded.rationale == "legacy assessment"

    llm_calls: list[str] = []

    def fake_complete(prompt: str, **_kwargs) -> str:
        llm_calls.append(prompt)
        return json.dumps({"risk_score": 1, "risk_level": "low", "rationale": "fresh"})

    tavily_calls: list = []
    _install(monkeypatch, tavily_calls)
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "nebius_api_key", "test-nebius-key")
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)

    res = sentinel.analyze(repo, "main", ["feat-a", "feat-b"], verify=False)
    pair = res.pairs[0]
    assert llm_calls == []
    assert tavily_calls == []
    assert res.usage is not None
    assert res.usage.llm_calls == 0
    assert res.usage.cache_hits == 1
    assert pair.model_cached is True
    assert pair.score_source == "model"
    assert pair.model_rationale == "legacy assessment"
    assert pair.docs_sources == []


def test_tavily_failure_does_not_fail_analysis(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    repo = _pair_repo(tmp_path)

    def fake_complete(prompt: str, **_kwargs) -> str:
        return json.dumps({"risk_score": 15, "risk_level": "low", "rationale": "Independent."})

    calls: list = []
    _install(monkeypatch, calls, error=RuntimeError(SECRET))
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "nebius_api_key", "test-nebius-key")
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)
    with caplog.at_level(logging.WARNING, logger="app.services.docs_lookup"):
        res = sentinel.analyze(repo, "main", ["feat-a", "feat-b"], verify=False)
    pair = res.pairs[0]
    assert pair.score_source == "model"
    assert pair.model_score == 15
    assert pair.docs_sources == []
    assert SECRET not in caplog.text


def test_verify_prompt_receives_docs_and_the_schema_is_filled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _pair_repo(tmp_path)
    prompts: list[str] = []

    def fake_complete(prompt: str, **_kwargs) -> str:
        prompts.append(prompt)
        return "this is not a test module\n"

    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "verify_max_attempts", 1)
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)

    pair = PairRisk(
        branch_a="feat-a", branch_b="feat-b", score=80, level="high", shared_files=1,
        overlapping_files=1, collisions=[], rationale="overlap", score_source="model",
        model_score=80, model_level="high",
    )
    result = verifier.verify_pair(repo, "main", pair, use_cache=False)
    assert prompts
    assert "Library documentation (via Tavily web search)" in prompts[0]
    assert "https://example.com/requests" in prompts[0]
    assert SECRET not in prompts[0]
    assert result.docs_sources
    attached = sentinel.apply_verification(pair, result)
    assert attached.docs_sources
    assert attached.docs_sources[0].url.startswith("https://")
    assert attached.model_dump()["docs_sources"][0]["query"]


def test_verify_prompt_is_unchanged_when_tavily_is_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _pair_repo(tmp_path)
    prompts: list[str] = []

    def fake_complete(prompt: str, **_kwargs) -> str:
        prompts.append(prompt)
        return "this is not a test module\n"

    calls: list = []
    _install(monkeypatch, calls)
    _enable(monkeypatch, key="")
    monkeypatch.setattr(settings, "verify_max_attempts", 1)
    monkeypatch.setattr("app.services.nemotron.complete", fake_complete)
    pair = PairRisk(
        branch_a="feat-a", branch_b="feat-b", score=80, level="high", shared_files=1,
        overlapping_files=1, collisions=[], rationale="overlap", score_source="model",
        model_score=80, model_level="high",
    )
    plain = verifier.build_test_prompt(repo, "main", "feat-a", "feat-b")
    result = verifier.verify_pair(repo, "main", pair, use_cache=False)
    assert result.docs_sources == []
    assert calls == []
    assert prompts and prompts[0] == plain
    assert "Tavily" not in prompts[0]


@pytest.mark.skipif(
    not (
        os.environ.get("TAVILY_API_KEY", "").strip()
        and os.environ.get("MERGEGUARD_LIVE_TAVILY") == "1"
    ),
    reason="set TAVILY_API_KEY and MERGEGUARD_LIVE_TAVILY=1 for a live Tavily search",
)
def test_live_tavily_search_for_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", os.environ["TAVILY_API_KEY"])
    monkeypatch.setattr(settings, "tavily_enabled", True)
    docs_lookup.clear_cache()
    snippets = docs_lookup.lookup(["import requests\n"], paths=["app.py"])
    assert snippets, "expected at least one snippet from a live Tavily search"
    assert any(item.url.startswith("http") for item in snippets)
    assert any(item.query for item in snippets)
