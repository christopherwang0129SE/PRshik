import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RunSummary } from './RunSummary';
import type { AnalyzeResponse, UsageSummary } from '../types';

const usage: UsageSummary = {
  model: 'recorded-model', llm_calls: 0, cache_hits: 2, total_tokens: 0,
  prompt_tokens: 0, completion_tokens: 0, estimated_cost_usd: 0,
  input_usd_per_1m: 1, output_usd_per_1m: 2, pairs_total: 2,
  pairs_prefiltered: 0, pairs_sent_to_model: 2, pairs_capped: 0, top_k: 5,
  elapsed_s: 1, cached_llm_calls: 3, cached_tokens: 1234, cached_cost_usd: 0.0123,
};
const response: AnalyzeResponse = { base_branch: 'main', branches: ['a', 'b'], diffs: [], pairs: [], usage };

describe('RunSummary', () => {
  it('shows recorded cached usage with explicit cache labels', () => {
    render(<RunSummary response={response} target="repo" modelOk />);
    const figures = screen.getByTestId('run-figures');
    expect(within(figures).getByText('Nemotron calls').nextElementSibling).toHaveTextContent('3 (cached)');
    expect(within(figures).getByText('1,234 (cached)')).toBeVisible();
    expect(within(figures).getByText('$0.0123 (cached)')).toBeVisible();
    expect(screen.getByText(/Scoring & intent tests: Nemotron/)).toBeVisible();
  });
  it('keeps actual usage when this run made a call and gives fallback attribution', () => {
    render(<RunSummary response={{ ...response, usage: { ...usage, llm_calls: 1, total_tokens: 50, estimated_cost_usd: 0.001 } }} target="repo" />);
    expect(screen.getByText('Nemotron calls').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('50')).toBeVisible();
    expect(screen.queryByText('from cache')).not.toBeInTheDocument();
    expect(screen.getByText('Scores come from git + branch tests.')).toBeVisible();
  });
});

it('uses only the first sentence of the top confirmed model reading', () => {
  const pair = {
    branch_a: 'feature-a', branch_b: 'feature-b', score: 90, level: 'high' as const,
    shared_files: 1, overlapping_files: 0, collisions: [], score_source: 'model' as const,
    rationale: 'The operations change order. Further detail stays in the panel.',
    branch_tests: { status: 'confirmed' as const, reason: 'Recorded failure', files_a: [], files_b: [],
      unsupported_files: [], runs: [], confirming: [{ test_id: 't', branch: 'feature-a', file: 't.py', excerpt: '3 != 2' }],
      merge_conflict: false, duration_s: 1 },
  };
  const { rerender } = render(<RunSummary response={{ ...response, pairs: [pair] }} target="repo" />);
  expect(screen.getByText('feature-a and feature-b merge without a git conflict — but the operations change order.')).toBeVisible();
  for (const [reading, joined] of [
    ['A check fails.', 'a check fails.'], ['An operation fails.', 'an operation fails.'],
    ['This check fails.', 'this check fails.'], ['These checks fail.', 'these checks fail.'],
    ['Both checks fail.', 'both checks fail.'], ['Each check fails.', 'each check fails.'],
    ['TotalValue changes.', 'TotalValue changes.'], ['Alice changes order.', 'Alice changes order.'],
  ]) {
    rerender(<RunSummary response={{ ...response, pairs: [{ ...pair, rationale: reading }] }} target="repo" />);
    expect(screen.getByText(`feature-a and feature-b merge without a git conflict — but ${joined}`)).toBeVisible();
  }
  rerender(<RunSummary response={{ ...response, pairs: [{ ...pair, branch_tests: { ...pair.branch_tests, merge_conflict: true } }] }} target="repo" />);
  expect(screen.queryByText(/merge without a git conflict/)).not.toBeInTheDocument();
  expect(screen.getByText('feature-a and feature-b are merged — but the operations change order.')).toBeVisible();
});

it('labels the summary proof with the recorded state count and hides it without a failing merge', () => {
  const verification = (mergeFails: boolean) => ({
    status: 'confirmed' as const, reason: 'Recorded failure', attempts: 1, cached_test: false,
    merge_conflict: false, duration_s: 1, prompt_tokens: 0, completion_tokens: 0,
    runs: (['a', 'b', 'merge'] as const).map(target => {
      const fails = mergeFails && target === 'merge';
      return {
        target, ref: target, selection: '', exit_code: fails ? 1 : 0, passed: fails ? 0 : 1, failed: fails ? 1 : 0,
        errors: 0, timed_out: false, duration_s: 1, output: fails ? 'E assert 200.0 == 198.0' : '',
      };
    }),
  });
  const pair = {
    branch_a: 'feature-a', branch_b: 'feature-b', score: 90, level: 'high' as const, shared_files: 1,
    overlapping_files: 0, collisions: [], score_source: 'model' as const, rationale: 'Order changes.',
    verification: verification(true),
  };
  const { rerender } = render(<RunSummary response={{ ...response, pairs: [pair] }} target="repo" modelOk />);
  const proof = screen.getByRole('group', { name: 'Proof: Nemotron’s intent test on 3 states' });
  expect(within(proof).getAllByRole('listitem').map(item => item.textContent)).toEqual(['A onlyPASS', 'B onlyPASS', 'A+B mergeFAIL']);
  expect(within(proof).getByText('Merged code returns 200.0 — expected 198.0.')).toBeVisible();
  rerender(<RunSummary response={{ ...response, pairs: [{ ...pair, verification: verification(false) }] }} target="repo" modelOk />);
  expect(screen.queryByRole('group', { name: /^Proof:/ })).not.toBeInTheDocument();
});

it('omits absent usage and keeps the full model out of the stats', () => {
  render(<RunSummary response={{ ...response, usage: null, risk_model: 'full-model-id' }} target="repo" />);
  expect(screen.getByTestId('run-figures').children).toHaveLength(1);
  expect(screen.queryByText('full-model-id')).not.toBeInTheDocument();
});
