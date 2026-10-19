<!-- NAME NOT LOCKED: repo=mergeguard, deck says "Mergesolver"/"Big Boi AI".
     Pick one and find-replace before submitting. Using "MergeGuard" throughout. -->

# MergeGuard — Hackathon Submission

**Project name: MergeGuard (final name pending).**

**One-liner:** MergeGuard scores every pair of in-flight git branches for conflict risk, asks NVIDIA Nemotron on Nebius Token Factory to explain the pairs that share code, and runs tests on the merged tree to prove a clash that git would merge cleanly.

**Built for:** Nebius x NVIDIA Global AI Hackathon (Devpost)
**Deadline:** Fri 30 Oct 2026, 18:00 Copenhagen time
**Track:** Developer tooling / Coding Agents

Tavily is a sponsor-tool integration (library-doc lookup inside Sentinel and verify-by-test). It is not the name of the hackathon. The model is NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) on Nebius Token Factory.

> Draft copy for this branch. The only open placeholder is _[confirm hosting]_.

---

## Inspiration

Modern teams don't build in a straight line — they build in parallel. And it's not just humans anymore: we're entering an era where a single repo can have a whole **fleet of AI coding agents** committing at once. We kept circling one question:

> *What happens when two commits touch the same code at the same time?*

Today you find out at the worst possible moment — **after** everyone has already finished, when Git throws a wall of conflict markers. Merge conflicts get treated as an accident to clean up. We realised they're actually **predictable** — and if they're predictable, they're preventable. MergeGuard was born from wanting a guard standing at the merge point who sees the collision forming and stops it before it happens.

## What it does

You point MergeGuard at a local git repo (or, outside demo mode, a git URL). It diffs every branch except the base against the merge-base with `git diff -U0`, parses hunks, and scores every pair. The same file adds a small score. Hunks that overlap, or sit within a 3-line adjacency window, add the large one. One shared file and no overlapping hunks scores 10, level low.

`POST /api/analyze` is one request and one JSON response. The dashboard does not poll branch state and does not stream tokens. While the request is in flight, the page shows elapsed seconds and estimates which stage is running from that clock (under 3 seconds: diff, under 20: Nemotron, then tests). The page says the stage is estimated.

When the response arrives, the verdict names what was found. Each branch is listed with the worst level of any pair it is in (None, Low, Medium, High). High and Medium are colored. Pairs that tests confirmed, or that are medium or high, open as cards. The rest collapse to one row, worst score first.

On this branch the product predicts and proves. It does not edit the repo. There is no Planner agent and no resolver or Merger agent. A resolver agent is in open pull request #4 ("Add resolver agent with isolated merge proposals and validation") and is not merged.

## How we built it

