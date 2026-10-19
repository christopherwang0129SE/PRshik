import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairList } from './PairList'
import type { PairRisk } from '../types'

const pair = (
  a: string,
  b: string,
  score: number,
  level: PairRisk['level'],
  extra: Partial<PairRisk> = {}
): PairRisk => ({
  branch_a: a,
  branch_b: b,
  score,
  level,
  shared_files: 1,
  overlapping_files: 0,
  collisions: [],
  rationale: 'rationale',
  score_source: 'git',
  git_score: score,
  model_score: null,
  fallback_reason: null,
  ...extra,
})

describe('PairList', () => {
  it('sorts pairs by score descending', () => {
    const pairs = [
      pair('a', 'b', 10, 'low'),
      pair('c', 'd', 90, 'high'),
      pair('e', 'f', 50, 'medium'),
    ]
    const { container } = render(<PairList pairs={pairs} risk_model={null} />);
    const rows = container.querySelectorAll('[data-testid="pair-card"], [data-testid="quiet-row"]');
    // First data row should be the highest score (90)
    expect(rows[0].textContent).toContain('90');
    expect(rows[1].textContent).toContain('50');
    expect(rows[2].textContent).toContain('10');
  });

  it('shows the published risk as "Risk N / 100" plus the level word', () => {
    const pairs = [pair('a', 'b', 80, 'high')];
    render(<PairList pairs={pairs} risk_model={null} />);
    expect(screen.getByText('Risk 80 / 100')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows git_score and model_score side by side', () => {
    const pairs = [
      pair('a', 'b', 60, 'medium', {
        score_source: 'model',
        git_score: 40,
        model_score: 80,
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(screen.getByTestId('git-score')).toHaveTextContent('40');
    expect(screen.getByTestId('model-score')).toHaveTextContent('80');
  });

  it('shows a Nemotron source badge for model-sourced pairs', () => {
    const pairs = [
      pair('a', 'b', 60, 'medium', {
        score_source: 'model',
        git_score: 40,
        model_score: 80,
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(screen.getByText('Nemotron')).toBeInTheDocument();
  });

  it('shows "Git fallback · <reason>" when the git score was kept', () => {
    const pairs = [
      pair('a', 'b', 30, 'low', {
        score_source: 'git',
        git_score: 30,
        model_score: null,
        fallback_reason: 'no_api_key',
      }),
    ];
    render(<PairList pairs={pairs} risk_model={null} />);
    // The badge text is split across elements ("Git fallback" + " · no_api_key"),
    // so match the combined text of the badge.
    expect(screen.getByTestId('source-badge').textContent).toBe('Git fallback · no_api_key');
  });

  it('shows a plain "Git fallback" badge without a reason', () => {
    const pairs = [pair('a', 'b', 30, 'low')];
    render(<PairList pairs={pairs} risk_model={null} />);
    expect(screen.getByText('Git fallback')).toBeInTheDocument();
  });

  it('shows the floor chip and two-line rationale when the floor rule applies', () => {
    const pairs = [
      pair('a', 'b', 80, 'high', {
        score_source: 'model',
        git_score: 80,
        model_score: 10,
        model_level: 'low',
        overlapping_files: 2,
        collisions: [
          {
            path: 'checkout.py',
            overlapping: true,
            branch_a_hunks: [[10, 12]],
            branch_b_hunks: [[40, 42]],
          },
          {
            path: 'pricing.py',
            overlapping: true,
            branch_a_hunks: [[5, 6]],
            branch_b_hunks: [[8, 9]],
          },
        ],
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.getByText('Floor rule: 2 shared files')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nemotron: no conflict expected (10/100).')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Floor rule: both branches touch checkout.py, pricing.py, so kept High.'
      )
    ).toBeInTheDocument();
  });

  it('uses "N files" in the floor rationale when no overlapping paths are listed', () => {
    const pairs = [
      pair('a', 'b', 80, 'high', {
        score_source: 'model',
        git_score: 80,
        model_score: 60,
        model_level: 'medium',
        overlapping_files: 3,
        collisions: [],
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.getByText('Floor rule: 3 shared files')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nemotron: medium risk (60/100).')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Floor rule: both branches touch 3 files, so kept High.')
    ).toBeInTheDocument();
  });

  it('shows the hidden conflict chip when the model level exceeds the git level', () => {
    const pairs = [
      pair('a', 'b', 45, 'medium', {
        score_source: 'model',
        git_score: 10,
        model_score: 80,
        model_level: 'high',
        model_rationale: 'Discount cap and tax order clash semantically.',
      }),
    ];
    const { container } = render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.getByText('Nemotron flags hidden conflict')
    ).toBeInTheDocument();
    // The full model rationale is shown.
    expect(
      screen.getByText('Discount cap and tax order clash semantically.')
    ).toBeInTheDocument();
    // The row is visually highlighted.
    const row = container.querySelector('[data-testid="pair-card"]');
    expect(row!.classList.contains('pair-hidden-conflict')).toBe(true);
  });

  it('shows static call-site breaks and flags unsupported rationale claims', () => {
    const pairs = [
      pair('a', 'b', 80, 'high', {
        score_source: 'model',
        model_score: 80,
        model_level: 'high',
        static_breaks: ['f: call site use.py:3 on b does not pass new required x'],
        unsupported_claims: ['g() now needs y.'],
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.getByText('Static check: f: call site use.py:3 on b does not pass new required x')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Not supported by the static checks: g() now needs y.')
    ).toBeInTheDocument();
  });

  it('does not show the hidden conflict chip when the model level does not exceed git', () => {
    const pairs = [
      pair('a', 'b', 50, 'medium', {
        score_source: 'model',
        git_score: 50,
        model_score: 50,
        model_level: 'medium',
      }),
    ];
    render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.queryByText('Nemotron flags hidden conflict')
    ).not.toBeInTheDocument();
  });

  it('does not flag a none -> low pair as a hidden conflict', () => {
    const pairs = [
      pair('docs/readme', 'feat/tax-before-discount', 5, 'low', {
        score_source: 'model',
        git_score: 0,
        model_score: 10,
        model_level: 'low',
        model_rationale: 'No conflicts expected.',
      }),
    ];
    const { container } = render(<PairList pairs={pairs} risk_model="nemotron" />);
    expect(
      screen.queryByText('Nemotron flags hidden conflict')
    ).not.toBeInTheDocument();
    // Nothing to act on: a quiet row, not a highlighted card.
    expect(container.querySelector('.pair-hidden-conflict')).toBeNull();
    expect(screen.getByTestId('quiet-row')).toBeInTheDocument();
  });

  it('shows an empty state when there are no pairs', () => {
    const { container } = render(<PairList pairs={[]} risk_model={null} />);
    expect(screen.getByText(/no branch pairs/i)).toBeInTheDocument();
    // No table rows should be rendered in the empty state.
    expect(container.querySelectorAll('[data-testid="pair-card"], [data-testid="quiet-row"]')).toHaveLength(0);
  });

  it('gives attention pairs a full card and low-risk pairs a quiet row', () => {
    const pairs = [
      pair('feat/a', 'feat/b', 80, 'high', { rationale: 'Both rewrite the cap.' }),
      pair('docs/x', 'feat/a', 0, 'none', { rationale: 'No shared files.' }),
    ];
    render(<PairList pairs={pairs} risk_model={null} />);
    expect(screen.getAllByTestId('pair-card')).toHaveLength(1);
    expect(screen.getAllByTestId('quiet-row')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'The pair that needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Low-risk pairs/ })).toBeInTheDocument();
  });

  it('renders Tavily docs sources when present and skips non-http urls', () => {
    const pairs = [
      pair('feat/a', 'feat/b', 80, 'high', {
        docs_sources: [
          { title: 'Decimal docs', url: 'https://docs.python.org/3/library/decimal.html', query: 'decimal rounding' },
          { title: 'Bad', url: 'javascript:alert(1)', query: 'bad' },
        ],
      }),
    ];
    render(<PairList pairs={pairs} risk_model={null} />);
    expect(screen.getByRole('link', { name: 'Decimal docs' })).toHaveAttribute(
      'href',
      'https://docs.python.org/3/library/decimal.html'
    );
    expect(screen.queryByText('Bad')).toBeNull();
  });
});
