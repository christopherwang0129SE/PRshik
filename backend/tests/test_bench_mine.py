"""Mine revert and merge-fix cases from temporary git histories."""

from __future__ import annotations

import json
import os
import subprocess
from collections import Counter
from pathlib import Path

from scripts.bench.mine import (
    find_fix_events,
    integrated_changes,
    main,
    mine_cases,
)

_EPOCH = 1_704_067_200  # 2024-01-01 00:00:00 UTC


def _git(repo: Path, *args: str, day: int | None = None) -> str:
    env = os.environ.copy()
    env.update(
        {
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "t@example.com",
        }
    )
    if day is not None:
        stamp = f"{_EPOCH + day * 86400} +0000"
        env["GIT_AUTHOR_DATE"] = stamp
        env["GIT_COMMITTER_DATE"] = stamp
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return proc.stdout


def _init(tmp: Path) -> Path:
    repo = tmp / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "Test")
    return repo


def _rev(repo: Path) -> str:
    return _git(repo, "rev-parse", "HEAD").strip()


def _commit(
    repo: Path,
    subject: str,
    day: int,
    files: dict[str, str],
    body: str | None = None,
) -> str:
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    _git(repo, "add", "-A")
    args = ["commit", "-q", "-m", subject]
    if body is not None:
        args.extend(["-m", body])
    _git(repo, *args, day=day)
    return _rev(repo)


def _broke(repo: Path, **kwargs):
    changes = integrated_changes(repo, "main", 50)
    fixes = find_fix_events(repo, changes)
    cases = mine_cases(repo, changes, fixes, **kwargs)
    return changes, fixes, [case for case in cases if case.label == "broke"]


def test_squash_subject_pr_parsing(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "# demo\n"})
    _commit(repo, "Add widget (#42)", 1, {"widget.py": "print(1)\n"})
    _commit(repo, "Mention (#7) earlier", 2, {"notes.py": "x\n"})
    _commit(repo, "internal cleanup", 3, {"notes.py": "y\n"})

    changes = integrated_changes(repo, "main", 10)

    assert [change.subject for change in changes] == [
        "base",
        "Add widget (#42)",
        "Mention (#7) earlier",
        "internal cleanup",
    ]
    squash = changes[1]
    assert squash.kind == "squash"
    assert squash.pr == 42
    assert squash.files == {"widget.py"}
    assert squash.parent == changes[0].sha
    assert squash.time == _EPOCH + 86400
    assert changes[0].kind == "direct" and changes[0].pr is None
    assert changes[2].kind == "direct" and changes[2].pr is None
    assert changes[3].kind == "direct" and changes[3].pr is None


def test_merge_commit_file_set(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"a.py": "base\n", "keep.py": "keep\n"})
    base = _rev(repo)
    _git(repo, "checkout", "-q", "-b", "feature")
    feature = _commit(repo, "feature work", 1, {"a.py": "changed\n", "b.py": "new\n"})
    _git(repo, "checkout", "-q", "main")
    _git(
        repo,
        "merge",
        "--no-ff",
        "-m",
        "Merge pull request #5 from dev/feature",
        "feature",
        day=2,
    )

    changes = integrated_changes(repo, "main", 20)
    shas = {change.sha for change in changes}
    merge = changes[-1]

    assert feature not in shas
    assert merge.kind == "merge"
    assert merge.pr == 5
    assert merge.parent == base
    assert merge.files == {"a.py", "b.py"}
    assert merge.time == _EPOCH + 2 * 86400


def test_revert_is_positive_with_revert_confidence(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"shared.py": "base\n", "readme.md": "r\n"})
    a_sha = _commit(repo, "edit shared in A", 1, {"shared.py": "from A\n"})
    b_sha = _commit(repo, "edit shared in B", 2, {"shared.py": "from B\n"})
    _git(repo, "revert", "--no-edit", b_sha, day=3)
    fix_sha = _rev(repo)

    changes, fixes, broke = _broke(repo)
    reverts = [fix for fix in fixes if fix.kind == "revert"]

    assert len(reverts) == 1
    assert reverts[0].reverted_sha == b_sha
    assert len(broke) == 1
    case = broke[0]
    assert case.label == "broke"
    assert case.gt_kind == "revert"
    assert case.confidence == "revert"
    assert case.a["sha"] == a_sha
    assert case.a["subject"] == "edit shared in A"
    assert case.b["sha"] == b_sha
    assert case.fix_sha == fix_sha
    assert case.fix_subject.startswith('Revert "')
    assert case.case_id == f"repo-{a_sha[:8]}-{b_sha[:8]}"
    assert case.repo == "repo"
    assert case.pair_link == "shared-file"
    assert "shared.py" in case.a["files"] and "shared.py" in case.b["files"]


