# PRshik: Devpost submission

Copy each section into the matching Devpost field. "About the project" takes
Markdown, so everything under that heading can be pasted as one block.

## Project name

PRshik

## Elevator pitch (200 characters max)

Two PRs pass CI and merge cleanly, then break main together. PRshik flags the risky pair and runs tests on the merged code to prove it.

## About the project

### Inspiration

Teams now run several developers and coding agents (automated AI tools that write or modify code) on one repo at once. Each
branch can be correct on its own and still contradict another branch. Git only
checks whether the text merges, and CI tests each branch alone. Nothing checks
whether the merged code still works until it is already on `main`.

### What it does

PRshik compares every pair of in-flight branches and proves which pairs break
each other. Three agents share one engine:

- **Sentinel (predict):** scores each branch pair from git diffs and a
  symbol and call-site prefilter. NVIDIA Nemotron, a large language model (LLM), explains the riskiest pairs.
  PRshik then proves regressions by running each branch's own tests on the
  merged checkout, plus intent tests that Nemotron generates.
- **Planner (prevent):** groups branches into independent zones with no
  medium- or high-risk pair between them, and orders merges riskiest-first.
- **Resolver (resolve):** reproduces a Git conflict in a throwaway worktree,
  asks Nemotron for a resolution, and returns a patch with validation results
  for a human to review.

The dashboard shows each risky pair, both diffs, a pass/fail table for branch A,
branch B and A+B, and the failing assertion. An MCP server gives coding agents
in code editors and AI-powered coding assistants such as Cursor (an AI-driven IDE), Claude Code (an AI code assistant), and similar AI-tools the same checks, so an agent can ask
"is it safe to merge this branch?" before merging.

