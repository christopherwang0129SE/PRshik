import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PairDetail } from './PairDetail';
import type { PairRisk } from '../types';

vi.mock('./PairDiff', () => ({ PairDiff: () => <div>Long diff</div> }));

const pair: PairRisk = {
  branch_a: 'a', branch_b: 'b', score: 10, level: 'low', shared_files: 1,
  overlapping_files: 0, collisions: [], score_source: 'git', rationale: 'Tax changes the capped subtotal.',
  branch_tests: {
    status: 'confirmed', reason: 'Fails on merge', files_a: [], files_b: [], unsupported_files: [], runs: [],
    confirming: [{ test_id: 'test_total', branch: 'a', file: 'test.py', excerpt: '> assert total() == 198.0\nE assert 200.0 == 198.0' }],
    merge_conflict: false, duration_s: 1,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('PairDetail proof', () => {
  it('puts assertion, checkout and explanation immediately after the header', () => {
    render(<PairDetail pair={pair} source={{ repo_path: '/repo' }} baseBranch="main" />);
    const proof = screen.getByRole('region', { name: 'Critical proof' });
    expect(proof.previousElementSibling?.tagName).toBe('HEADER');
    expect(proof).toHaveTextContent('assert 200.0 == 198.0');
    expect(proof).toHaveTextContent('A+B merge');
    expect(proof).not.toHaveTextContent(pair.rationale);
    expect(screen.getByText(pair.rationale)).toBeInTheDocument();
    expect(proof.compareDocumentPosition(screen.getByText('Long diff')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the four recorded verification outcomes in checkout order', () => {
    render(<PairDetail pair={{ ...pair, score_source: 'model', verification: {
      status: 'confirmed', reason: 'Recorded test failure',
      runs: (['merge', 'b', 'base', 'a'] as const).map(target => ({
        target, ref: target, selection: '', exit_code: target === 'merge' ? 1 : 0,
        passed: target === 'merge' ? 0 : 1, failed: target === 'merge' ? 1 : 0,
        errors: 0, timed_out: false, duration_s: 1, output: '',
      })), attempts: 1, cached_test: false, merge_conflict: false,
      duration_s: 1, prompt_tokens: 0, completion_tokens: 0,
    } }} source={{ repo_path: '/repo' }} baseBranch="main" />);
    const matrix = screen.getByLabelText('Verification run outcomes');
    expect(Array.from(matrix.children).map(row => row.textContent)).toEqual([
      'BasePASS', 'A onlyPASS', 'B onlyPASS', 'A+B mergeFAIL',
    ]);
    const reading = screen.getByRole('heading', { name: 'Nemotron’s reading' });
    const score = screen.getByTestId('risk-gauge');
    expect(matrix.compareDocumentPosition(reading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reading.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses changes on narrow screens and opens by keyboard-accessible disclosure', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<PairDetail pair={pair} source={{ repo_path: '/repo' }} baseBranch="main" provisional />);
    const toggle = screen.getByText('Show changes');
    expect(toggle.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Long diff')).not.toBeVisible();
    expect(screen.getByText('Provisional git score · tests running')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Long diff')).toBeVisible();
  });

  it('uses generated test output when branch tests provide no proof', () => {
    render(<PairDetail pair={{ ...pair, branch_tests: null, verification: {
      status: 'confirmed', reason: 'Fails on merge', runs: [{ target: 'merge', ref: 'merge', selection: '', exit_code: 1,
        passed: 0, failed: 1, errors: 0, timed_out: false, duration_s: 1, output: 'E assert 42 == 40' }],
      attempts: 1, cached_test: false, merge_conflict: false, duration_s: 1, prompt_tokens: 0, completion_tokens: 0,
    } }} source={{ repo_path: '/repo' }} baseBranch="main" />);
    expect(screen.getByRole('region', { name: 'Critical proof' })).toHaveTextContent('assert 42 == 40');
    const matrix = screen.getByLabelText('Verification run outcomes');
    expect(matrix).toHaveTextContent('A+B mergeFAIL');
    expect(matrix).not.toHaveTextContent('PASS');
    expect(matrix.children).toHaveLength(1);
  });
});
