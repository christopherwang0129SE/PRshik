#!/usr/bin/env python3
"""Rebuild the checkout fixture and prove its clean-merge regression."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "demo"))

import make_demo_repo  # noqa: E402
from app.api.routes import analyze  # noqa: E402
from app.config import settings  # noqa: E402
from app.schemas import AnalyzeRequest  # noqa: E402

BRANCHES = ["feat/discount-cap", "feat/tax-before-discount"]


def main() -> int:
    make_demo_repo.create_repo()
    repo = make_demo_repo.DEMO_DIR
    merge = subprocess.run(
        ["git", "-C", str(repo), "merge-tree", "--write-tree", *BRANCHES],
        capture_output=True,
        text=True,
    )
    if merge.returncode:
        print("FAIL: Git did not produce a clean merge.")
        return 1
    print("Git: clean merge (no textual conflicts).")
    model = settings.nebius_ready
    print(
        "Path: Nemotron risk + verify-by-test + branch tests on merge."
        if model else
        "Path: deterministic branch tests on merge (no enabled Nebius key; no LLM)."
    )
    result = analyze(AnalyzeRequest(
        repo_path=str(repo), base_branch="main", branches=BRANCHES,
        use_cache=False, verify=True,
    ))
    pair = result.pairs[0]
    print(f"MergeGuard: {pair.branch_a} + {pair.branch_b}: {pair.score:g}/100, {pair.level}.")
    intent = pair.verification
    branch = pair.branch_tests
    proven = False
    if model:
        print(f"Verify-by-test: {intent.status if intent else 'not run'}.")
    if intent and intent.status == "confirmed":
        proven = True
        print("Proof path: Nemotron verify-by-test.")
        print("Confirming tests: " + ", ".join(intent.confirming_tests))
        for run in intent.runs:
            if run.target == "merge":
                evidence = [
                    line for line in run.output.splitlines()
                    if line.startswith(("E ", "FAILED ")) or "AssertionError" in line
                ]
                print("\n".join(evidence[:12]))
    elif branch and branch.status == "confirmed":
        proven = True
        print("Proof path: deterministic branch tests on merge.")
        if model:
            print("Generated intent test did not confirm; branch tests supply the proof.")
        for failure in branch.confirming:
            print(f"FAIL on merge, PASS on {failure.branch}: {failure.test_id}")
            print(failure.excerpt.strip())
    else:
        print(f"No proof: {branch.reason if branch else 'branch tests did not run'}.")
    success = pair.level == "high" and proven
    print("PASS: pair flagged and proven." if success else "FAIL: pair not flagged and proven.")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
