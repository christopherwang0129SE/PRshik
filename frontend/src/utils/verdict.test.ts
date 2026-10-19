import { describe, it, expect } from 'vitest';
import { verdictFor, pipelineFacts, needsAttention, failingTestCount } from './verdict';
import type { AnalyzeResponse, BranchTests, PairRisk } from '../types';

const bt = (extra: Partial<BranchTests> = {}): BranchTests => ({
  status: 'confirmed',
  reason: 'r',
  files_a: [],
  files_b: [],
  unsupported_files: [],
  runs: [],
  confirming: [{ test_id: 't::x', branch: 'a', file: 't.py', excerpt: '' }],
  merge_conflict: false,
  duration_s: 1,
  ...extra,
});

const pair = (extra: Partial<PairRisk> = {}): PairRisk => ({
  branch_a: 'a',
  branch_b: 'b',
  score: 0,
  level: 'none',
  shared_files: 0,
  overlapping_files: 0,
  collisions: [],
  rationale: 'r',
  score_source: 'git',
  git_score: 0,
  model_score: null,
  fallback_reason: null,
  ...extra,
});

describe('verdictFor', () => {
  it('leads with a hidden conflict proven by tests when git merges cleanly', () => {
    const v = verdictFor([pair({ score: 90, level: 'high', branch_tests: bt() }), pair({ branch_a: 'c' })]);
    expect(v.tone).toBe('proven');
    expect(v.headline).toBe('1 hidden conflict proven by tests');
    expect(v.detail).toBe('a and b merge without a git conflict, but 1 test fails on the merged code.');
  });

  it('drops "hidden" when the proven pair also overlaps in git', () => {
    const v = verdictFor([pair({ score: 90, level: 'high', overlapping_files: 1, branch_tests: bt() })]);
    expect(v.headline).toBe('1 conflict proven by tests');
    expect(v.detail).toBe('1 test fails when a and b are merged.');
  });

  it('counts risky pairs that no test proved', () => {
    const v = verdictFor([pair({ score: 55, level: 'medium' }), pair({ score: 75, level: 'high' }), pair()]);
    expect(v.tone).toBe('risky');
    expect(v.level).toBe('high');
    expect(v.headline).toBe('2 risky pairs to review before merging');
  });

  it('says no conflicts when every pair is none or low', () => {
    const v = verdictFor([pair(), pair({ score: 5, level: 'low' })]);
    expect(v.tone).toBe('clear');
    expect(v.headline).toBe('No conflicts found');
    expect(v.detail).toBe('All 2 branch pairs look safe to merge in any order.');
  });

  it('handles an analysis with no pairs', () => {
    expect(verdictFor([]).tone).toBe('empty');
  });
});

describe('helpers', () => {
  it('counts failing tests only from confirmed layers', () => {
    expect(failingTestCount(pair({ branch_tests: bt({ status: 'passed' }) }))).toBe(0);
    expect(failingTestCount(pair({ branch_tests: bt() }))).toBe(1);
  });

  it('needs attention for proven or medium+ pairs only', () => {
    expect(needsAttention(pair({ score: 5, level: 'low' }))).toBe(false);
    expect(needsAttention(pair({ score: 5, level: 'low', branch_tests: bt() }))).toBe(true);
    expect(needsAttention(pair({ score: 45, level: 'medium' }))).toBe(true);
  });

  it('summarises each pipeline step from the response', () => {
    const response: AnalyzeResponse = {
      base_branch: 'main',
      branches: ['a', 'b', 'c'],
      diffs: [],
      pairs: [
        pair({ score_source: 'model', branch_tests: bt() }),
        pair({ fallback_reason: 'prefiltered' }),
        pair({ fallback_reason: 'prefiltered' }),
      ],
    };
    expect(pipelineFacts(response)).toEqual([
      'Diffed 3 branches against main and scored 3 pairs.',
      'Reviewed 1 pair that share code; skipped 2 with nothing in common.',
      'Tested 1 pair on the merged code: 1 proven.',
    ]);
  });
});