- **Backend — FastAPI.** Sentinel shells out to git for the merge-base and `git diff -U0`, then scores region overlap with the 3-line adjacency window. A static prefilter (Python `ast`, plus a TypeScript/JavaScript scanner in `ts_symbols.py`) drops pairs that share no file and no symbol. Up to `NEBIUS_MAX_PAIRS` (default 5) candidates go to the model. `backend/tests/test_sentinel.py` builds a throwaway repo, asserts the overlapping pair is medium or high, and asserts that pair is ranked first.
- **Reasoning layer — Nebius Token Factory** (OpenAI-compatible API at `https://api.tokenfactory.nebius.com/v1/`, model `nvidia/nemotron-3-super-120b-a12b`, NVIDIA Nemotron 3 Super). It explains why a pair is risky and, for a high-risk pair, writes the pytest module for verify-by-test. Each chat-completions call is one attempt (`max_retries=0`). Cost on the response is estimated from token usage. Identical inputs hit a disk cache (`WORKSPACE_DIR/nemotron-cache/` for risk, `WORKSPACE_DIR/verify-cache/` for generated tests). Token Factory does not produce a semantic merge on this branch. The Planner is not in this branch. The resolver is only in the unmerged pull request above.
- **Library docs — Tavily.** On a Nemotron cache miss, and again when verify-by-test builds a test prompt, `docs_lookup` reads the pair's changed Python and JavaScript/TypeScript. It keeps third-party imports and drops the standard library, Node built-ins, relative imports, and modules that belong to the repo. It sends at most two searches (`POST https://api.tavily.com/search`, `TAVILY_TIMEOUT_SECONDS` default 8, `TAVILY_MAX_RESULTS` default 3). Snippets are trimmed (700 characters each, 2000 in total) and appended under "Library documentation (via Tavily web search)". The API returns `docs_sources` (`title`, `url`, `query`) on the pair and on the verification result. No key, or `TAVILY_ENABLED=false`, skips the network: prompts unchanged, errors logged and dropped. For `requests`, `fastapi`, `pydantic`, and `react`, the search sets `include_domains` to the official docs host. The checkout demo imports only the standard library, so Tavily stays idle there. The bundled API demo (`demo/api-demo`, built by `python3 demo/make_api_demo_repo.py`) is what triggers it.
- **Tests on the merge.** For each prefilter candidate under the allowed roots, Sentinel runs the test files each branch added or modified: on that branch, and on a clean merge of the two. No model call. A test that passes on its own branch and fails on the merge (and does not already fail on the merge-base, twice) sets `branch_tests.status` to `confirmed`. Separately, verify-by-test asks Nemotron for one pytest module when the pair is high risk (model level high, or published or model score at least `VERIFY_MIN_SCORE`, default 70, or a static signature break). That module runs in throwaway worktrees. `confirmed` means each side's tests pass on their own branch, and a test that fails on the merge-base also fails on the merge. Either confirmation floors the shown score at 90 and sets the level to high. `git_score` and `model_score` stay as they were.
- **Frontend — dashboard.** A repository field, base branch (default `main`), and Analyze. Two buttons when their Vite paths are set: **Try demo repo** and **Try API demo (Tavily)**. After the response: a verdict, branch levels, and pair cards (why, overlap, branch tests, intent tests, library docs, scores). Header status comes from one `GET /api/health` on load.
- **MCP.** `backend/mergeguard_mcp` is a stdio server with `check_merge_risk`, `list_conflicting_branches`, and `suggest_merge_order`. See below.

## How Nebius Token Factory and Tavily are used

Token Factory is where NVIDIA Nemotron 3 Super runs. It writes the pair risk explanation and the intent test for verify-by-test. Each call is a single chat-completions attempt. The API reports token usage and an estimated cost. Repeat runs of the same SHAs come from disk.

Tavily is the library-doc lookup for both of those prompts. Up to two searches, snippets trimmed into a "Library documentation (via Tavily web search)" section, and `docs_sources` (`title`, `url`, `query`) on the pair and on the verification result. The pair card shows that list under the heading "Library docs" with the sublabel "found by Tavily" (http(s) links, at most 6). The verdict's Nemotron line adds "grounded with N library docs via Tavily" when any were returned. Empty `TAVILY_API_KEY` or `TAVILY_ENABLED=false` skips the network. An empty `NEBIUS_API_KEY` or `NEBIUS_ENABLED=false` also skips Tavily, because those prompts are not built. The checkout demo never triggers a search. The bundled API demo does, when a key is set: the conflicting lines use `requests` (`Session`, `session.mount`, `session.get`) and pydantic (`field_validator`).

The Planner is not in this branch. The resolver agent is not in this branch. `suggest_merge_order` only sorts branches from the pairwise results. It does not decompose work and it does not merge.

## Challenges we ran into

- **"Same file" ≠ "conflict."** Two people editing opposite ends of a 2,000-line file don't conflict; two editing adjacent lines do. Matching *real* Git behaviour meant parsing hunk ranges and adding an adjacency window, not just intersecting file lists.
- **The concurrency question.** Reasoning about "two commits at the same time" pushed us to model risk over diffs against a shared **merge-base**, rather than raw commit order.
- **Environment friction.** Python 3.9 wouldn't evaluate modern type syntax at runtime; we resolved it with a compatibility shim instead of losing a day to a version fight — ironically, avoiding our own kind of conflict.
- **Building in parallel without conflicting on ourselves.** We froze a shared, additive **API schema** as the contract so frontend, integration, and engine work could proceed independently — eating our own dog food.

