# PRshik (MergeGuard) real-repo benchmark: v2

Replays pairs of already-merged changes A and B from open-source repos. Each case asks whether A and B together break something.

The v2 numbers come from a full rerun on `main` at 80a3662, which includes PR #8 (detection rework, v11 prompt). The run used the same 660 cases as v1 and fresh clones of the 32 repos.

All figures are copied from `docs/bench/report-summary.md` (report.py output, 2026-10-27 19:35 CET) or from per-record checks of the result files. Nothing is estimated.

## Summary

- **660 cases from 32 repos, the same case set as v1.** Statuses: 493 ok, 167 replay_failed, 0 timeout, 0 error.
- **Of the 493 ok cases:**
  - Labels: 250 mined broke, 243 mined clean.
  - Language: Python 343, TypeScript 150.
  - Levels: low 427, medium 42, none 16, high 8.
  - Nemotron scored 451 of them; 42 used the git score (prefiltered).
- **Flagged: 4 of 493; test-confirmed: 1.** Flagged means level high or test-confirmed.
  - The 4 other high cases have a textual merge conflict.
  - report.py now counts textual conflicts as a separate category (6 cases) rather than as semantic catches.
- **Hand ground truth (n=274 ok, 272 clean, 2 broke):** TP 0, FP 1, FN 2, TN 271; specificity 0.996.
  - The one false alarm, `pydantic-settings a853a132 × c2fd92ff`, was confirmed by branch tests (a test from the branches passes on each branch and fails on the merge).
  - Both hand-confirmed interactions in the ok set were missed (black, levels low and medium).
  - With 2 positives, recall is not statistically meaningful.
- **Mined ground truth (n=493):** TP 3, FP 1, FN 247, TN 242; precision 0.750, recall 0.012.
  - Mined positives are mostly noise: in v1's hand check, 3 of 49 were real interactions.
- **Spend: $1.5456 of the $9 cap** (sum of per-case cost; mean $0.002 per case). Summed per-case time: 8227 s (6 runners in parallel).

## v1 → v2

| | v1 (2026-10-22) | v2 (2026-10-27, main incl. #8) |
|---|---:|---:|
| cases | 660 | 660 (same set) |
| ok / replay_failed | 628 / 32 | 493 / 167 |
| flagged | 136 | 4 |
| test-confirmed | 2 | 1 |
| hand FP | 73 (n=349) | 1 (n=274) |
| hand TP | 0 of 3 | 0 of 2 |
| spend | $4.9031 | $1.5456 |

**Like for like, on the 493 cases that were ok in both runs:**
- flagged: v1 21 → v2 4;
- hand-labelled false alarms (n=274): v1 12 → v2 1;
- hand TP: 0 in both.

**What the comparison says:** the reworked detector almost eliminates false alarms on clean pairs. It still does not catch the few real interactions in this sample. The checkout, API, KISS, Elastic and qwen-code demos are separate, reproduced cases (see `demo/`).

**Why replay_failed rose from 32 to 167:** this is not a regression in the engine. Since 68473f7, replay rejects a PR-head fallback whose head already contains A, or that is empty, because such a pair is not a parallel change. 135 cases that v1 replayed as ok are now excluded this way: B's squash commit does not apply on A's parent, and B's PR head already contains A. Example: `psf__black-b719d85c-8b340e21`, where the head of PR #463 contains A. One of v1's 3 hand-confirmed interactions (`fastapi 73c411e1 × 98244866`) is among the excluded cases.

**Other measured notes:**
- Branch tests status on ok cases: passed 243, error 119, skipped 114, confirmed 1.
- Intent-test verification ran on 25 cases: suspected 22, skipped 2, error 1.

## Setup

`backend/scripts/bench/mine.py` mines broke and clean pairs from first-parent history. A mined broke case is a pair A, B whose later follow-up fix touched both. The v2 case files were rebuilt exactly from v1's `results.csv` (same case ids, SHAs, parents and kinds).

`backend/scripts/bench/replay.py` rebuilds one case as local branches `main` (A's parent), `a` and `b`, with no remote. `backend/scripts/bench/run.py` is the budgeted, resumable per-case run (one child process per case, `--venv --verify`, `--max-usd 9.0`, `--timeout 600`).

The report command was:

```
cd backend
R=/workspace/mg-bench-repos/results-v2 L=docs/bench/labels
.venv/bin/python scripts/bench/report.py \
  --results $R/v2-a --results $R/v2-b --results $R/v2-c \
  --results $R/v2-d --results $R/v2-e --results $R/v2-f \
  --labels $L/pilot-hand-labels.csv --labels $L/full-hand-labels.csv \
  --src-root /workspace/mg-bench-repos/src --out-dir <out>
```

The results live outside the repo, under `/workspace/mg-bench-repos/results-v2/`. The full per-slice tables are in `report-summary.md`.