def test_merge_fix_naming_pr_is_explicit(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"parser.py": "base\n"})
    a_sha = _commit(repo, "Add parser (#10)", 1, {"parser.py": "A\n"})
    b_sha = _commit(repo, "Tighten parser (#11)", 2, {"parser.py": "B\n"})
    fix_sha = _commit(
        repo,
        "Fix the merge",
        3,
        {"parser.py": "fixed\n"},
        body="broken by #11",
    )

    _changes, fixes, broke = _broke(repo)

    assert len(fixes) == 1
    assert fixes[0].kind == "merge-fix"
    assert fixes[0].prs == [11]
    assert len(broke) == 1
    case = broke[0]
    assert case.gt_kind == "merge-fix"
    assert case.confidence == "explicit-merge-fix"
    assert case.a["sha"] == a_sha and case.a["pr"] == 10
    assert case.b["sha"] == b_sha and case.b["pr"] == 11
    assert case.fix_sha == fix_sha
    assert case.fix_subject == "Fix the merge"


def test_merge_fix_without_pr_is_weak(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"parser.py": "base\n"})
    _commit(repo, "Add parser", 1, {"parser.py": "A\n"})
    b_sha = _commit(repo, "Tighten parser", 2, {"parser.py": "B\n"})
    _commit(repo, "Fix the merge", 3, {"parser.py": "fixed\n"})

    _changes, _fixes, broke = _broke(repo)

    assert len(broke) == 1
    assert broke[0].confidence == "weak"
    assert broke[0].gt_kind == "merge-fix"
    assert broke[0].b["sha"] == b_sha


def test_pair_needs_a_shared_file(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "r\n"})
    _commit(repo, "add a", 1, {"a.py": "a\n"})
    b_sha = _commit(repo, "add b", 2, {"b.py": "b\n"})
    _git(repo, "revert", "--no-edit", b_sha, day=3)

    changes, fixes, broke = _broke(repo)
    drops: Counter[str] = Counter()

    assert any(fix.kind == "revert" and fix.reverted_sha == b_sha for fix in fixes)
    assert broke == []
    assert mine_cases(repo, changes, fixes, drops=drops) == []
    assert drops["no B found"] == 0
    assert drops["no A in window"] == 0
    assert drops["no shared link"] == 1


def test_reverted_sha_maps_to_containing_merge(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"shared.py": "base\n"})
    a_sha = _commit(repo, "edit shared in A", 1, {"shared.py": "from A\n"})
    _git(repo, "checkout", "-q", "-b", "feature")
    feature = _commit(repo, "edit shared on branch", 2, {"shared.py": "from feature\n"})
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "--no-ff", "-m", "Merge feature into main", "feature", day=3)
    merge = _rev(repo)
    _git(repo, "revert", "--no-edit", feature, day=4)

    changes, fixes, broke = _broke(repo)
    shas = {change.sha for change in changes}

    assert feature not in shas
    assert len(fixes) == 1
    assert fixes[0].kind == "revert"
    assert fixes[0].reverted_sha == feature
    assert len(broke) == 1
    case = broke[0]
    assert case.gt_kind == "revert"
    assert case.confidence == "revert"
    assert case.pair_link == "shared-file"
    assert case.a["sha"] == a_sha
    assert case.b["sha"] == merge
    assert case.b["subject"] == "Merge feature into main"


