"""Tavily lookups for third-party libraries imported by a conflicting pair.

Snippets are added to the Nemotron risk and verify prompts. The lookup is a
no-op (no network) when the key is empty, ``TAVILY_ENABLED`` is false, or the
code only imports the standard library, relative modules, or the project
itself. Search failures are logged and swallowed: analysis still finishes.

``tavily-python`` 0.5.0 hardcodes a 100s ``requests`` timeout, so the call is
an httpx POST to ``https://api.tavily.com/search`` bounded by
``TAVILY_TIMEOUT_SECONDS``. Results are cached in-process per query.
"""
from __future__ import annotations

import logging
import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Snippet text returned to the prompts. Titles and urls sit on top of this.
CONTENT_BUDGET = 2000
PER_SNIPPET_CHARS = 700
MAX_QUERIES = 2
SEARCH_URL = "https://api.tavily.com/search"
DOCS_HEADING = "Library documentation (via Tavily web search)"

_STDLIB = {name.lower() for name in sys.stdlib_module_names}
_STDLIB.add("__future__")

# Node built-in module names (with or without a ``node:`` prefix).
_NODE_BUILTINS = {
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
    "zlib",
}

_SOURCE_SUFFIX = re.compile(r"\.(?:pyi|py|jsx|js|tsx|ts|mjs|cjs)$", re.IGNORECASE)
_PY_FROM = re.compile(
    r"(?m)^[ \t]*from[ \t]+(?P<dots>\.*)(?P<mod>[\w.]*)[ \t]+import[ \t]+"
    r"(?:\((?P<paren>[^)]*)\)|(?P<flat>[^#\n]+))"
)
_PY_IMPORT = re.compile(r"(?m)^[ \t]*import[ \t]+(?P<mods>[^#\n]+)")
_JS_FROM = re.compile(
    r"""(?:import|export)\s+(?:type\s+)?"""
    r"""(?:(?P<clause>\{.*?\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+|from\s+|\*\s+from\s+)"""
    r"""['"](?P<spec>[^'"]+)['"]""",
    re.DOTALL,
)
_JS_BARE = re.compile(
    r"""(?:^|\n)\s*(?:import|export)\s+['"](?P<spec>[^'"]+)['"]"""
)
_JS_REQUIRE = re.compile(
    r"""\b(?:require|import)\s*\(\s*['"](?P<spec>[^'"]+)['"]\s*\)"""
)
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_JS_NAME = re.compile(r"^[A-Za-z_$][\w$]*$")

_cache: dict[str, list[dict[str, str]]] = {}
_cache_lock = threading.Lock()


@dataclass(frozen=True)
class ImportHit:
    library: str
    symbol: str


@dataclass(frozen=True)
class DocSnippet:
    title: str
    url: str
    content: str
    query: str


