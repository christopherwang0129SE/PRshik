"""Tavily lookups for third-party libraries imported by a conflicting pair.

Snippets are added to the Nemotron risk and verify prompts. The lookup is a
no-op (no network) when the key is empty, ``TAVILY_ENABLED`` is false, or the
code only imports the standard library, relative modules, or the project
itself. Search failures are logged and swallowed: analysis still finishes.

Queries name up to two symbols from the conflicting lines (imported names, or
attributes called on the module alias). A library with no symbol falls back to
``"<library> documentation"``. ``requests``, ``fastapi``, ``pydantic``, and
``react`` also send ``include_domains`` for their official docs host. Hits
whose title and content never mention the library are dropped; that is not
an error. A translated mirror (Read the Docs ``/projects/<lang>/``, or a path
segment such as ``/it/`` or ``/zh-cn/``) is dropped when any other hit remains,
and ``/en/latest`` and ``/en/master`` copies of one page count once.

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
from urllib.parse import urlsplit

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Snippet text returned to the prompts. Titles and urls sit on top of this.
CONTENT_BUDGET = 2000
PER_SNIPPET_CHARS = 700
MAX_QUERIES = 2
MAX_SYMBOLS = 2
SEARCH_URL = "https://api.tavily.com/search"
DOCS_HEADING = "Library documentation (via Tavily web search)"

# Official docs hosts. Anything else is left to the query string.
_OFFICIAL_DOMAINS = {
    "requests": "requests.readthedocs.io",
    "fastapi": "fastapi.tiangolo.com",
    "pydantic": "docs.pydantic.dev",
    "react": "react.dev",
}

# Full path segments that mean a translated docs tree. ``iteration`` does not
# match; the segment has to be the locale itself. Underscores are normalized
# (``zh_CN`` == ``zh-cn``).
_NON_ENGLISH_PATH_SEGMENTS = frozenset({
    "it", "zh-cn", "ja", "ko", "fr", "de", "es", "pt-br", "ru",
})
_ENGLISH_LOCALES = frozenset({"en", "en-us", "en-gb", "en-au"})
# Read the Docs hosts translations as subprojects. ``cn`` is the Chinese
# project slug; the locale segment beside it is ``zh-cn``, which the set
# above already catches. Other slugs show up the same way (``/projects/ja/``).
_RTD_TRANSLATION_SLUGS = _NON_ENGLISH_PATH_SEGMENTS | frozenset({
    "cn", "zh", "zh-tw", "zh-hans", "zh-hant", "pt", "jp", "kr",
    "pt-pt", "es-mx", "uk", "pl", "nl", "tr", "bg", "da", "ar",
    "sv", "fi", "el", "hu", "no", "nb", "ro", "sk", "th", "vi",
    "fa", "he", "id", "cs", "ua",
})
# Floating version names for one page. Numbered releases stay distinct so
# ``/en/3.11/`` and ``/en/3.12/`` are not collapsed.
_FLOATING_VERSIONS = frozenset({"latest", "master", "main", "stable"})
_VERSION_LOCALES = _ENGLISH_LOCALES | _NON_ENGLISH_PATH_SEGMENTS | _RTD_TRANSLATION_SLUGS

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
    # Binding used to find call sites. ``import requests as req`` stores ``req``
    # here and leaves ``symbol`` empty. Hits returned for a query leave it empty.
    local: str = ""


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

    def search(
        self,
        query: str,
        *,
        max_results: int,
        timeout: float,
        include_domains: list[str] | None = None,
    ) -> dict:
        body: dict[str, object] = {
            "api_key": self._api_key,
            "query": query,
            "topic": "general",
            "search_depth": "basic",
            "max_results": max_results,
            "include_answer": False,
            "include_raw_content": False,
        }
        # Omitted entirely for libraries without a known docs host.
        if include_domains:
            body["include_domains"] = list(include_domains)
        response = httpx.post(
            SEARCH_URL,
            json=body,
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


def _looks_like_diff(text: str) -> bool:
    return text.startswith(("diff ", "@@")) or "\n@@" in text or "\ndiff " in text


def _normalize_source(text: str) -> str:
    """Drop unified-diff furniture so ``+import requests`` parses as source.

    Applied only to text that looks like a diff. A raw file is returned as-is,
    so a line that happens to start with ``+`` is left alone.
    """
    if not _looks_like_diff(text):
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


def _changed_lines(text: str) -> list[str]:
    """Added and removed source lines. Empty when ``text`` is not a diff."""
    if not _looks_like_diff(text):
        return []
    lines: list[str] = []
    for line in text.splitlines():
        if line.startswith(("diff ", "index ", "@@", "+++", "---", "\\")):
            continue
        if line[:1] in "+-" and line[1:].strip():
            lines.append(line[1:])
    return lines


def _is_import_line(line: str) -> bool:
    stripped = line.strip()
    for keyword in ("import", "from", "export"):
        if not stripped.startswith(keyword):
            continue
        if len(stripped) == len(keyword):
            return True
        if stripped[len(keyword)] in " \t'\"{*(":
            return True
    return False


def _import_spans(text: str) -> list[tuple[int, int]]:
    """Character ranges covered by import statements, including continuations.

    A parenthesized ``from x import (`` or a braced ``import {`` keeps the
    following lines inside the statement until the bracket closes. Otherwise
    ``Depends`` on its own continuation line looks like a use.
    """
    spans: list[tuple[int, int]] = []
    offset = 0
    depth = 0
    for line in text.splitlines(keepends=True):
        start = offset
        end = offset + len(line)
        offset = end
        if depth > 0 or _is_import_line(line):
            spans.append((start, end))
            depth += line.count("(") + line.count("{") + line.count("[")
            depth -= line.count(")") + line.count("}") + line.count("]")
            if depth < 0:
                depth = 0
    return spans


def _in_spans(spans: list[tuple[int, int]], pos: int) -> bool:
    for start, end in spans:
        if start <= pos < end:
            return True
        if start > pos:
            return False
    return False


_ATTR_IDENT = r"[A-Za-z_$][\w$]*"


def _ident_pattern(name: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![\w$]){re.escape(name)}(?![\w$])")


def _official_domains(library: str) -> list[str] | None:
    domain = _OFFICIAL_DOMAINS.get(library.casefold())
    if not domain:
        return None
    return [domain]


def _query_library(query: str) -> str:
    stripped = query.strip()
    if not stripped:
        return ""
    return stripped.split(maxsplit=1)[0]


def _mentions_library(item: dict[str, str], library: str) -> bool:
    if not library:
        return True
    haystack = f"{item.get('title', '')}\n{item.get('content', '')}".casefold()
    return library.casefold() in haystack


def _drop_prefixes(symbols: list[str]) -> list[str]:
    """Drop ``Session`` when ``Session.mount`` is already in the list."""
    return [
        symbol
        for symbol in symbols
        if not any(other != symbol and other.startswith(symbol + ".") for other in symbols)
    ]


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


def _imported_pairs(raw: str) -> list[tuple[str, str]]:
    """``(public_name, local_name)`` from a ``from module import ...`` list."""
    pairs: list[tuple[str, str]] = []
    text = raw.split("#", 1)[0].replace("(", " ").replace(")", " ")
    for part in text.split(","):
        tokens = part.strip().split()
        if not tokens or tokens[0] in {"*", "as"}:
            continue
        public = tokens[0]
        if not _NAME.match(public):
            continue
        local = public
        if "as" in tokens:
            at = tokens.index("as")
            if at + 1 < len(tokens) and _NAME.match(tokens[at + 1]):
                local = tokens[at + 1]
        pairs.append((public, local))
    return pairs


def _py_import_bindings(raw: str) -> list[tuple[str, str]]:
    """``(module, local_name)`` from ``import a, b as c``."""
    bindings: list[tuple[str, str]] = []
    for part in raw.split(","):
        tokens = part.strip().split()
        if not tokens:
            continue
        module = tokens[0]
        if not re.match(r"^[\w.]+$", module):
            continue
        local = module.split(".")[0]
        if "as" in tokens:
            at = tokens.index("as")
            if at + 1 < len(tokens) and _NAME.match(tokens[at + 1]):
                local = tokens[at + 1]
        bindings.append((module, local))
    return bindings


def _js_bindings(clause: str | None) -> list[tuple[str, str]]:
    """``(local_name, public_symbol)`` from an ES import clause.

    A default or namespace import binds a module alias, so the public symbol
    is empty. Named imports keep the exported name (``useEffect as effect``
    documents ``useEffect`` and matches calls to ``effect``).
    """
    if not clause:
        return []
    text = " ".join(clause.strip().split())
    if text.startswith("{"):
        inner = text[1:].split("}", 1)[0]
        found: list[tuple[str, str]] = []
        for chunk in inner.split(","):
            chunk = re.sub(r"^type\s+", "", chunk.strip())
            parts = chunk.split()
            if not parts:
                continue
            public = parts[0]
            local = public
            if "as" in parts:
                at = parts.index("as")
                if at + 1 < len(parts):
                    local = parts[at + 1]
            if (
                _JS_NAME.match(public)
                and public not in {"type", "default"}
                and _JS_NAME.match(local)
            ):
                found.append((local, public))
        return found
    namespace = re.fullmatch(r"\*\s+as\s+([\w$]+)", text)
    if namespace:
        return [(namespace.group(1), "")]
    if _JS_NAME.match(text):
        return [(text, "")]
    return []


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
    local: str,
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
    found.append((start, ImportHit(library=library, symbol=symbol, local=local or symbol)))


def _is_stdlib(module: str) -> bool:
    return module.split(".")[0].lower() in _STDLIB


def detect_imports(text: str, paths: list[str] | None = None) -> list[ImportHit]:
    """Third-party libraries named by Python or JS/TS import statements.

    Stdlib, Node built-ins, relative imports, and modules that correspond to
    ``paths`` (the pair's own files) are dropped. Order follows the source.
    On a diff, symbols that show up on added or removed lines replace imports
    the hunk never uses. A bare module import keeps an empty symbol.
    """
    paths = list(paths or [])
    normalized = _normalize_source(text)
    hits = _statement_hits(normalized, paths)
    if _looks_like_diff(text):
        usage = "\n".join(_changed_lines(text))
    else:
        usage = normalized
    return _apply_usage(hits, usage, context=normalized)


def _statement_hits(text: str, paths: list[str]) -> list[ImportHit]:
    tops, no_exts = _project_index(paths)
    found: list[tuple[int, ImportHit]] = []

    for match in _PY_FROM.finditer(text):
        dots = match.group("dots") or ""
        module = match.group("mod") or ""
        if dots or not module:
            continue
        raw_names = match.group("paren") if match.group("paren") is not None else match.group("flat") or ""
        pairs = _imported_pairs(raw_names)
        if not pairs:
            _add_python_module(found, match.start(), module, "", "", tops, no_exts)
        else:
            for public, local in pairs:
                _add_python_module(found, match.start(), module, public, local, tops, no_exts)

    for match in _PY_IMPORT.finditer(text):
        raw = match.group("mods")
        # ``import x from 'react'`` and ``require('x')`` are JavaScript.
        if "'" in raw or '"' in raw or re.search(r"\bfrom\b", raw):
            continue
        for module, local in _py_import_bindings(raw):
            _add_python_module(found, match.start(), module, "", local, tops, no_exts)

    def add_js(start: int, spec: str, symbol: str, local: str = "") -> None:
        if _js_is_local(spec, paths):
            return
        name = _js_package(spec)
        if name:
            found.append((
                start,
                ImportHit(library=name, symbol=symbol, local=local or symbol),
            ))

    for match in _JS_FROM.finditer(text):
        bindings = _js_bindings(match.group("clause"))
        if bindings:
            for local, public in bindings:
                add_js(match.start(), match.group("spec"), public, local)
        else:
            add_js(match.start(), match.group("spec"), "")
    for match in _JS_BARE.finditer(text):
        add_js(match.start(), match.group("spec"), "")
    for match in _JS_REQUIRE.finditer(text):
        add_js(match.start(), match.group("spec"), "")

    found.sort(key=lambda item: item[0])
    return [hit for _start, hit in found]


def _call_symbols(
    hits: list[ImportHit],
    *,
    context: str,
    usage: str,
) -> list[tuple[str, str, int]]:
    """``(library, symbol, position)`` for attribute calls inside ``usage``.

    ``session = requests.Session()`` may sit outside the hunk. The assignment
    is resolved from ``context``; only ``session.mount`` / ``requests.get``
    that appear in ``usage`` become symbols.
    """
    if not usage.strip():
        return []
    aliases: list[tuple[str, str]] = []
    seen_alias: set[tuple[str, str]] = set()
    for hit in hits:
        if hit.symbol or not hit.local:
            continue
        key = (hit.local, hit.library)
        if key in seen_alias:
            continue
        seen_alias.add(key)
        aliases.append(key)

    constructors: dict[str, tuple[str, str]] = {}
    if context:
        for local, library in aliases:
            assign = re.compile(
                rf"(?<![\w$])(?P<var>{_ATTR_IDENT})\s*=\s*"
                rf"{re.escape(local)}\.(?P<cls>{_ATTR_IDENT})\s*\("
            )
            for match in assign.finditer(context):
                cls = match.group("cls")
                if cls[:1].isupper():
                    constructors[match.group("var")] = (library, cls)

    found: list[tuple[str, str, int]] = []
    seen: set[tuple[str, str]] = set()

    def add(library: str, symbol: str, pos: int) -> None:
        key = (library, symbol)
        if not symbol or key in seen:
            return
        seen.add(key)
        found.append((library, symbol, pos))

    for local, library in aliases:
        attr = re.compile(
            rf"(?<![\w$]){re.escape(local)}\.(?P<attr>{_ATTR_IDENT})"
        )
        for match in attr.finditer(usage):
            add(library, match.group("attr"), match.start())
        chained = re.compile(
            rf"(?<![\w$]){re.escape(local)}\.(?P<cls>{_ATTR_IDENT})\s*\("
            rf"[^)]*\)\s*\.(?P<meth>{_ATTR_IDENT})"
        )
        for match in chained.finditer(usage):
            cls = match.group("cls")
            if cls[:1].isupper():
                add(library, f"{cls}.{match.group('meth')}", match.start())

    for var, (library, cls) in constructors.items():
        method = re.compile(rf"(?<![\w$]){re.escape(var)}\.(?P<meth>{_ATTR_IDENT})")
        for match in method.finditer(usage):
            add(library, f"{cls}.{match.group('meth')}", match.start())

    found.sort(key=lambda item: (item[2], item[0], item[1]))
    return found


def _first_code_pos(text: str, spans: list[tuple[int, int]], name: str) -> int | None:
    if not name:
        return None
    for match in _ident_pattern(name).finditer(text):
        if not _in_spans(spans, match.start()):
            return match.start()
    return None


def _apply_usage(hits: list[ImportHit], usage: str, *, context: str) -> list[ImportHit]:
    """Prefer symbols that occur in ``usage`` over imported names that do not.

    ``usage`` is the changed lines of a diff, or the whole file when the text
    is not a diff. Imported names still fill the query when nothing in
    ``usage`` names a symbol.
    """
    calls: dict[str, list[tuple[int, str]]] = {}
    for library, symbol, pos in _call_symbols(hits, context=context, usage=usage):
        calls.setdefault(library, []).append((pos, symbol))
    spans = _import_spans(usage)

    grouped: list[tuple[str, list[ImportHit]]] = []
    index: dict[str, int] = {}
    for hit in hits:
        slot = index.get(hit.library)
        if slot is None:
            index[hit.library] = len(grouped)
            grouped.append((hit.library, []))
            slot = index[hit.library]
        grouped[slot][1].append(hit)

    selected: list[ImportHit] = []
    for library, group in grouped:
        imported: list[tuple[str, str]] = []
        seen_symbol: set[str] = set()
        for hit in group:
            if not hit.symbol or hit.symbol in seen_symbol:
                continue
            seen_symbol.add(hit.symbol)
            imported.append((hit.symbol, hit.local or hit.symbol))

        used: list[tuple[int, str]] = []
        used_seen: set[str] = set()
        for symbol, local in imported:
            pos = _first_code_pos(usage, spans, local)
            if pos is None or symbol in used_seen:
                continue
            used_seen.add(symbol)
            used.append((pos, symbol))
        for pos, symbol in calls.get(library, []):
            if symbol in used_seen:
                continue
            used_seen.add(symbol)
            used.append((pos, symbol))
        used.sort(key=lambda item: (item[0], item[1]))
        symbols = _drop_prefixes([symbol for _pos, symbol in used])
        if not symbols:
            symbols = [symbol for symbol, _local in imported]
        if symbols:
            selected.extend(ImportHit(library=library, symbol=symbol) for symbol in symbols)
        else:
            selected.append(ImportHit(library=library, symbol=""))
    return selected


def build_queries(hits: list[ImportHit], *, limit: int = MAX_QUERIES) -> list[str]:
    """At most ``limit`` queries, in source order, one per library.

    Each query names up to ``MAX_SYMBOLS`` symbols. A later import can still
    fill a symbol the first one lacked (``import fastapi`` then ``from fastapi
    import FastAPI``). No symbol at all becomes ``"<library> documentation"``.
    """
    chosen: list[list[str]] = []
    index: dict[str, int] = {}
    for hit in hits:
        slot = index.get(hit.library)
        if slot is None:
            if len(chosen) >= limit:
                continue
            index[hit.library] = len(chosen)
            chosen.append([hit.library])
            slot = index[hit.library]
        symbol = " ".join(hit.symbol.split())
        if symbol and symbol not in chosen[slot][1:] and len(chosen[slot]) - 1 < MAX_SYMBOLS:
            chosen[slot].append(symbol)
    queries: list[str] = []
    for parts in chosen:
        library = " ".join(parts[0].split())
        if not library:
            continue
        symbols = parts[1:]
        if symbols:
            queries.append(f"{library} {' '.join(symbols)} documentation")
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
        raws = [text for text in texts if text and text.strip()]
        norms = [_normalize_source(text) for text in raws]
        hits = _statement_hits("\n".join(norms), list(paths or []))
        # File heads carry imports that the hunk did not touch. Attribute
        # calls count only on added or removed lines when any text is a diff,
        # so an unchanged ``requests.post`` does not crowd out ``requests.get``.
        if any(_looks_like_diff(text) for text in raws):
            usage = "\n".join(line for text in raws for line in _changed_lines(text))
            context = "\n".join(norms)
        else:
            usage = "\n".join(norms)
            context = usage
        queries = build_queries(_apply_usage(hits, usage, context=context))
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


def _norm_locale(segment: str) -> str:
    return segment.casefold().replace("_", "-")


def _is_readthedocs_host(host: str) -> bool:
    name = host.split(":", 1)[0]
    return (
        name == "readthedocs.io"
        or name.endswith(".readthedocs.io")
        or name == "readthedocs.org"
        or name.endswith(".readthedocs.org")
    )


def _is_translated_doc_url(url: str) -> bool:
    """True when the path is a non-English docs mirror.

    Two shapes count: a locale segment (``/fr/``, ``/zh-cn/``) anywhere, and a
    Read the Docs translation subproject (``/projects/cn/``, ``/projects/it/``).
    English ``/en/`` stays. A longer segment such as ``iteration`` does not match.
    """
    split = urlsplit(url)
    locales = [_norm_locale(part) for part in split.path.split("/") if part]
    if any(part in _NON_ENGLISH_PATH_SEGMENTS for part in locales):
        return True
    if not _is_readthedocs_host(split.netloc.casefold()):
        return False
    for index, part in enumerate(locales):
        if part != "projects" or index + 1 >= len(locales):
            continue
        slug = locales[index + 1]
        if slug not in _ENGLISH_LOCALES and slug in _RTD_TRANSLATION_SLUGS:
            return True
    return False


def _doc_page_key(url: str) -> str:
    """Identity of a doc page, ignoring the floating version segment.

    ``/en/latest/user/advanced.html`` and ``/en/master/user/advanced.html``
    share a key. The locale stays, so a translation is not the English page.
    """
    split = urlsplit(url.strip())
    parts = [part for part in split.path.split("/") if part]
    kept: list[str] = []
    index = 0
    while index < len(parts):
        current = parts[index]
        if (
            _norm_locale(current) in _VERSION_LOCALES
            and index + 1 < len(parts)
            and parts[index + 1].casefold() in _FLOATING_VERSIONS
        ):
            kept.append(_norm_locale(current))
            index += 2
            continue
        kept.append(current.casefold())
        index += 1
    if kept and kept[-1].endswith(".html"):
        kept[-1] = kept[-1][:-5]
    if kept and kept[-1] == "index":
        kept.pop()
    host = split.netloc.casefold()
    if host.startswith("www."):
        host = host[4:]
    return f"{host}/{'/'.join(kept)}"


def _prefer_original_docs(results: list[dict[str, str]]) -> list[dict[str, str]]:
    """Drop translation mirrors when anything else matched, then collapse versions.

    Mirrors are kept only when every hit is a translation, so the lookup still
    returns a snippet instead of nothing. The first URL of a version pair wins.
    """
    originals = [item for item in results if not _is_translated_doc_url(item["url"])]
    chosen = originals if originals else results
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for item in chosen:
        key = _doc_page_key(item["url"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _search_cached(query: str) -> list[dict[str, str]]:
    key = f"{_max_results()}\n{query.strip().casefold()}"
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    library = _query_library(query)
    domains = _official_domains(library)
    try:
        client = TavilyClient(api_key=settings.tavily_api_key.strip())
        if domains:
            payload = client.search(
                query,
                max_results=_max_results(),
                timeout=_timeout(),
                include_domains=domains,
            )
        else:
            payload = client.search(
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
    try:
        cleaned = [item for item in cleaned if _mentions_library(item, library)]
    except Exception:
        # A bad hit must not fail the lookup. Keep the unfiltered list.
        logger.warning("Tavily relevance filter failed query=%s", _redact(query)[:200])
    cleaned = _prefer_original_docs(cleaned)
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
