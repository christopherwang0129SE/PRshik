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
    expect(within(figures).getByText('Nemotron calls').nextElementSibling).toHaveTextContent('3from cache');
    expect(within(figures).getByText('1,234 (cached)')).toBeVisible();
    expect(within(figures).getByText('$0.0123 (cached)')).toBeVisible();
    expect(screen.getByText(/Scoring & intent tests: NVIDIA/)).toBeVisible();
  });
  it('keeps actual usage when this run made a call and gives fallback attribution', () => {
    render(<RunSummary response={{ ...response, usage: { ...usage, llm_calls: 1, total_tokens: 50, estimated_cost_usd: 0.001 } }} target="repo" />);
    expect(screen.getByText('Nemotron calls').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('50')).toBeVisible();
    expect(screen.queryByText('from cache')).not.toBeInTheDocument();
    expect(screen.getByText('Scores come from git + branch tests.')).toBeVisible();
  });
});