class TavilyClient:
    """POST ``/search``. The API key is never included in ``repr``."""

    def __init__(self, api_key: str) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("missing Tavily api key")
        self._api_key = api_key

    def __repr__(self) -> str:
        return "TavilyClient(api_key='[redacted]')"

    def search(self, query: str, *, max_results: int, timeout: float) -> dict:
        response = httpx.post(
            SEARCH_URL,
            json={
                "api_key": self._api_key,
                "query": query,
                "topic": "general",
                "search_depth": "basic",
                "max_results": max_results,
                "include_answer": False,
                "include_raw_content": False,
            },
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise TypeError("Tavily response was not a JSON object")
        return data


def active() -> bool:
    """True only when a search is allowed to hit the network."""
    return bool(settings.tavily_enabled) and bool(settings.tavily_api_key.strip())


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _redact(text: str) -> str:
    key = settings.tavily_api_key.strip()
    if key and key in text:
        return text.replace(key, "[redacted]")
    return text


def _failure_label(exc: BaseException) -> str:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status:
        return f"{type(exc).__name__} status={status}"
    return type(exc).__name__


def _max_results() -> int:
    try:
        value = int(settings.tavily_max_results)
    except (TypeError, ValueError):
        value = 3
    return min(max(value, 1), 10)


def _timeout() -> float:
    try:
        value = float(settings.tavily_timeout_seconds)
    except (TypeError, ValueError):
        value = 8.0
    # httpx treats 0 as "fail immediately"; a non-positive setting would
    # either error or, on some versions, wait forever.
    return value if value > 0 else 8.0


def _normalize_source(text: str) -> str:
    """Drop unified-diff furniture so ``+import requests`` parses as source.

    Applied only to text that looks like a diff. A raw file is returned as-is,
    so a line that happens to start with ``+`` is left alone.
    """
    is_diff = text.startswith(("diff ", "@@")) or "\n@@" in text or "\ndiff " in text
    if not is_diff:
        return text
    kept: list[str] = []
    for line in text.splitlines():
        if line.startswith(("diff ", "index ", "@@", "+++", "---", "\\")):
            continue
        if line[:1] in "+- ":
            kept.append(line[1:])
        else:
            kept.append(line)
    return "\n".join(kept)


def _project_index(paths: list[str]) -> tuple[set[str], list[str]]:
    tops: set[str] = set()
    no_exts: list[str] = []
    for raw in paths:
        path = raw.replace("\\", "/").lstrip("/")
        while path.startswith("./"):
            path = path[2:]
        stripped = _SOURCE_SUFFIX.sub("", path)
        no_exts.append(stripped)
        parts = [part for part in stripped.split("/") if part and part != "__init__"]
        if parts:
            tops.add(parts[0])
            tops.add(parts[-1])
    return tops, no_exts


def _is_local_module(module: str, tops: set[str], no_exts: list[str]) -> bool:
    top = module.split(".")[0]
    if top in tops or module in tops:
        return True
    dotted = module.replace(".", "/")
    return any(path == dotted or path.endswith("/" + dotted) for path in no_exts)


def _imported_names(raw: str) -> list[str]:
    names: list[str] = []
    for part in raw.split("#", 1)[0].replace("(", " ").replace(")", " ").split(","):
        token = part.strip().split()
        if not token or token[0] in {"*", "as"}:
            continue
        if _NAME.match(token[0]):
            names.append(token[0])
    return names


def _js_symbol(clause: str | None) -> str:
    if not clause:
        return ""
    text = clause.strip()
    if not text.startswith("{"):
        return ""
    inner = text[1:].split("}", 1)[0]
    for chunk in inner.split(","):
        chunk = re.sub(r"^type\s+", "", chunk.strip())
        name = chunk.split(" as ")[0].strip()
        if _JS_NAME.match(name) and name not in {"type", "default"}:
            return name
    return ""


def _js_package(spec: str) -> str | None:
    spec = spec.strip().split("?", 1)[0].split("#", 1)[0].strip()
    if not spec or spec.startswith((".", "/", "~", "#")) or spec.startswith("@/"):
        return None
    if spec.startswith("node:") or ":" in spec.split("/")[0]:
        return None
    if spec.startswith("@"):
        scope, _, rest = spec.partition("/")
        pkg, _, _sub = rest.partition("/")
        if not scope or not pkg:
            return None
        name = f"{scope}/{pkg}"
    else:
        name = spec.split("/", 1)[0]
    if not name or name.lower() in _NODE_BUILTINS:
        return None
    return name


def _js_is_local(spec: str, paths: list[str]) -> bool:
    spec = spec.strip().split("?", 1)[0].split("#", 1)[0].strip()
    if not spec or spec.startswith((".", "/", "~/", "@/", "#")):
        return True
    for raw in paths:
        path = raw.replace("\\", "/")
        no_ext = _SOURCE_SUFFIX.sub("", path)
        if path == spec or no_ext == spec or no_ext.endswith("/" + spec):
            return True
    return False


def _add_python_module(
    found: list[tuple[int, ImportHit]],
    start: int,
    module: str,
    symbol: str,
    tops: set[str],
    no_exts: list[str],
) -> None:
    module = module.strip()
    if not module or module.startswith("."):
        return
    if _is_stdlib(module) or _is_local_module(module, tops, no_exts):
        return
    library = module.split(".")[0]
    if not library or _is_stdlib(library):
        return
    found.append((start, ImportHit(library=library, symbol=symbol)))


def _is_stdlib(module: str) -> bool:
    return module.split(".")[0].lower() in _STDLIB


def detect_imports(text: str, paths: list[str] | None = None) -> list[ImportHit]:
    """Third-party libraries named by Python or JS/TS import statements.

    Stdlib, Node built-ins, relative imports, and modules that correspond to
    ``paths`` (the pair's own files) are dropped. Order follows the source.
    """
    return _detect(_normalize_source(text), paths or [])


def _detect(text: str, paths: list[str]) -> list[ImportHit]:
    tops, no_exts = _project_index(paths)
    found: list[tuple[int, ImportHit]] = []

    for match in _PY_FROM.finditer(text):
        dots = match.group("dots") or ""
        module = match.group("mod") or ""
        if dots or not module:
            continue
        raw_names = match.group("paren") if match.group("paren") is not None else match.group("flat") or ""
        names = _imported_names(raw_names)
        _add_python_module(found, match.start(), module, names[0] if names else "", tops, no_exts)

    for match in _PY_IMPORT.finditer(text):
        raw = match.group("mods")
        # ``import x from 'react'`` and ``require('x')`` are JavaScript.
        if "'" in raw or '"' in raw or re.search(r"\bfrom\b", raw):
            continue
        for module in _py_modules(raw):
            _add_python_module(found, match.start(), module, "", tops, no_exts)

    def add_js(start: int, spec: str, symbol: str) -> None:
        if _js_is_local(spec, paths):
            return
        name = _js_package(spec)
        if name:
            found.append((start, ImportHit(library=name, symbol=symbol)))

    for match in _JS_FROM.finditer(text):
        add_js(match.start(), match.group("spec"), _js_symbol(match.group("clause")))
    for match in _JS_BARE.finditer(text):
        add_js(match.start(), match.group("spec"), "")
    for match in _JS_REQUIRE.finditer(text):
        add_js(match.start(), match.group("spec"), "")

    found.sort(key=lambda item: item[0])
    return [hit for _start, hit in found]


def _py_modules(raw: str) -> list[str]:
    modules: list[str] = []
    for part in raw.split(","):
        token = part.strip().split()
        if not token:
            continue
        name = token[0]
        if re.match(r"^[\w.]+$", name):
            modules.append(name)
    return modules


def build_queries(hits: list[ImportHit], *, limit: int = MAX_QUERIES) -> list[str]:
    """At most ``limit`` queries, in source order, one per library.

    A later import of the same library can add a symbol the first one lacked
    (``import fastapi`` then ``from fastapi import FastAPI``).
    """
    chosen: list[list[str]] = []
    index: dict[str, int] = {}
    for hit in hits:
        slot = index.get(hit.library)
        if slot is None:
            if len(chosen) >= limit:
                continue
            index[hit.library] = len(chosen)
            chosen.append([hit.library, hit.symbol])
            continue
        if not chosen[slot][1] and hit.symbol:
            chosen[slot][1] = hit.symbol
    queries: list[str] = []
    for library, symbol in chosen:
        library = " ".join(library.split())
        symbol = " ".join(symbol.split())
        if not library:
            continue
        if symbol:
            queries.append(f"{library} {symbol} documentation")
        else:
            queries.append(f"{library} documentation")
    return queries


def format_docs_section(snippets: list[DocSnippet]) -> str:
    """Prompt block. Empty when there is nothing to add, so callers that
    append it leave the rest of the prompt byte-for-byte unchanged."""
    if not snippets:
        return ""
    lines = [
        f"{DOCS_HEADING}:",
        "External reference for libraries this pair imports. Not repository code.",
    ]
    for snippet in snippets:
        lines.append(f"- {snippet.title or '(untitled)'}")
        lines.append(f"  url: {snippet.url}")
        lines.append(f"  query: {snippet.query}")
        if snippet.content:
            lines.append(f"  {snippet.content}")
    return "\n".join(lines)


def to_sources(snippets: list[DocSnippet]) -> list[dict[str, str]]:
    """``{title, url, query}`` records for the API schema. No snippet body."""
    return [{"title": snippet.title, "url": snippet.url, "query": snippet.query} for snippet in snippets]


def lookup(texts: list[str], paths: list[str] | None = None) -> list[DocSnippet]:
    """Search Tavily for libraries imported in ``texts``. Never raises.

    Returns ``[]`` without a network call when the feature is off or nothing
    third-party is imported.
    """
    if not active():
        return []
    try:
        chunks = [_normalize_source(text) for text in texts if text and text.strip()]
        hits = _detect("\n".join(chunks), list(paths or []))
        queries = build_queries(hits)
        if not queries:
            return []
        return _collect(queries)
    except Exception as exc:
        logger.warning("Tavily docs lookup failed: %s", _failure_label(exc))
        return []


def lookup_for_pair(
    repo: Path,
    base: str,
    branch_a: str,
    branch_b: str,
    *,
    diff_by_branch: dict | None = None,
) -> list[DocSnippet]:
    """Imports from both branches' changed source files, then :func:`lookup`."""
    if not active():
        return []
    try:
        paths, texts = _code_for_pair(repo, base, branch_a, branch_b, diff_by_branch)
    except Exception as exc:
        logger.warning("Tavily docs context failed: %s", _failure_label(exc))
        return []
    return lookup(texts, paths)


def _code_for_pair(
    repo: Path,
    base: str,
    branch_a: str,
    branch_b: str,
    diff_by_branch: dict | None,
) -> tuple[list[str], list[str]]:
    # Local import: git_service pulls schemas, and this module stays importable
    # from tests that never touch git.
    from app.services import git_service

    paths: list[str] = []
    texts: list[str] = []
    seen: set[str] = set()
    for branch in (branch_a, branch_b):
        diff = diff_by_branch.get(branch) if diff_by_branch else None
        if diff is None:
            diff = git_service.diff_against_base(repo, branch, base)
        src = [item.path for item in diff.files if _SOURCE_SUFFIX.search(item.path)]
        for path in src:
            if path not in seen:
                seen.add(path)
                paths.append(path)
        if not src:
            continue
        try:
            texts.append(
                git_service.trimmed_diff(
                    repo, branch, base, src[:12], max_chars=8000, function_context=False,
                )
            )
        except git_service.GitError:
            pass
        # Import lines often sit above the hunk. The file head catches those
        # that the branch did not itself change.
        for path in src[:8]:
            body = git_service.show_file(repo, branch, path)
            if body:
                texts.append("\n".join(body.splitlines()[:150]))
    return paths, texts


def _collect(queries: list[str]) -> list[DocSnippet]:
    grouped: list[tuple[str, list[dict[str, str]]]] = []
    for query in queries:
        grouped.append((query, _search_cached(query)))
    return _trim(grouped)


def _search_cached(query: str) -> list[dict[str, str]]:
    key = f"{_max_results()}\n{query.strip().casefold()}"
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    try:
        payload = TavilyClient(api_key=settings.tavily_api_key.strip()).search(
            query,
            max_results=_max_results(),
            timeout=_timeout(),
        )
    except Exception as exc:
        # The exception text can quote the request. Log only the type.
        logger.warning(
            "Tavily search failed query=%s error=%s",
            _redact(query)[:200],
            _failure_label(exc),
        )
        return []
    raw = payload.get("results")
    if not isinstance(raw, list):
        logger.warning("Tavily search returned no results list query=%s", _redact(query)[:200])
        return []
    cleaned = [_public_result(item) for item in raw]
    cleaned = [item for item in cleaned if item is not None]
    with _cache_lock:
        _cache[key] = cleaned
    return cleaned


def _public_result(item: object) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    url = item.get("url")
    if not isinstance(url, str) or not url.strip():
        return None
    title = item.get("title") if isinstance(item.get("title"), str) else ""
    content = item.get("content") if isinstance(item.get("content"), str) else ""
    return {
        "title": _redact(" ".join(title.split()))[:300],
        "url": _redact(url.strip())[:1000],
        "content": _redact(" ".join(content.split())),
    }


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    if limit <= 3:
        return text[:limit]
    return text[: limit - 3].rstrip() + "..."


def _trim(grouped: list[tuple[str, list[dict[str, str]]]]) -> list[DocSnippet]:
    snippets: list[DocSnippet] = []
    used = 0
    cap = _max_results()
    for query, results in grouped:
        for item in results[:cap]:
            if used >= CONTENT_BUDGET:
                return snippets
            room = CONTENT_BUDGET - used
            content = _clip(item["content"], min(PER_SNIPPET_CHARS, room))
            snippets.append(
                DocSnippet(
                    title=item["title"],
                    url=item["url"],
                    content=content,
                    query=_redact(query),
                )
            )
            used += len(content)
    return snippets
