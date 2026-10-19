import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { VerificationDetails } from './VerificationDetails'
import { confirmingRuns } from '../utils/verification'
import { PairList } from './PairList'
import { usageLine } from '../utils/usage'
import type { PairRisk, Verification, UsageSummary } from '../types'

const CODE = 'import checkout\n\ndef test_branch_a_cap():\n    assert checkout.total(20.0, 10, 50.0, 10.0) == 198.0\n'

const verification = (extra: Partial<Verification> = {}): Verification => ({
  status: 'confirmed',
  reason: 'intent tests pass on A and on B; 1 that capture a branch\'s change fail on the merge of A+B',
  test_code: CODE,
  runs: [
    { target: 'a', ref: 'feat/discount-cap', selection: 'branch_a', exit_code: 0, passed: 1, failed: 0, errors: 0, timed_out: false, duration_s: 0.4, output: '' },
    { target: 'b', ref: 'feat/tax-before-discount', selection: 'branch_b', exit_code: 0, passed: 1, failed: 0, errors: 0, timed_out: false, duration_s: 0.4, output: '' },
    { target: 'base', ref: 'merge-base 6808b37', selection: 'branch', exit_code: 1, passed: 1, failed: 1, errors: 0, timed_out: false, duration_s: 0.4, output: '' },
    { target: 'merge', ref: 'feat/discount-cap+feat/tax-before-discount', selection: 'branch', exit_code: 1, passed: 1, failed: 1, errors: 0, timed_out: false, duration_s: 0.4, output: '' },
  ],
  attempts: 1,
  cached_test: false,
  sandbox: 'sandbox-exec(deny network, writes only in tmp) + socket guard',
  merge_conflict: false,
  confirming_tests: ['test_branch_a_cap'],
  duration_s: 21.3,
  prompt_tokens: 2900,
  completion_tokens: 3500,
  ...extra,
})

const pair = (extra: Partial<PairRisk> = {}): PairRisk => ({
  branch_a: 'feat/discount-cap',
  branch_b: 'feat/tax-before-discount',
  score: 47.5,
  level: 'medium',
  shared_files: 1,
  overlapping_files: 0,
  collisions: [],
  rationale: 'Cap assumes pre-tax subtotal.',
  score_source: 'model',
  git_score: 10,
  model_score: 85,
  model_level: 'high',
  fallback_reason: null,
  ...extra,
})

describe('VerificationDetails', () => {
  it('marks a confirmed intent test with the failure tone', () => {
    render(<VerificationDetails verification={verification()} />)
    expect(screen.getByText('Confirmed by intent test')).toHaveAttribute('data-tone', 'fail')
  })

  it('keeps the generated test collapsed until expanded', () => {
    const { container } = render(<VerificationDetails verification={verification()} />)
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const summary = screen.getByText(/Generated test/, { selector: 'summary' })
    expect(summary).toHaveTextContent('Generated test (1 attempt, 21.3s)')
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    // Line numbers come from CSS counters: the code text stays exact for copy.
    const code = screen.getByRole('region', { hidden: true, name: 'Generated test code' }) ?? null
    expect(code.querySelector('code')?.textContent).toBe(CODE)
    expect(screen.getByText(/Merge A\+B/).parentElement).toHaveTextContent('1 passed, 1 failed')
    expect(screen.getByText(/Fails on merge:/)).toHaveTextContent('Fails on merge: test_branch_a_cap')
  })

  it('labels suspected and skipped results without the confirmed badge', () => {
    const { rerender } = render(
      <VerificationDetails verification={verification({ status: 'suspected', reason: 'generated test also passes on the merge' })} />
    )
    expect(screen.queryByText('Confirmed by intent test')).toBeNull()
    expect(screen.getByText('Suspected: intent test inconclusive')).toBeInTheDocument()
    rerender(
      <VerificationDetails verification={verification({ status: 'skipped', test_code: null, runs: [] })} />
    )
    expect(screen.getByText('Intent test skipped')).toBeInTheDocument()
    expect(screen.queryByText(/Generated test/)).toBeNull()
  })

  it('renders inside the pair table row only for pairs that were verified', () => {
    render(
      <PairList
        pairs={[pair({ verification: verification() }), pair({ branch_b: 'docs/readme', score: 0, level: 'none', verification: null })]}
       
      />
    )
    expect(screen.getAllByTestId('verification')).toHaveLength(1)
    expect(screen.getByText('Confirmed by intent test')).toBeInTheDocument()
  })

  it('shows the raised score note in the level cell of a confirmed pair', () => {
    const { container } = render(
      <PairList
        pairs={[
          pair({
            score: 90,
            level: 'high',
            blended_score: 47.5,
            score_note: 'raised: confirmed by test',
            score_source: 'model',
            model_level: 'high',
            verification: verification(),
          }),
        ]}
       
      />
    )
    expect(screen.getByTestId('pair-score')).toHaveTextContent('90/100, High')
    expect(screen.getByTestId('score-note')).toHaveTextContent('raised: confirmed by test (blend 48)')
    // Git and model columns stay as reported.
    expect(screen.getByTestId('git-score')).toHaveTextContent('10')
    expect(screen.getByTestId('model-score')).toHaveTextContent('85')
    // Confirmed/High uses the red edge, not the amber hidden-conflict edge.
    const row = container.querySelector('[data-testid="pair-card"]')
    expect(row!.classList.contains('pair-confirmed')).toBe(true)
    expect(row!.classList.contains('pair-hidden-conflict')).toBe(false)
  })

  it('shows no note for a suspected pair', () => {
    render(
      <PairList
        pairs={[pair({ verification: verification({ status: 'suspected' }) })]}
       
      />
    )
    expect(screen.queryByTestId('score-note')).toBeNull()
    expect(screen.getByTestId('pair-score')).toHaveTextContent('Medium')
  })

  it('adds confirmed-by-test counts to the usage line', () => {
    const usage: UsageSummary = {
      model: 'm', llm_calls: 2, cache_hits: 0, prompt_tokens: 4097, completion_tokens: 4618,
      total_tokens: 8715, estimated_cost_usd: 0.0053853, input_usd_per_1m: 0.3, output_usd_per_1m: 0.9,
      pairs_total: 3, pairs_prefiltered: 2, pairs_sent_to_model: 1, pairs_capped: 0, top_k: 5,
      verify_pairs: 1, verify_confirmed: 1, elapsed_s: 38.8,
    }
    expect(usageLine(usage)).toBe(
      '2 LLM calls · 8,715 tokens · $0.0054 est. · 2 filtered before LLM · 1/1 confirmed by intent test'
    )
  })
})

