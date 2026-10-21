#!/usr/bin/env python3
"""Mine broke/clean pairs from first-parent history.

    python backend/scripts/bench/mine.py --repo PATH --branch main \\
        --max-commits 1500 --out cases.jsonl --neg-ratio 1
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

_LOG_FMT = "%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e"
_DAY = 86400

_MERGE_PR_RE = re.compile(r"^Merge pull request #(\d+)\b")
_TRAILING_PR_RE = re.compile(r"\(#(\d+)\)\s*$")
_REVERT_SHA_RE = re.compile(r"This reverts commit ([0-9a-fA-F]{7,40})")
_PR_RE = re.compile(r"#(\d+)")
_MERGE_FIX_RE = re.compile(
    r"fix(?:ed)? (?:the )?merge"
    r"|merge (?:conflict|fix|skew)"
    r"|semantic conflict"
    r"|broken (?:by|after) (?:merge|#\d+)"
    r"|fix .*after merg"
    r"|fix (?:the )?(?:build|ci|tests?) (?:after|broken by|from|for) #\d+"
    r"|broke(?:n)? by #\d+",
    re.IGNORECASE | re.DOTALL,
)
_CONF_RANK = {"revert": 3, "explicit-merge-fix": 2, "weak": 1, "none": 0}


@dataclass
class Change:
    sha: str
    parent: str
    kind: str
    pr: int | None
    time: int
    subject: str
    files: set[str]
    body: str = ""


@dataclass
class FixEvent:
    change: Change
    kind: str
    reverted_sha: str | None
    prs: list[int] = field(default_factory=list)


@dataclass
class Case:
    case_id: str
    repo: str
    a: dict
    b: dict
    label: str
    gt_kind: str
    confidence: str
    fix_sha: str | None
    fix_subject: str | None


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "--no-pager", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or f"git {args[0]} failed"
        raise RuntimeError(detail)
    return proc.stdout


def _pr_in_subject(subject: str) -> int | None:
    match = _MERGE_PR_RE.match(subject) or _TRAILING_PR_RE.search(subject)
    return int(match.group(1)) if match else None


def _kind(subject: str, parent_count: int) -> tuple[str, int | None]:
    pr = _pr_in_subject(subject)
    if parent_count > 1 or _MERGE_PR_RE.match(subject):
        return "merge", pr
    if pr is not None:
        return "squash", pr
    return "direct", None


def _files(repo: Path, parent: str, sha: str) -> set[str]:
    args = (
        ["diff", "--name-only", "-z", parent, sha]
        if parent
        else ["diff-tree", "--root", "--name-only", "--no-commit-id", "-r", "-z", sha]
    )
    return {name for name in _git(repo, *args).split("\0") if name}


def integrated_changes(repo: Path, branch: str, max_commits: int) -> list[Change]:
    """First-parent history of ``branch``, oldest commit first."""
    repo = Path(repo)
    if max_commits <= 0:
        return []
    raw = _git(
        repo, "log", "--first-parent", "-n", str(max_commits), f"--format={_LOG_FMT}", branch, "--"
    )
    changes: list[Change] = []
    for record in raw.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split("\x1f")
        if len(parts) < 4:
            continue
        sha, parents_raw, committed, subject, *rest = parts
        parents = parents_raw.split()
        parent = parents[0] if parents else ""
        kind, pr = _kind(subject, len(parents))
        changes.append(
            Change(
                sha, parent, kind, pr, int(committed), subject, _files(repo, parent, sha), "\x1f".join(rest)
            )
        )
    changes.reverse()
    return changes


def _referenced_prs(text: str) -> list[int]:
    return list(dict.fromkeys(int(match.group(1)) for match in _PR_RE.finditer(text)))


def _revert_target(subject: str) -> str | None:
    if not subject.startswith('Revert "'):
        return None
    quoted = subject[len('Revert "') :]
    if quoted.endswith('"'):
        return quoted[:-1]
    return None


def find_fix_events(repo: Path, changes: list[Change]) -> list[FixEvent]:
    """Reverts, then merge-fix messages. Other changes are omitted."""
    del repo  # commit bodies were stored while reading this repo
    events: list[FixEvent] = []
    for change in changes:
        text = f"{change.subject}\n{change.body}"
        prs = _referenced_prs(text)
        sha_match = _REVERT_SHA_RE.search(change.body)
        if sha_match or change.subject.startswith('Revert "'):
            reverted = sha_match.group(1) if sha_match else None
            events.append(FixEvent(change, "revert", reverted, prs))
            continue
        if _MERGE_FIX_RE.search(text):
            events.append(FixEvent(change, "merge-fix", None, prs))
    return events


def _as_dict(change: Change) -> dict:
    return {
        "sha": change.sha,
        "parent": change.parent,
        "kind": change.kind,
        "pr": change.pr,
        "time": change.time,
        "subject": change.subject,
        "files": sorted(change.files),
    }


def _sha_match(left: str, right: str) -> bool:
    a, b = left.lower(), right.lower()
    return bool(a) and bool(b) and (a.startswith(b) or b.startswith(a))


def _case(
    repo_name: str,
    earlier: Change,
    later: Change,
    label: str,
    gt_kind: str,
    confidence: str,
    fix_sha: str | None,
    fix_subject: str | None,
) -> Case:
    return Case(
        case_id=f"{repo_name}-{earlier.sha[:8]}-{later.sha[:8]}",
        repo=repo_name,
        a=_as_dict(earlier),
        b=_as_dict(later),
        label=label,
        gt_kind=gt_kind,
        confidence=confidence,
        fix_sha=fix_sha,
        fix_subject=fix_subject,
    )


def _confidence(fix: FixEvent, broken: Change) -> str:
    if (
        fix.kind == "revert"
        and fix.reverted_sha is not None
        and _sha_match(fix.reverted_sha, broken.sha)
    ):
        return "revert"
    if fix.kind == "merge-fix" and broken.pr is not None and broken.pr in fix.prs:
        return "explicit-merge-fix"
    return "weak"


def mine_cases(
    repo: Path,
    changes: list[Change],
    fixes: list[FixEvent],
    max_days: int = 14,
    max_gap_commits: int = 40,
    pair_days: int = 7,
    pair_gap: int = 30,
    neg_ratio: float = 1.0,
    seed: int = 0,
) -> list[Case]:
    """Positive fix pairs, then ``round(neg_ratio * positives)`` clean pairs."""
    repo_name = Path(repo).resolve().name
    index = {change.sha: i for i, change in enumerate(changes)}

    def before(later: Change, days: int, gap: int) -> list[Change]:
        end = index[later.sha]
        return [
            change
            for change in changes[max(0, end - gap) : end]
            if 0 <= later.time - change.time <= days * _DAY
        ]

    def pick_broken(fix: FixEvent) -> Change | None:
        prior = before(fix.change, max_days, max_gap_commits)
        if fix.kind == "revert":
            if fix.reverted_sha:
                for change in reversed(prior):
                    if _sha_match(fix.reverted_sha, change.sha):
                        return change
            quoted = _revert_target(fix.change.subject)
            if quoted is not None:
                for change in reversed(prior):
                    if change.subject == quoted:
                        return change
            return None
        for change in reversed(prior):
            if change.pr is not None and change.pr in fix.prs:
                return change
        touched = fix.change.files
        for change in reversed(prior):
            if change.files & touched:
                return change
        return None

    def pick_partner(broken: Change, fix: Change) -> Change | None:
        best: Change | None = None
        best_key: tuple[int, int, int, int] | None = None
        for change in before(broken, pair_days, pair_gap):
            shared = change.files & broken.files
            if not shared:
                continue
            key = (
                len(shared & fix.files),
                len(shared),
                len(change.files & fix.files),
                index[change.sha],
            )
            if best_key is None or key > best_key:
                best, best_key = change, key
        return best

    slots: dict[tuple[str, str], Case] = {}
    order: list[tuple[str, str]] = []
    for fix in fixes:
        broken = pick_broken(fix)
        if broken is None:
            continue
        partner = pick_partner(broken, fix.change)
        if partner is None:
            continue
        key = (partner.sha, broken.sha)
        case = _case(
            repo_name,
            partner,
            broken,
            "broke",
            fix.kind,
            _confidence(fix, broken),
            fix.change.sha,
            fix.change.subject,
        )
        if key in slots:
            if _CONF_RANK[case.confidence] > _CONF_RANK[slots[key].confidence]:
                slots[key] = case
            continue
        slots[key] = case
        order.append(key)
    positives = [slots[key] for key in order]

    def later_fix_touches(earlier: Change, later: Change) -> bool:
        watched = earlier.files | later.files
        later_index = index[later.sha]
        for fix in fixes:
            fix_change = fix.change
            if index[fix_change.sha] <= later_index:
                continue
            delta = fix_change.time - later.time
            if delta < 0 or delta > max_days * _DAY:
                continue
            if fix_change.files & watched:
                return True
        return False

    eligible: list[tuple[Change, Change]] = []
    for later in changes:
        for earlier in before(later, pair_days, pair_gap):
            if not (earlier.files & later.files):
                continue
            if (earlier.sha, later.sha) in slots:
                continue
            if later_fix_touches(earlier, later):
                continue
            eligible.append((earlier, later))
    random.Random(seed).shuffle(eligible)
    count = max(0, round(neg_ratio * len(positives)))
    negatives = [
        _case(repo_name, earlier, later, "clean", "none", "none", None, None)
        for earlier, later in eligible[:count]
    ]
    return positives + negatives


def _print_counts(cases: list[Case]) -> None:
    labels = Counter(case.label for case in cases)
    confidences = Counter(case.confidence for case in cases)
    print(f"cases: {len(cases)}")
    for label in ("broke", "clean"):
        print(f"label {label}: {labels.get(label, 0)}")
    for confidence in ("revert", "explicit-merge-fix", "weak", "none"):
        print(f"confidence {confidence}: {confidences.get(confidence, 0)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--branch", default="main")
    parser.add_argument("--max-commits", type=int, default=1500)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--neg-ratio", type=float, default=1.0)
    parser.add_argument("--max-days", type=int, default=14)
    parser.add_argument("--max-gap-commits", type=int, default=40)
    parser.add_argument("--pair-days", type=int, default=7)
    parser.add_argument("--pair-gap", type=int, default=30)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    changes = integrated_changes(args.repo, args.branch, args.max_commits)
    fixes = find_fix_events(args.repo, changes)
    cases = mine_cases(
        args.repo,
        changes,
        fixes,
        max_days=args.max_days,
        max_gap_commits=args.max_gap_commits,
        pair_days=args.pair_days,
        pair_gap=args.pair_gap,
        neg_ratio=args.neg_ratio,
        seed=args.seed,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as handle:
        for case in cases:
            handle.write(json.dumps(asdict(case), ensure_ascii=False) + "\n")
    _print_counts(cases)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
