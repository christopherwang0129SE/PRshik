# MergeGuard: Devpost draft

**Tagline:** Catch branches that merge cleanly but break together.

Built for the **Nebius x NVIDIA Global AI Hackathon**. Project name pending final
team confirmation.

## Problem

Parallel developers and coding agents can make individually correct changes
that contradict each other. Git checks whether text can merge; separate branch
CI checks each change alone. Neither establishes that the combined behavior is
correct. Teams need evidence before integrating those changes.

## What it does

MergeGuard compares in-flight branches and identifies risky pairs. It explains
potential semantic conflicts, then checks the combined checkout using the
branches' own tests and model-generated intent tests. The dashboard shows the
pair, risk level, pass/fail results per checkout, and the failing assertion.
A stdio MCP server exposes the same engine to coding agents and offers a
deterministic merge-order suggestion.

This branch predicts and proves conflicts. It does not apply fixes or merge
branches. A separate resolver implementation is under review in PR #4.
Tests execute only for allowed local repositories; analysis of remote URL clones
does not execute repository tests. Dashboard progress stages are time estimates,
not streamed engine events.

## How we built it

- **Sentinel:** Python git subprocess helpers compare diffs, symbols and call
  sites before spending tokens. Static checks identify incompatible signatures.
- **NVIDIA Nemotron 3 Super on Nebius Token Factory:** the OpenAI-compatible
  client in `backend/app/services/nemotron.py` supplies risk assessments and
  generates pytest intent tests through `verifier.py`. The configured model is
  `nvidia/nemotron-3-super-120b-a12b`.
- **Tavily:** `backend/app/services/docs_lookup.py` searches documentation for
  third-party libraries and symbols used by changed code. Bounded snippets ground
  risk and verification prompts; source URLs reach the dashboard and MCP tools.
  Missing keys and search failures leave analysis available.
- **Evidence:** `branch_tests.py` runs changed branch tests on their own branches
  and the merge without an LLM. `verifier.py` runs generated tests in throwaway
  worktrees and uses failures as repair feedback. A confirmed regression raises
  the displayed score to at least 90, high. Model risk alone is not proof.
- **Product:** FastAPI serves the React/TypeScript dashboard. The stdio MCP server
  calls the analysis engine directly. Tests run with restricted environments and
  timeouts; generated-code checks and network restrictions reduce execution risk.

## Reproducible demo scenario

From the repo root, with Python 3.11+, Node.js 22, Git 2.38+ and Make:

```bash
make setup
make demo
```

`make demo` regenerates `demo/checkout-demo` and invokes the same analysis function
as `POST /api/analyze`, in-process with no server. Two branches demonstrate the
problem:

- `feat/discount-cap` caps a discount on the pre-tax subtotal.
- `feat/tax-before-discount` moves tax ahead of the discount.

Git merges them cleanly. Each branch's tests pass on its own, but the merged
checkout returns **200 instead of 198** for `test_total_with_cap`. Without keys,
deterministic branch tests flag the pair at **90/100, high** and print the failing
tests. With an enabled `NEBIUS_API_KEY`, Nemotron assesses risk and eligible pairs
get generated intent tests. The report states which layer supplied proof and
reports a branch-test fallback if the generated test does not confirm. The command
exits 0 only when the pair is both flagged and proven.

`NEBIUS_API_KEY= TAVILY_API_KEY= make demo` explicitly exercises the keyless path.
Use `make dev` to start the dashboard and API, then click **Try demo repo**.
Expand the test details to inspect the evidence. Ctrl-C stops both services.

The checkout fixture uses only the Python standard library. To see Tavily,
configure both provider keys in `backend/.env` and click **Try API demo (Tavily)**.
That fixture changes a `requests` client and a pydantic model: one branch converts
cents to dollars, while the other assumes raw cents. Documentation links appear
when model prompts are built and Tavily returns relevant sources.

## Challenges

A plausible model explanation is not enough. Generated tests can fail on their
own branch, encode only base behavior, or inspect implementation details instead
of demonstrating a regression. We added per-checkout execution, behavioral
confirmation rules, static signature checks, and repair feedback. The deterministic
branch-test layer also catches regressions without depending on model output.

Cost and latency require a prefilter, pair limits, bounded prompts, and caches.
Library documentation must be relevant to the changed symbols; Tavily results
are filtered and trimmed rather than treated as authoritative instructions.
The README preserves measured reliability runs and known limitations.

## What's next

Integrate and review the resolver work, improve coverage for more languages and
build systems, and validate the workflow on more real branch pairs. Extend the
planned coordination agent beyond the current deterministic merge-order tool.
Keep human review and concrete test evidence central to proposed resolutions.

## Still to do before submitting

- [ ] Prepare the required video separately.
- [ ] Confirm final project name, team names and Devpost profiles.
- [ ] Confirm a hosted URL if offering one, and verify demo-mode restrictions.
- [ ] Review the final integrated branch and repeat the demo and checks.

## Team

- Christopher Wang ([@christopherwang0129SE](https://github.com/christopherwang0129SE))
- [@lamapony](https://github.com/lamapony)
- [@subbubhat99](https://github.com/subbubhat99)

Repository: https://github.com/christopherwang0129SE/mergeguard