describe('intent test proof strip', () => {
  it('counts only the confirming tests per checkout, not discarded ones', () => {
    const v = verification({
      confirming_tests: ['test_a'],
      runs: [
        { target: 'a', ref: 'feat/a', selection: 'branch_a', exit_code: 0, passed: 1, failed: 0, errors: 0, timed_out: false, duration_s: 0.1, output: '', cases: { test_a: 'passed' } },
        { target: 'b', ref: 'feat/b', selection: 'branch_b', exit_code: 1, passed: 0, failed: 1, errors: 0, timed_out: false, duration_s: 0.1, output: '', cases: { test_b: 'failed' } },
        { target: 'merge', ref: 'feat/a+feat/b', selection: 'branch', exit_code: 1, passed: 0, failed: 2, errors: 0, timed_out: false, duration_s: 0.1, output: '', cases: { test_a: 'failed', test_b: 'failed' } },
      ],
    })
    expect(confirmingRuns(v).map((r) => [r.target, r.passed, r.failed])).toEqual([
      ['a', 1, 0],
      ['merge', 0, 1],
    ])
    render(<VerificationDetails verification={v} />)
    const table = screen.getByRole('table', { name: 'Intent test results per checkout' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual(['Afeat/a1 passed', 'A+Bmerged1 failed'])
    expect(rows[0]).toHaveAttribute('data-outcome', 'pass')
    expect(rows[1]).toHaveAttribute('data-outcome', 'fail')
    expect(table).not.toHaveTextContent('feat/b')
  })
})

describe('intent test failure evidence', () => {
  const OUTPUT = [
    'F [100%]',
    '=================================== FAILURES ===================================',
    '___________ test_branch_a_cap ___________',
    '    def test_branch_a_cap():',
    '>       assert checkout.total(20.0, 10, 50.0, 10.0) == 198.0',
    'E       assert 200.0 == 198.0',
    '',
    'test_mergeguard_intent.py:4: AssertionError',
    '1 failed in 0.1s',
  ].join('\n')

  const withOutput = () =>
    verification({
      test_path: '/tmp/verify/test_mergeguard_intent.py',
      runs: verification().runs.map((run) =>
        run.target === 'merge' ? { ...run, output: OUTPUT, failure_lines: { test_branch_a_cap: 4 } } : run
      ),
    })

  it('shows the failing assertion from the merge run without expanding anything', () => {
    render(<VerificationDetails verification={withOutput()} />)
    const excerpt = screen.getByRole('region', { name: 'Failure in test_branch_a_cap on the merge' })
    expect(excerpt.closest('details')).toBeNull()
    expect(excerpt).toHaveTextContent('E assert 200.0 == 198.0')
    expect(excerpt).toHaveTextContent('test_mergeguard_intent.py:4: AssertionError')
    expect(excerpt.querySelectorAll('[data-marked]')).toHaveLength(2)
  })

  it('names the generated test file and marks its failing line', () => {
    render(<VerificationDetails verification={withOutput()} />)
    expect(screen.getByText(/Generated test/, { selector: 'summary' })).toHaveTextContent('test_mergeguard_intent.py')
    const code = screen.getByRole('region', { hidden: true, name: 'Generated test code' })
    const lines = [...code.querySelectorAll('.code-line')]
    expect(lines[3]).toHaveAttribute('data-marked')
    expect(lines.filter((l) => l.hasAttribute('data-marked'))).toHaveLength(1)
  })
})