## Accomplishments that we're proud of

- A working Sentinel: point it at a git repo (demo mode accepts only the two bundled demos) and it returns ranked pair scores, a Nemotron rationale when a key is set, and test evidence when a branch's own tests or an intent test fail on the merge.
- The checkout demo and the API demo are semantic conflicts. Git reports one shared file and no overlapping hunks (score 10, low). The branches' own tests still fail on the merged tree, and the dashboard marks the pair proven.
- An MCP server so another coding agent can call the same engine on a local repo before it edits.
- Tavily grounds the risk prompt and the intent-test prompt from the imports on the conflicting lines. The API demo is the bundled case that exercises that path.

## What we learned

- A low git score is not a clean merge. The demos share a file in regions farther apart than 3 lines, so the heuristic stays at 10, and the tests are what prove the clash.
- The hard part of resolving with a model is checking the result. This branch grounds the risk prompt and the intent-test prompt with Tavily, then runs the tests. It does not apply a merged file. That work is the resolver in pull request #4, which is not merged here.
- A shared request and response schema let the dashboard and the engine move separately. `AnalyzeRequest.verify` defaults to true. Generated tests still run only for a local path under the allowed roots (the `demo/` folder, plus `VERIFY_ALLOWED_ROOTS`). A `repo_url` clone is scored and is not executed.

## What's next for MergeGuard

- **Planner agent:** not in this branch. `suggest_merge_order` is a deterministic sort of branches that already exist (no risky pair first, unconfirmed risky pairs next, test-confirmed conflicts last, one at a time). It does not split incoming work into zones.
- **Resolver agent:** not in this branch. Open pull request #4 adds one. It is not merged, so this branch does not call Tavily from a resolver and does not write a resolved file.
- **tree-sitter:** not in this branch. Python symbol overlap already uses `ast`. TypeScript and JavaScript use the scanner in `ts_symbols.py`.
- Hosting is not decided. _[confirm hosting]_

---

## Distribution

A VS Code extension and a GitHub App are not in this repository. The UI that exists is the dashboard.

`GET /api/github/pull-requests` lists open pull requests for the users in `GITHUB_SEATED_USERS` and analyzes those branches when `GITHUB_REPOSITORY` is set. The dashboard does not call that route. With those variables unset, the route returns 503.

## MCP

`python -m mergeguard_mcp` from `backend/` starts a stdio MCP server. Tools run Sentinel in-process. `repo_path` must be an absolute local git repo under the allowed roots (bundled `demo/`, plus `VERIFY_ALLOWED_ROOTS`). URLs are refused. One analysis at a time. Configured API keys are scrubbed from every string. Generated test source is omitted. Confirming test ids and short failure excerpts are included.

- `check_merge_risk(repo_path, branch, base="main", verify=True)` returns pairs for that branch, most dangerous first, each with level, score, verdict, rationale, symbol evidence, and `docs_sources` (an empty list when no lookup ran).
- `list_conflicting_branches(repo_path, base="main")` returns the risky pairs of the repo.
- `suggest_merge_order(repo_path, base="main")` returns the sort described above, with a reason on each step. It does not check out or merge anything.

`verify=False` skips test generation. There is no `claim_zone` tool.

---

## How we meet the judging criteria