**Watch the demo:** the [demo video](https://www.youtube.com/watch?v=NsdlcErTttc)
walks through the bundled demo repo, which has two checkout branches. One caps a discount on the pre-tax subtotal, and the other moves tax
ahead of the discount. Git merges them cleanly and each branch's tests pass, but
the merged checkout returns **200 instead of 198**. PRshik flags the pair at
**90/100, high** and shows the failing test.

### How we built it

- **NVIDIA Nemotron 3 Super on Nebius Token Factory**
  (`nvidia/nemotron-3-super-120b-a12b`), a large language model (LLM) accessed via the OpenAI-compatible
  API. Nebius Token Factory is a cloud platform that provides access to advanced AI models like Nemotron. We chose it for its reliable, scalable infrastructure and seamless integration with our workflow. It assesses risk, writes pytest intent tests, and proposes conflict
  resolutions.
- **Tavily** looks up current documentation for the third-party libraries the
  changed code uses. Short snippets ground the prompts, and the source links
  appear in the dashboard and MCP results.
- **Deterministic proof first:** a test that one branch added passes on that
  branch, fails on the merge twice, and does not already fail on the
  merge-base. This layer needs no LLM and costs nothing. A model risk score on
  its own never counts as proof.
- **Python and FastAPI** run git in subprocesses and run tests in throwaway
  worktrees with restricted environments and timeouts. A **React and
  TypeScript** dashboard sits on top. A stdio **MCP server** (official Python
  SDK) calls the engine directly.
- The public demo is one **Render** service. Without a Nebius key it runs
  git-only: git scoring, branch tests and the checkout proof still work.

### Challenges we ran into

A convincing explanation from the model does not guarantee that its assessment is correct. Generated tests sometimes
failed on their own branch, pinned only the old behaviour, or inspected source
code instead of behaviour. In one run, forcing verification on a harmless
fixture produced two false confirmations from tests that checked a function's
variable names. We added rules so a generated test only confirms when it
passes on its own branch, fails on the merge-base, and fails on the merge for a
behavioural reason. We also built the deterministic branch-test layer so the
core proof does not depend on the model at all.

Cost and latency needed a prefilter, limits on the number of branch pairs analyzed ("pair limits"), restrictions on the length and complexity of model prompts ("bounded prompts"), and effective caching strategies.
Tavily results are filtered and trimmed, and never treated as instructions.

### Accomplishments that we're proud of

- **Four real semantic conflicts** from public repos:
  - [daimon](https://github.com/pymc-labs/daimon): an open-source data science agent for Discord and Slack,
  - [KISS](https://github.com/ThinkersJournal/KISS): the Kernel Interface Standards Suite (the conflict was in its Python tools),
  - [Elastic observability migration platform](https://github.com/elastic/observability-migration-platform): tooling for migrating observability assets,
  - [qwen-code](https://github.com/QwenLM/qwen-code): an open-source AI coding agent for the terminal, written in TypeScript.

  In each case, two pull requests passed CI (continuous integration, the automated tests that run on every pull request) and merged with no textual conflict, yet broke `main` together. PRshik confirmed every case in 3 of 3 fresh runs, and each one replays from pinned commits with one command.
- A **660-case replay benchmark** across 32 Python and TypeScript repos, under a $5 total model spend, with every number published (including misses) in the [benchmark results](https://github.com/christopherwang0129SE/PRshik/blob/main/docs/bench/RESULTS.md).
- The core proof works with **no API keys**, so anyone can check it.

### What we learned

To measure PRshik at scale, we needed many examples of change pairs that broke
each other, and nobody keeps a list of those. So we mined them from project
history: if a later fix touched the code of two earlier changes, we counted
that pair as broken. This gave us 330 "broken" and 330 clean pairs across 32
repos.

The shortcut did not hold up. When we checked 49 of the "broken" pairs by hand,
only 3 were real interactions; 35 were unrelated and 11 were unclear. A fix that
touches two files is usually routine maintenance, not proof that two changes
clashed. So the headline scores from the mined labels looked meaningful but
mostly measured noise.

We learned two things from this:

- **Real semantic conflicts are rare and hard to find.** Only 3 of 349
  hand-labelled pairs were real conflicts. That is why we hunted down and replayed real cases one
  by one for our Hall of Fame, instead of trusting automatic labels.
- **Check your ground truth before trusting your metrics.** We now publish the
  mined scores and the hand-checked scores side by side, so readers can see how
  far apart they are.

### What's next

- Detect semantic or behavioral conflicts that the benchmark missed and improve recall on real code interactions between branches.
- Support more programming languages and build systems beyond Python and TypeScript.
- Run PRshik as a check on open pull requests from the GitHub review queue, available as a GitHub Action and/or GitHub App integration.
- Ensure that every proposed resolution is reviewed by a human and supported by concrete test evidence.

## Built with

python, fastapi, react, typescript, git, pytest, nvidia-nemotron,
nebius-token-factory, tavily, mcp, render

## Try it out links

- Demo video: https://www.youtube.com/watch?v=NsdlcErTttc
- Repository: https://github.com/christopherwang0129SE/PRshik

## Video demo link

https://www.youtube.com/watch?v=NsdlcErTttc

## Team

- Christopher Wang ([@christopherwang0129SE](https://github.com/christopherwang0129SE))
- [@lamapony](https://github.com/lamapony)
- [@subbubhat99](https://github.com/subbubhat99)

## Describe your contribution (Christopher Wang)

Led project initiation and development: built the Sentinel merge-conflict predictor, GitHub integration with review queue (using the GitHub REST API and webhooks), and Planner agent for safe merge ordering; reviewed and merged teammates' contributions, implemented the Resolver agent and benchmark, led the PRshik rebranding, and authored core documentation and submission materials.
I built the GitHub integration, which syncs pull requests and powers a review queue showing which
PRs need a reviewer, are waiting on review, or are approved. I also built the
Planner agent, which uses a graph-based algorithm to group branches into independent "safe zones" (connected components with no medium- or high-risk pair between them) and applies a risk-prioritized topological sort to suggest a merge order. As the repo owner, I reviewed and merged my teammates' work, including
the Resolver agent and the real-repo benchmark. I also led the rename to PRshik,
motivated by the need for a unique and memorable project identity that would not conflict with existing tools or trademarks; this involved researching available names, updating documentation, and coordinating changes across the codebase and submission materials. I also wrote the README and the Devpost submission. Working on a tool that detects
branch conflicts, while three of us were merging branches in parallel, made the
problem very real to me.
Experiencing parallel merges firsthand underscored the importance of automated conflict detection.
fact or an opinion only the team can give; replace or delete them before
pasting.

### Which model(s) did you use, and why did you choose that size/variant?

We used one model: **NVIDIA Nemotron 3 Super**
(`nvidia/nemotron-3-super-120b-a12b`), served through Nebius Token Factory's
OpenAI-compatible API. We did not use or compare any baseline or smaller models for this project.
It has 120B total parameters, of which about 12B are
active per token (mixture-of-experts). It does three jobs in PRshik: it explains
why two branches are risky together, it writes pytest "intent tests" that we run
on each branch and on the merge, and it proposes resolutions for Git conflicts.
We chose Super because these jobs need real code reasoning: the model reads two
diffs, works out how a change in one branch affects a caller in the other, and
writes a test that actually runs and fails for the right reason. With about 12B
active parameters, it stays cheap and fast enough to call once per risky branch
pair ($0.30 / $0.90 per million input/output tokens). Our 660-case benchmark cost $4.90 in total, and one analysis of the demo repo costs
about $0.01.

We use reasoning mode, which enables the model to generate explanations and intermediate reasoning steps before producing code or answers. If reasoning uses up its token budget while writing a
test, we retry with reasoning turned off. **The model's opinion never counts as proof:** for example, even if the model explains why two branches are risky, a conflict is only confirmed when a test actually fails on the merged code.

### 1. How would you rate Nemotron's output quality for your use case? (1-10)

**7 / 10**

Nemotron was strong at reasoning about code and following instructions, but
less reliable at writing tests that prove a conflict on real-world repos—for example, some generated tests failed to capture the actual behavioral conflict, or occasionally passed even when the merged code was broken.

What worked well:
- **Code reasoning.** Given two diffs, the changed definition and the other
  branch's call site, it usually named the real interaction. On the daimon
  case, its generated test proved the conflict in 3 of 3 runs.
- **Instruction-following.** It returned the JSON we asked for and wrote
  runnable pytest files. When a test failed for the wrong reason, feeding back
  the real pytest output usually produced a better test.
- **Cost.** Analysing a real pull-request pair cost a few cents.

What fell short:
- **Tests on real repos.** Its tests proved daimon 3/3 but KISS 0/3, even
  though it scored that pair 90/100. Some tests checked variable names instead
  of behaviour, so we added rules that reject them.
- **Consistency.** At temperature 0, the same prompt scored one pair 0, 0, 0 in
  one session and 95, 85, 85 in another. That hurts reproducibility, which matters for a tool meant to run in CI/CD pipelines.
- **Over-trusting the prompt.** When our prompt said "no signature change", the
  model repeated it as a reason a pair was safe, even though the return type
  had changed. Our static check only compares parameters, so we reworded the prompt to say exactly that: parameters were compared, but return values and behaviour were not checked.
- **Reasoning length.** Reasoning sometimes used the whole token budget before
  writing any code, so we added a retry with reasoning turned off—this leaves more tokens available for code generation, which improves reliability and ensures the model can complete its answer.

### 2. Did you fine-tune, prompt-engineer, or use Nemotron out of the box? What was your approach?

**Prompt engineering on the out-of-the-box model; no fine-tuning.** We focused
on what goes into each prompt and on checking what comes out.

- **Evidence, not whole repos.** A cheap static check first finds the
  functions one branch changed and the other branch calls. The prompt contains
  only those definitions, call sites and signature checks, trimmed to a fixed
  token budget.
- **Current documentation.** Tavily looks up docs for the third-party
  libraries in the changed code, and short snippets go into the prompt.
- **Measured prompt versions.** We iteratively improved the prompts, measuring their effectiveness on real and test cases after each change. The risk prompt went through 11 versions and the test-writing prompt through 8. After each change we re-ran our real cases and a harmless test repo, to make sure the change caught conflicts without creating false alarms.
- **Checked output.** If the model's explanation contradicts our static
  checks, it gets one repair call. If a generated test fails on its own branch,
  the model gets the real pytest output and tries again, up to 3 times.
- **Settings.** Temperature 0 and JSON output for risk scores. Reasoning is on
  for writing tests, with a fallback to reasoning off.

### 3. How did Nemotron's performance compare to other models you've used for similar tasks?

We did not benchmark other models inside PRshik; Nemotron 3 Super is the only
model it calls.

### 4. Which Nebius platform capabilities were most valuable to your project and how?

We used **Nebius Token Factory** as a serverless API. We did not rent GPU
instances or deploy the model ourselves. This let us focus on building PRshik’s features without managing infrastructure, kept costs predictable, and ensured reliable, scalable access to Nemotron for every branch pair analysis.

- **OpenAI-compatible API.** We pointed the standard OpenAI Python client at
  `https://api.tokenfactory.nebius.com/v1/` and changed nothing else. That kept
  our code simple and made it easy to replace the model with a fake one in our automated tests.
- **No infrastructure to run.** No GPU sizing, model loading or scaling work.
  PRshik calls Token Factory over HTTPS from wherever it runs, as long as an API key is set.
- **Low, predictable per-token pricing.** We price every call from the
  response's token usage and show the cost in the dashboard. The full
  660-case benchmark cost $4.90 in total.
- **Reasoning controls through the API.** ("Reasoning" here means the model generates explanations and intermediate steps before producing code or answers.) We switch reasoning off per request
  (`enable_thinking: false`) when it would use up the token budget.
- **The models endpoint.** Our health check calls the free `GET /models`
  endpoint to detect a revoked key before the first real call, helping avoid failed inference calls and improving reliability for users.
- **Concurrency:** our benchmark ran several runners in parallel against the
  same API.

### 5. How likely are you to recommend running Nemotron on Nebius to other developers? (1-10)

**Suggested: 8 [TEAM: your call]**

Getting started took minutes: we obtained an API key and a base URL, then used the standard `openai` Python package (or any OpenAI-compatible client) to connect—no custom SDK required. The price let us run a
660-case benchmark for under $5, which made it practical to measure every
prompt change instead of guessing. Points we would flag to other developers:
expect some run-to-run variation even at temperature 0—the same input can produce different outputs across runs, which affects reproducibility in CI/CD pipelines—and give reasoning a generous token budget or a fallback.

### 6. How would you rate your experience running Nemotron inference on Nebius compared to previous cloud or local development environments? (1-10)

**9 / 10**

Setup took minutes with the standard OpenAI client, and pricing was low and
predictable.

Compared with running open models locally, there was no GPU to manage and a
120B model was available immediately. Compared with other hosted APIs, the
OpenAI-compatible endpoint meant no new SDK to learn. The main friction was
error visibility: we built our own status reporting (ok, auth failed,
unreachable, error) so the dashboard could tell a bad key from a network
problem.

### 7. What additional features or improvements would have made the Nemotron on Nebius experience more effective for your project?

- **A seed parameter or more deterministic output at temperature 0**, so the
  same prompt gives the same score across runs. Deterministic outputs are crucial for reproducibility in CI/CD pipelines, where consistent results are needed to ensure reliable automation and debugging.
- **A per-request cap on reasoning tokens**, separate from the answer's
  `max_tokens`, so reasoning cannot crowd out the answer. This would improve reliability and cost control by ensuring that the model always has enough tokens left to generate a complete answer, rather than using up the entire token budget on intermediate reasoning steps.
- **Guaranteed JSON-schema output**, so we would not need to parse JSON out
  of free text—parsing errors can break downstream automation or reduce reliability.
- **Clearer error codes and a status page** that separate auth, quota and
  capacity problems.
- **Cached-prompt pricing**: since our prompts repeat a large instruction block for every branch pair, this increases costs; caching prompt instructions could reduce redundant charges.
- **[TEAM: anything else you ran into.]**

### 8. What do you most hope to see from the Nemotron team next?

- Stronger **code models for test generation**—tests that check behaviour rather than implementation details, across Python and TypeScript.
- More **consistent output** for identical inputs, which is critical for reproducible merge decisions in CI/CD pipelines.
- A **smaller, faster variant tuned for code review**—enabling inexpensive first-pass triage on every pull request—while reserving Super for the most challenging pairs.
- Published **benchmarks for multi-file code reasoning** (e.g., measuring how changes in one file impact callers in another).

### 9. Which AI tools have you leveraged while working on this project?

- **NVIDIA Nemotron 3 Super on Nebius Token Factory**: core inference engine used throughout the product workflow for risk explanations, test generation, and conflict resolution.
- **Tavily**: inside the product, for library documentation search.
- **Claude Code** (Anthropic): coding assistant for implementation, tests and
  documentation.
- **GitHub Copilot**: coding assistance.
- **Cursor**: used to test PRshik's MCP server with a real coding agent.
- **[TEAM: add any tools teammates used.]**
