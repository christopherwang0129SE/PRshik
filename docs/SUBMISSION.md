<!-- NAME NOT LOCKED: repo=mergeguard, deck says "Mergesolver"/"Big Boi AI".
     Pick one and find-replace before submitting. Using "MergeGuard" throughout. -->

# MergeGuard — Hackathon Submission

**Project name: MergeGuard (final name pending).**

**One-liner:** MergeGuard is the bouncer for your codebase — an agent-based system that kills merge conflicts on Git *before they exist*, so humans and AI coding agents can build in parallel without stepping on each other. Green means go, red means talk.

**Built for:** Nebius x NVIDIA Global AI Hackathon (Devpost)
**Deadline:** Fri 30 Oct 2026, 18:00 Copenhagen time
**Track:** Developer tooling / Coding Agents

Tavily is a sponsor-tool integration (library-doc lookup inside Sentinel and verify-by-test). It is not the name of the hackathon. The model is NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) on Nebius Token Factory.

> ℹ️ Draft copy — grounded in what's actually built (the Sentinel predictor). Lines marked _[confirm]_ depend on how far the build gets; adjust before final submission.

---

## Inspiration

Modern teams don't build in a straight line — they build in parallel. And it's not just humans anymore: we're entering an era where a single repo can have a whole **fleet of AI coding agents** committing at once. We kept circling one question:

> *What happens when two commits touch the same code at the same time?*

Today you find out at the worst possible moment — **after** everyone has already finished, when Git throws a wall of conflict markers. Merge conflicts get treated as an accident to clean up. We realised they're actually **predictable** — and if they're predictable, they're preventable. MergeGuard was born from wanting a guard standing at the merge point who sees the collision forming and stops it before it happens.

## What it does

MergeGuard **minimises merge conflicts on Git before they exist.** It continuously watches every in-flight branch, and for each pair of branches it computes a **conflict-risk score** by diffing them at the changed-region level — same file, overlapping or adjacent lines. It surfaces that as a simple **traffic light** for every developer (or agent):

- 🟢 **Green** — clear to keep working.
- 🟡 **Yellow** — someone is working near your code; coordinate soon.
- 🔴 **Red** — you *will* collide; resolve now. (A Merger agent that would resolve it is still planned.)

That same signal doubles as a **review-prioritisation indicator**: the pull requests most at risk of colliding bubble to the top, so maintainers review and merge them in the right order. A PM-facing dashboard turns raw branch activity into **per-developer stats and collision exposure**, so team leads can plan around hotspots instead of firefighting them.

## How we built it

- **Backend — FastAPI.** The core **Sentinel** engine is dependency-free: it shells out to Git to compute merge-bases and per-branch diffs (`git diff -U0`), parses the changed line-ranges (hunks) per file, and scores every branch pair for region overlap using an **adjacency window** — because real Git conflicts come from *adjacent* edits, not just exact overlaps.
- **Reasoning layer — Nebius Token Factory** (OpenAI-compatible API at `https://api.tokenfactory.nebius.com/v1/`, model `nvidia/nemotron-3-super-120b-a12b`, NVIDIA Nemotron 3 Super): explains *why* two branches collide, and writes the pytest module for verify-by-test. Each chat-completions call is one attempt. Cost on the response is estimated from token usage. Identical inputs hit a disk cache. The Planner and Merger agents are still planned, so Token Factory is not producing semantic merges.
- **Library docs — Tavily:** runtime lookup for the Sentinel risk prompt and the verify-by-test prompt, not a search step inside the future Merger. When a pair's changed files import a third-party library, MergeGuard runs up to two searches (`POST https://api.tavily.com/search`, `TAVILY_TIMEOUT_SECONDS`, `TAVILY_MAX_RESULTS`), trims the snippets, and appends a "Library documentation (via Tavily web search)" section. The API returns `docs_sources` (`title`, `url`, `query`) on the pair and on the verification result. No key, or `TAVILY_ENABLED=false`, is a no-op: no network call, prompts unchanged, errors swallowed. The bundled checkout demo imports only the Python standard library, so Tavily stays idle there. A repo that imports something like `requests` is what triggers it.
- **Frontend — dashboard:** branch graph, conflict-risk heatmap, and each developer's live traffic light. _[confirm scope]_
- **Validation:** an end-to-end test builds a throwaway repo with intentionally overlapping branches and asserts the Sentinel flags them and ranks the riskiest pair first.

## How Nebius Token Factory and Tavily are used

Token Factory is where NVIDIA Nemotron 3 Super runs. It writes the pair risk explanation and the intent test for verify-by-test. Each call is a single chat-completions attempt. The API reports token usage and an estimated cost. Repeat runs of the same SHAs come from disk.

Tavily is the library-doc lookup for both of those prompts. Up to two searches, snippets trimmed into a "Library documentation (via Tavily web search)" section, and `docs_sources` (`title`, `url`, `query`) on the pair and on the verification result. That array is what a pair card would show as "Grounded with library docs". The dashboard type includes `docs_sources`. The pair table does not render that label. Empty `TAVILY_API_KEY` or `TAVILY_ENABLED=false` skips the network. The checkout demo never triggers it, because it only imports the Python standard library. Planner and Merger are still planned. Tavily is already used by Sentinel and verify-by-test.