def test_revert_subject_pr_maps_to_merged_change(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"shared.py": "base\n"})
    a_sha = _commit(repo, "edit shared in A", 1, {"shared.py": "from A\n"})
    _git(repo, "checkout", "-q", "-b", "feature")
    _commit(repo, "Add widget (#42)", 2, {"shared.py": "widget\n"})
    _git(repo, "checkout", "-q", "main")
    _git(
        repo,
        "merge",
        "--no-ff",
        "-m",
        "Merge pull request #42 from dev/feature",
        "feature",
        day=3,
    )
    merge = _rev(repo)
    fix_sha = _commit(repo, 'Revert "Add widget (#42)" (#99)', 4, {"shared.py": "from A\n"})

    _changes, fixes, broke = _broke(repo)

    assert len(fixes) == 1
    assert fixes[0].kind == "revert"
    assert fixes[0].reverted_sha is None
    assert len(broke) == 1
    case = broke[0]
    assert case.gt_kind == "revert"
    assert case.confidence == "revert"
    assert case.pair_link == "shared-file"
    assert case.a["sha"] == a_sha
    assert case.b["sha"] == merge
    assert case.b["pr"] == 42
    assert case.fix_sha == fix_sha
    assert case.b["subject"] != 'Add widget (#42)'


def test_followup_fix_ground_truth(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "r\n"})
    _commit(repo, "Document prefixUrl and debug logging", 1, {"readme.md": "note\n"})
    a_sha = _commit(repo, "Add parser", 2, {"parser.py": "A\n"})
    b_sha = _commit(repo, "Tighten parser", 3, {"parser.py": "B\n"})
    fix_sha = _commit(repo, "Fix regression in parser", 4, {"parser.py": "fixed\n"})

    changes, fixes, broke = _broke(repo)

    assert [fix.change.subject for fix in fixes] == ["Fix regression in parser"]
    assert fixes[0].kind == "followup-fix"
    assert len(broke) == 1
    case = broke[0]
    assert case.gt_kind == "followup-fix"
    assert case.confidence == "weak"
    assert case.pair_link == "shared-file"
    assert case.a["sha"] == a_sha
    assert case.b["sha"] == b_sha
    assert case.fix_sha == fix_sha
    assert "parser.py" in case.a["files"] and "parser.py" in case.b["files"]
    assert changes[1].subject == "Document prefixUrl and debug logging"


def test_followup_fix_outside_window_is_dropped(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "r\n"})
    _commit(repo, "Add parser", 1, {"parser.py": "A\n"})
    _commit(repo, "Tighten parser", 2, {"parser.py": "B\n"})
    _commit(repo, "Fix regression in parser", 6, {"parser.py": "fixed\n"})

    changes = integrated_changes(repo, "main", 20)
    fixes = find_fix_events(repo, changes)
    drops: Counter[str] = Counter()
    cases = mine_cases(repo, changes, fixes, drops=drops)

    assert [fix.kind for fix in fixes] == ["followup-fix"]
    assert [case for case in cases if case.label == "broke"] == []
    assert drops["no B found"] == 1
    assert drops["no A in window"] == 0
    assert drops["no shared link"] == 0


def test_pair_link_when_fix_touches_both(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "r\n"})
    a_sha = _commit(repo, "edit a", 1, {"a.py": "A\n"})
    b_sha = _commit(repo, "edit b", 2, {"b.py": "B\n"})
    fix_sha = _commit(repo, "🐛 Restore both sides", 3, {"a.py": "A2\n", "b.py": "B2\n"})

    _changes, fixes, broke = _broke(repo)

    assert [fix.kind for fix in fixes] == ["followup-fix"]
    assert len(broke) == 1
    case = broke[0]
    assert case.gt_kind == "followup-fix"
    assert case.confidence == "weak"
    assert case.pair_link == "fix-touches-both"
    assert case.a["sha"] == a_sha
    assert case.b["sha"] == b_sha
    assert case.fix_sha == fix_sha
    assert set(case.a["files"]).isdisjoint(case.b["files"])


def test_followup_fix_ignores_one_sided_touch(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"readme.md": "r\n"})
    _commit(repo, "edit a", 1, {"a.py": "A\n"})
    _commit(repo, "edit b", 2, {"b.py": "B\n"})
    _commit(repo, "Fix bug in b only", 3, {"b.py": "B2\n"})

    changes = integrated_changes(repo, "main", 20)
    fixes = find_fix_events(repo, changes)
    drops: Counter[str] = Counter()
    broke = [case for case in mine_cases(repo, changes, fixes, drops=drops) if case.label == "broke"]

    assert [fix.kind for fix in fixes] == ["followup-fix"]
    assert broke == []
    assert drops["no shared link"] == 1


