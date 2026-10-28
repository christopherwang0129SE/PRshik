# Three-minute PRshik demo

The default dashboard is the checkout story. Use `?advanced=1` for repository setup, the alternate API demo and per-pair model accounting. No API keys are required for the default story: git inspection and each branch's own tests still run. Nemotron intent-test generation and Tavily enrichment need their configured keys; never narrate those as active when the header or pipeline says they were skipped.

## Beat sheet (180 seconds)

| Time | Screen / action | Narration and evidence |
| --- | --- | --- |
| 0:00–0:15 | Initial dashboard | “Both PRs pass alone. Git merges them cleanly. Together they break checkout.” The headline states the problem; the checkout note names discount and tax. |
| 0:15–0:30 | Click **Try demo repo** | No URL, key or setup form. The bundled repo has two feature branches and a harmless docs branch. For a separately configured local run, `?advanced=1` offers repository input and PR selection; this is an alternative shot, not a prerequisite. |
| 0:30–0:55 | Live pipeline | Show actual streamed stages and pair updates. Explain diff inspection, pair triage and test execution. In the no-key run say “git triage and branch tests”; Nemotron and intent tests are visibly skipped. Do not add artificial progress or delays. If the run finishes quickly, open **Run details** to show the recorded stages. |
| 0:55–1:20 | Finished summary, select confirmed pair, **Both diffs** | `feat/discount-cap` assumes a pre-tax subtotal; `feat/tax-before-discount` supplies a tax-inclusive amount. The same file changes in distant regions, with zero overlapping regions. Show both actual diffs and the retained git heuristic. |
| 1:20–1:45 | **Branch tests** truth table and failure | A passes, B passes, A+B fails. The backend really checks out and merges the code and reruns the failing tests. Show the failing assertion (200 vs 198). This deterministic proof works without keys. If a keyed run has an intent test, **Verify by test** additionally shows that separate test's truth table and generated code; do not conflate the two layers. |
| 1:45–2:10 | **Suggested next step** | Agree the discount/tax contract, preserve the pre-tax cap if retaining the discount branch's intent, update the competing contract and rerun both suites. This is fixed, clearly labeled demo guidance for human review. Planner/resolver work is on separate branches and is not integrated here; no generated patch or successful repair is claimed. |
| 2:10–2:40 | **Beyond the demo**, real-repo evidence link | The checked-in Hall of Fame report pins daimon, KISS, Elastic and qwen-code cases to SHAs, replay commands and measured runs. Show the source report when presenting credibility, with its dates and limitations. These are existing documented results, not a new benchmark measurement by this UI change. |
| 2:40–3:00 | Close on evidence / dashboard | “Check what the branches assume together before merging.” Optionally open a saved analysis to demonstrate instant replay if a live run is slow. Saved verdicts are dated, and diffs use current repository heads. |

## Screen and control inventory

Every existing interactive surface is assigned below, including supporting states. “Advanced” means absent from the default DOM; code and functionality remain available at `?advanced=1`.

| Surface / controls | Beat | Default decision and purpose |
| --- | --- | --- |
| Home wordmark; skip-to-content link | Opening / close | Keep navigation and keyboard access. |
| Sentinel status, scoring mode, Tavily readiness | Live / credibility | Keep truthful backend capability disclosure, especially with no keys. |
| Problem heading, explanation, checkout note | Opening | Keep: explains the problem and selected example. |
| Try demo repo | Launch | Keep as the primary action; disabled while running. |
| Repository / base fields, Analyze | Alternate launch | Advanced only; unavailable when health reports demo mode. Server restrictions remain authoritative. |
| API demo button and note | Alternate launch / credibility | Advanced only: a second example and Tavily explanation distract from discount vs tax. Without keys this still runs branch tests, with no Tavily claim. |
| Repository browser disclosure, branch list, Analyze bundled repo, Retry repositories | Alternate launch | Advanced only. Bundled catalog remains available under DEMO_MODE. Loading, empty and error states retained. |
| GitHub repo / base fields, Load pull requests, PR links, Analyze PR | Alternate launch | Advanced and explicitly non-demo health only. Hidden while health is unknown or demo mode is on. A 403 from a later lock removes the queue and points to bundled repos, with no retry loop. |
| Analysis history disclosure, Open saved analysis, Clear history | Replay fallback | Collapsed and shown only after a completed run exists (or advanced view). Saved locally, maximum 12. Empty-storage explanation retained in advanced view. Clear returns the default view to a clean slate. |
| Saved-result timestamp / current-diffs notice | Replay fallback | Keep: prevents replay from being mistaken for live verification. No pipeline timings invented for restored runs. |
| Pipeline stages, elapsed clock, Cancel, completed Run details disclosure | Live | Keep real progress, cancellation and recorded timings. Cancel explains that backend work may finish. |
| Summary, branch count, model/calls/tokens/cost/time | Verdict / credibility | Keep measured run-level accounting and proof summary. No benchmark aggregate fabricated. |
| Pair rows and deep links | Pair evidence | Keep selection and shareable target/pair hash. Shared URLs rerun analysis. Mobile selection scrolls to evidence. |
| Risk gauge, rationale, static checks and symbol evidence | Pair evidence | Keep source attribution and the gap between textual and semantic risk. |
| Both diffs, focusable code scroll regions, one-sided file disclosures, retry diffs | Pair evidence | Keep actual code, including loading/empty/failure states. |
| Verify by test, generated test disclosure, All runs, output | Proof | Keep if supplied by backend. Keyless runs skip intent generation honestly. |
| Branch tests truth table, assertions, All runs | Proof | Keep deterministic proof as the keyless story's decisive moment. |
| Tavily documentation source links | Proof / credibility | Keep only when real sources are returned; absent in keyless checkout. |
| Per-pair model usage breakdown | None beyond run-level accounting | Advanced only. Run summary already supplies the story's cost figures. |
| Suggested next step | Suggestion | Keep only for the confirmed checkout pair, identified by both branch names. Human guidance, not an integrated planner. |
| Beyond the demo / report link / close | Credibility / close | Keep after completion; link opens the existing report in a new tab. |
| More tools / Demo view links | Supporting navigation | Footer only. Switches presentation mode without adding a main-path decision. |
| Offline setup command, error panel / Try again, cancellation notice, no-pairs guidance, live announcements | Recovery for launch/live/proof | Keep actionable fallback states and accessible focus/status updates. The default demo button always offers a fresh run, including after saved replay. |

## Local capture and verification

Generate the two bundled repos with `python3 demo/make_demo_repo.py --verify` and `python3 demo/make_api_demo_repo.py --verify`. Start the backend with `DEMO_MODE=true`, empty `NEBIUS_API_KEY` / `TAVILY_API_KEY`, and the actual frontend origin in `CORS_ALLOW_ORIGINS`. Start Vite with `VITE_API_BASE_URL` pointing at that backend. Use Node 22 for the existing frontend tooling.

The job evidence lives outside git at `/workspace/codex-1026/mgdash/`: `storyline.cjs`, `browser-checks.json`, `browser.log`, `screenshots/` and `video/`. Each story beat has real 390px and 1280px captures. The browser uses the local backend and real bundled repos, without route mocks or model keys. See the job `SUMMARY.md` for final checks, reviewed screenshots and video filename.

Visual direction is retained from the existing dashboard: graphite surfaces, blue primary action, self-hosted Schibsted Grotesk and Azeret Mono for code. ENERGY 1 / RHYTHM 1 / MOTION 1. The primary blue button launches the only default example; the existing grid aligns evidence rather than adding decoration. Disclosures reserve detail for readers who need it, and status colors distinguish measured outcomes.