- **Nebius Token Factory** — conflict explanations and intent-test generation run NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) through the OpenAI-compatible Token Factory API (`https://api.tokenfactory.nebius.com/v1/`). Hosting the service itself is not decided. _[confirm hosting]_ `Dockerfile`, `railway.json`, and `frontend/vercel.json` are in the repo. `docs/DEPLOY.md` describes a Railway API image (both demo repos baked in, `DEMO_MODE=true`) and a Vercel dashboard. This repo does not record a live URL.
- **Tavily as a search API** — Sentinel and verify-by-test call Tavily when a conflicting pair imports a third-party library. Results are `docs_sources` on the analyze response, and the pair card shows them as "Library docs" / "found by Tavily". The bundled checkout demo does not trigger a search (standard library only). The bundled API demo does: `demo/api-demo`, built by `python3 demo/make_api_demo_repo.py`, dashboard button **Try API demo (Tavily)**. The conflicting lines name `session.mount`, `session.get`, and `field_validator`, so the lookup queries `requests` and `pydantic` and restricts those two to `requests.readthedocs.io` and `docs.pydantic.dev`. An empty key or `TAVILY_ENABLED=false` does not call the network.

## Demo script

From the repository root, create both git repos. They are gitignored. The image in `Dockerfile` builds the same two repos at `/app/demo/checkout-demo` and `/app/demo/api-demo`.

```bash
python3 demo/make_demo_repo.py
python3 demo/make_api_demo_repo.py
```