def test_out_of_window_fix_is_ignored(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"parser.py": "base\n"})
    _commit(repo, "Add parser (#10)", 1, {"parser.py": "A\n"})
    _commit(repo, "Tighten parser (#11)", 2, {"parser.py": "B\n"})
    _commit(
        repo,
        "Fix the merge",
        20,
        {"parser.py": "fixed\n"},
        body="broken by #11",
    )

    _changes, fixes, broke = _broke(repo)

    assert len(fixes) == 1
    assert fixes[0].kind == "merge-fix"
    assert broke == []


def test_negatives_skip_fix_touched_pairs_and_follow_seed(tmp_path: Path) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"README.md": "r\n"})
    _commit(repo, "c1", 1, {"clean.py": "c1\n"})
    _commit(repo, "c2", 2, {"clean.py": "c2\n"})
    _commit(repo, "o1", 3, {"other.py": "o1\n"})
    _commit(repo, "o2", 4, {"other.py": "o2\n"})
    _commit(repo, "s1", 5, {"solo.py": "s1\n"})
    _commit(repo, "s2", 6, {"solo.py": "s2\n"})
    _commit(repo, "touch bad", 7, {"bad.py": "b1\n"})
    _commit(repo, "Break parser (#11)", 8, {"bad.py": "b2\n"})
    _commit(
        repo,
        "Fix the merge",
        9,
        {"bad.py": "fixed\n", "clean.py": "fixed\n"},
        body="broken by #11",
    )

    changes = integrated_changes(repo, "main", 50)
    fixes = find_fix_events(repo, changes)
    all_cases = mine_cases(repo, changes, fixes, neg_ratio=100, seed=0)
    broke = [case for case in all_cases if case.label == "broke"]
    clean = [case for case in all_cases if case.label == "clean"]

    def pair(case) -> tuple[str, str]:
        return case.a["subject"], case.b["subject"]

    assert [pair(case) for case in broke] == [("touch bad", "Break parser (#11)")]
    assert broke[0].confidence == "explicit-merge-fix"
    clean_pairs = {pair(case) for case in clean}
    assert ("c1", "c2") not in clean_pairs
    assert ("touch bad", "Break parser (#11)") not in clean_pairs
    assert ("o1", "o2") in clean_pairs
    assert ("s1", "s2") in clean_pairs

    def negatives(seed: int) -> list[str]:
        cases = mine_cases(repo, changes, fixes, neg_ratio=1, seed=seed)
        return [case.case_id for case in cases if case.label == "clean"]

    assert negatives(0) == negatives(0)
    assert len(negatives(0)) == 1
    assert len({tuple(negatives(seed)) for seed in range(6)}) > 1


def test_cli_writes_jsonl_counts(tmp_path: Path, capsys) -> None:
    repo = _init(tmp_path)
    _commit(repo, "base", 0, {"shared.py": "base\n"})
    _commit(repo, "edit shared in A", 1, {"shared.py": "A\n"})
    b_sha = _commit(repo, "edit shared in B", 2, {"shared.py": "B\n"})
    _git(repo, "revert", "--no-edit", b_sha, day=3)
    out = tmp_path / "out" / "cases.jsonl"

    code = main(
        [
            "--repo",
            str(repo),
            "--branch",
            "main",
            "--max-commits",
            "20",
            "--out",
            str(out),
            "--neg-ratio",
            "1",
            "--seed",
            "0",
        ]
    )
    printed = capsys.readouterr().out
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]

    assert code == 0
    assert "fix events: 1" in printed
    assert "fix revert: 1" in printed
    assert "fix merge-fix: 0" in printed
    assert "fix followup-fix: 0" in printed
    assert "dropped no B found: 0" in printed
    assert "dropped no A in window: 0" in printed
    assert "dropped no shared link: 0" in printed
    assert "label broke: 1" in printed
    assert "confidence revert: 1" in printed
    assert rows[0]["label"] == "broke"
    assert rows[0]["confidence"] == "revert"
    assert rows[0]["pair_link"] == "shared-file"
    assert rows[0]["b"]["files"] == ["shared.py"]