## Challenges we ran into

- **"Same file" ≠ "conflict."** Two people editing opposite ends of a 2,000-line file don't conflict; two editing adjacent lines do. Matching *real* Git behaviour meant parsing hunk ranges and adding an adjacency window, not just intersecting file lists.
- **The concurrency question.** Reasoning about "two commits at the same time" pushed us to model risk over diffs against a shared **merge-base**, rather than raw commit order.
- **Environment friction.** Python 3.9 wouldn't evaluate modern type syntax at runtime; we resolved it with a compatibility shim instead of losing a day to a version fight — ironically, avoiding our own kind of conflict.
- **Building in parallel without conflicting on ourselves.** We froze a shared, additive **API schema** as the contract so frontend, integration, and engine work could proceed independently — eating our own dog food.

## Accomplishments that we're proud of

- A **working predictor**, not a mock — point it at any Git repo and it returns ranked, explainable conflict-risk scores with human-readable rationales.
- Turned a vague pain ("merge hell") into a crisp, quantified **traffic-light signal** any developer understands in half a second.
- A clean agent architecture — **Sentinel → Planner → Merger** — where each piece is independently useful.
- Designed to work **for both humans and AI agents**, future-proofed for the multi-agent development wave.

## What we learned

- Merge conflicts are a **prediction problem**, not just a resolution problem — and prediction is where most of the value (and the wow) lives.
- The hard part of "resolve with an LLM" isn't the merge, it's **verifying correctness**. The running engine grounds the risk prompt and the intent-test prompt with Tavily doc lookups, then runs the tests. Semantic merging itself is still the planned Merger.
- A shared, additive **API contract** is the cheapest way to let a team build in parallel — the very lesson our product teaches.

## What's next for MergeGuard

- **Planner agent:** proactively decompose incoming work into non-overlapping "zones" and recommend the optimal merge/rebase order.
- **Merger agent:** semantic 3-way resolution and test validation. Tavily already grounds the Sentinel and verify prompts; the Merger is not built and does not call Tavily.
- **Symbol / AST-level scoring** (tree-sitter): "both edited `login()`" should outrank "same file, far apart."
- **Delivery as a plug-in and an MCP server** (see below).

---

## Main idea: delivery as a plug-in

The winning distribution is a **VS Code extension + a GitHub App**:

- The extension shows each developer their live traffic light **right in the editor status bar**, and warns the moment they start editing a hot region.
- The GitHub App posts the risk score as a **PR check** and orders the review queue.
- The FastAPI service is the shared backend for both — the plug-in is a thin client.

Demo optics: a red dot lights up in VS Code the instant a teammate touches your function.

## MCP idea

Expose MergeGuard as an **MCP (Model Context Protocol) server** so any AI coding agent — Claude, Cursor, etc. — can call it as a **tool** before and while it edits:

- `check_conflict_risk(branch)` → returns the traffic light + rationale.
- `claim_zone(files)` → soft-locks a region so other agents route around it.

A fleet of agents working one repo can then **self-coordinate**: each checks MergeGuard, sees a red light, and picks a different file or waits. This directly delivers the tagline — *"AI agents to minimise merge conflicts"* — because the agents themselves become MergeGuard-aware. Nebius Token Factory runs Nemotron inside the engine, Tavily grounds that engine's prompts with library docs, and MCP is the coordination layer. The analyze payload includes `docs_sources` (an empty list when no lookup ran).

---

## How we meet the judging criteria

- **Nebius Token Factory** — conflict explanations and intent-test generation run NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) through the OpenAI-compatible Token Factory API (`https://api.tokenfactory.nebius.com/v1/`). Hosting the service itself on Nebius Cloud is not set up in this repo. _[confirm hosting]_
- **Tavily as a search API** — Sentinel and verify-by-test call Tavily when a conflicting pair imports a third-party library. Results show up as `docs_sources` on the analyze response. The bundled checkout demo does not trigger a search (stdlib only). A small repo that imported `requests` did: sources included requests.readthedocs.io.

## Demo script (the money shot)

1. Seed a repo with three branches editing the same function.
2. Open the dashboard — watch a light flip 🟢 → 🔴 in real time as the branches diverge.
3. MergeGuard names *why* they collide (Nemotron on Token Factory). This demo imports only the standard library, so Tavily stays idle. On a repo with a third-party import, the same pair carries `docs_sources` from a Tavily search.
4. Verify-by-test runs a generated intent test: it passes on each feature branch and fails on the merge. The pair is confirmed. The textual merge itself is clean.

---

## Team

- Christopher Wang ([@christopherwang0129SE](https://github.com/christopherwang0129SE))
- [@lamapony](https://github.com/lamapony)
- [@subbubhat99](https://github.com/subbubhat99)

**Repo:** https://github.com/christopherwang0129SE/mergeguard