Start the API from `backend/` (`uvicorn app.main:app --port 8000`) and the dashboard from `frontend/` (`npm run dev`, http://localhost:3000). The dashboard calls `http://localhost:8000` unless `VITE_API_BASE_URL` is set. On load it requests `GET /api/health` once. With both keys set the header reads "Sentinel online", "git+Nemotron", and "Tavily on".

Each demo button writes its path into the repository field and sends one `POST /api/analyze` (base `main`, `verify` left at the API default `true`). Nothing on the page updates because another branch moved. The "Analyzing" block shows the path, elapsed seconds, and the labels "Diff branches", "Explain risky pairs", and "Test the merge". Its note says the stage is estimated from elapsed time, and that a run takes 20 to 60s with live model calls, or a few seconds when cached.

If a demo folder is missing, the API returns 400 and the error panel prints `python3 demo/make_demo_repo.py` and `python3 demo/make_api_demo_repo.py`.

### Checkout demo

Click **Try demo repo**. The note under the button, before a run starts, says: "Checkout service. Two branches change how discount and tax combine; git merges them cleanly."

`demo/checkout-demo` (`python3 demo/make_demo_repo.py`) has `main` plus `feat/discount-cap`, `feat/tax-before-discount`, and `docs/readme`. The discount branch caps the discount on the pre-tax subtotal at the top of `checkout.py`. The tax branch applies tax before the discount in `total()`, at the bottom of the same file. The edits are farther apart than 3 lines. Git's score for that pair is 10, level low: one shared file, no overlapping regions. `docs/readme` only edits `README.md`, so its pairs share no files and score 0.

`checkout.py` and the tests import only `unittest`. Tavily does not search. The pair card has no "Library docs" section.

The feature branches each add a test file. Those tests pass on their own branch and fail after the two branches are merged, and the merge itself is textually clean. Branch tests record that with no model call. The verdict heading is "1 hidden conflict proven by tests". The detail names `feat/discount-cap` and `feat/tax-before-discount` and says they merge without a git conflict, but tests fail on the merged code. The Branches row lists each branch with its worst level. The two feature branches read High. The `docs/readme` pairs sit under "Low-risk pairs", one collapsed row each.

The open card is titled "The pair that needs attention":

- Status **Proven conflict**. The shown score is at least 90/100, level High. The note reads "Raised from {blend}: confirmed by branch test". When the intent test also confirms, the note reads "Raised from {blend}: confirmed by branch test and intent test". Git and Nemotron keep their own numbers on the Scores row.
- **Why**, sublabel "Nemotron" when the model ran: the rationale for the clash. The discount cap assumes `apply_discount` receives the pre-tax subtotal. The other branch's `total()` taxes first, so the cap sees a tax-inclusive amount. With no `NEBIUS_API_KEY` the sublabel is "git heuristic", the git rationale is the shared-file sentence, and verify-by-test does not run. Branch tests still run.
- **Overlap**: `checkout.py`, "edited in different places", with each branch's line ranges. Symbol lines are listed under that when the prefilter recorded them (who changed a function, who calls it, which file).
- **Branch tests**, sublabel "no LLM": status "Confirmed by branch test", table "Branch test results per checkout" (branch A passed, branch B passed, merged failed), then each failing test id, which branch owns it, and a short excerpt.
- **Intent tests**, sublabel "written by Nemotron": present when the pair is high risk after Nemotron. Nemotron writes one pytest module (`test_branch_a_*` and `test_branch_b_*`). The engine runs it on branch A, branch B, the merge-base, and the merge of A+B. A rejected module, a failure on its own branch, or a run that does not confirm the clash causes another generation, up to `VERIFY_MAX_ATTEMPTS` (the Settings default is 4; `.env.example` sets 3). Status "Confirmed by intent test" when each side passes on its own branch and a test that fails on the merge-base also fails on the merge. The card then shows "Intent test results per checkout", the names under "Fails on merge", and the module behind the "Generated test" disclosure. The model score is not the same on every run, so this block is not guaranteed to read "confirmed". The branch-test block above does not depend on it.
- **Scores**: Git 10, Nemotron's score or "n/a" when the model did not run, "Score from Nemotron" or "Git fallback" plus the reason, "1, no overlapping edits", and token counts when a call was made.

### API demo (this button triggers Tavily)

Click **Try API demo (Tavily)**. The note says: "Uses requests and pydantic. Two branches disagree on cents versus dollars; Tavily looks up the library docs."

`demo/api-demo` (`python3 demo/make_api_demo_repo.py`) has the same shape. `feat/cents-payload` treats the quote payload as integer cents: `normalize_amount` and the pydantic `field_validator` divide by 100, and the session mounts both schemes and passes `timeout` to `session.get`. `feat/fee-on-cents` treats `invoice_total`'s input as raw cents and divides by 100 after the fee. The two edits sit at opposite ends of `client.py`. Git merges them with no textual conflict and scores the pair 10, low. On the merged file the cents conversion runs twice. The branches' own tests fail on that merge (`test_invoice_uses_dollars_not_cents` on the cents branch, `test_normalize_still_passes_cents_through` on the fee branch). The verdict and the pair card follow the checkout demo, for `feat/cents-payload` and `feat/fee-on-cents`. `docs/readme` is again the harmless third branch.

Tavily runs on this demo when `TAVILY_API_KEY` is set and `TAVILY_ENABLED` is not false, and when Nemotron is actually building a prompt (a cache miss, or verify-by-test writing a test). The changed lines name `session.mount`, `session.get`, and `field_validator`, so the lookup sends at most two searches, for `requests` and `pydantic`, with `include_domains` set to `requests.readthedocs.io` and `docs.pydantic.dev`. The pair card adds **Library docs**, sublabel "found by Tavily": each query, then the title and host of each http(s) link. The card unions `docs_sources` on the pair with `verification.docs_sources`, one link per URL, and keeps at most 6. The verdict's Nemotron line includes "grounded with N library docs via Tavily". An empty key or `TAVILY_ENABLED=false` leaves the section out and does not call Tavily. The checkout demo never adds that section.

A second click with the same SHAs uses the risk-score disk cache: that prompt makes no Nemotron call and no new Tavily search, and the stored `docs_sources` are restored. Verify-by-test still runs its own lookup while it prepares the test prompt. A generated test already on disk is not sent to the model again. Tavily results are also cached in the process, per query, so a repeat in the same process does not send that query again. The progress note says a cached run takes a few seconds.

---

## Team

- Christopher Wang ([@christopherwang0129SE](https://github.com/christopherwang0129SE))
- [@lamapony](https://github.com/lamapony)
- [@subbubhat99](https://github.com/subbubhat99)

**Repo:** https://github.com/christopherwang0129SE/mergeguard
