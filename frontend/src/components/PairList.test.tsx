import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PairList } from './PairList'
import type { PairRisk } from '../types'
import { MAX_DOCS } from '../utils/docs'

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
    const { container } = render(<PairList pairs={pairs} />);
    const rows = container.querySelectorAll('[data-testid="pair-card"], [data-testid="quiet-row"]');
    // First data row should be the highest score (90)
    expect(rows[0].textContent).toContain('90');
    expect(rows[1].textContent).toContain('50');
    expect(rows[2].textContent).toContain('10');
  });

  it('shows the published risk as "N/100" plus the level word', () => {
    const pairs = [pair('a', 'b', 80, 'high')];
    render(<PairList pairs={pairs} />);
    const score = screen.getByTestId('pair-score');
    expect(score).toHaveTextContent('80/100, High');
    expect(score).toHaveAttribute('data-level', 'high');
  });

  it('shows git_score and model_score side by side', () => {
    const pairs = [
      pair('a', 'b', 60, 'medium', {
        score_source: 'model',
        git_score: 40,
        model_score: 80,
      }),
    ];
    render(<PairList pairs={pairs} />);
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
    render(<PairList pairs={pairs} />);
    expect(screen.getByText('Score from', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^Nemotron$/);
  });

  it('shows "Git fallback (<reason>)" when the git score was kept', () => {
    const pairs = [
      pair('a', 'b', 30, 'low', {
        score_source: 'git',
        git_score: 30,
        model_score: null,
        fallback_reason: 'no_api_key',
      }),
    ];
    render(<PairList pairs={pairs} />);
    // The label is split across elements ("Git fallback" + " (no_api_key)"),
    // so match the combined text.
    expect(screen.getByTestId('source-badge').textContent).toBe('Git fallback (no_api_key)');
  });

  it('shows a plain "Git fallback" badge without a reason', () => {
    const pairs = [pair('a', 'b', 30, 'low')];
    render(<PairList pairs={pairs} />);
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
    render(<PairList pairs={pairs} />);
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
    render(<PairList pairs={pairs} />);
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
    const { container } = render(<PairList pairs={pairs} />);
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
    render(<PairList pairs={pairs} />);
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
    render(<PairList pairs={pairs} />);
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
    const { container } = render(<PairList pairs={pairs} />);
    expect(
      screen.queryByText('Nemotron flags hidden conflict')
    ).not.toBeInTheDocument();
    // Nothing to act on: a quiet row, not a highlighted card.
    expect(container.querySelector('.pair-hidden-conflict')).toBeNull();
    expect(screen.getByTestId('quiet-row')).toBeInTheDocument();
  });

  it('shows an empty state when there are no pairs', () => {
    const { container } = render(<PairList pairs={[]} />);
    expect(screen.getByText(/no branch pairs/i)).toBeInTheDocument();
    // No table rows should be rendered in the empty state.
    expect(container.querySelectorAll('[data-testid="pair-card"], [data-testid="quiet-row"]')).toHaveLength(0);
  });

  it('gives attention pairs a full card and low-risk pairs a quiet row', () => {
    const pairs = [
      pair('feat/a', 'feat/b', 80, 'high', { rationale: 'Both rewrite the cap.' }),
      pair('docs/x', 'feat/a', 0, 'none', { rationale: 'No shared files.' }),
    ];
    render(<PairList pairs={pairs} />);
    expect(screen.getAllByTestId('pair-card')).toHaveLength(1);
    expect(screen.getAllByTestId('quiet-row')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'The pair that needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Low-risk pairs/ })).toBeInTheDocument();
  });

  it('shows Tavily docs open on the card, grouped by query, safe links only, capped', () => {
    const docs = [
      { title: 'Decimal docs', url: 'https://docs.python.org/3/library/decimal.html', query: 'decimal rounding' },
      { title: 'Bad', url: 'javascript:alert(1)', query: 'bad' },
      { title: 'Two', url: 'https://www.example.com/2', query: 'q' },
      { title: 'Three', url: 'http://example.org/3', query: 'q' },
      { title: 'Four', url: 'https://example.net/4', query: 'q' },
      { title: 'Five', url: 'https://example.net/5', query: 'q' },
      { title: 'Six', url: 'https://example.net/6', query: 'q' },
      { title: 'Seven', url: 'https://example.net/7', query: 'q' },
    ];
    render(<PairList pairs={[pair('feat/a', 'feat/b', 80, 'high', { docs_sources: docs })]} />);
    const block = screen.getByTestId('docs-sources');
    expect(block).toHaveTextContent('Library docs');
    expect(block).toHaveTextContent('found by Tavily');
    expect(block.closest('details')).toBeNull();
    expect(block.closest('[data-testid="pair-card"]')).not.toBeNull();
    const links = within(block).getAllByRole('link');
    expect(links).toHaveLength(MAX_DOCS);
    expect(links[0]).toHaveAttribute('href', 'https://docs.python.org/3/library/decimal.html');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    // Host and the query that found each hit.
    expect(block).toHaveTextContent('docs.python.org');
    expect(block).toHaveTextContent('example.com');
    expect(within(block).getByText('decimal rounding')).toBeInTheDocument();
    expect(within(block).getAllByText('q')).toHaveLength(1);
    expect(screen.queryByText('Bad')).toBeNull();
    expect(screen.queryByText('Seven')).toBeNull();
    expect(screen.getAllByTestId('docs-sources')).toHaveLength(1);
  });

  it('adds intent-test docs to the pair docs without repeating a URL', () => {
    const shared = { title: 'Validators', url: 'https://docs.pydantic.dev/latest/concepts/validators', query: 'pydantic' };
    render(
      <PairList
        pairs={[
          pair('feat/a', 'feat/b', 80, 'high', {
            docs_sources: [shared],
            verification: {
              status: 'skipped', reason: 'r', runs: [], attempts: 0, cached_test: false, merge_conflict: false,
              duration_s: 0, prompt_tokens: 0, completion_tokens: 0,
              docs_sources: [shared, { title: 'Session', url: 'https://requests.readthedocs.io/a', query: 'requests' }],
            },
          }),
        ]}
      />
    );
    const links = within(screen.getByTestId('docs-sources')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Validators', 'Session']);
  });

  it('lists the files and functions both branches touch, with hunk ranges per branch', () => {
    render(
      <PairList
        pairs={[
          pair('feat/a', 'feat/b', 80, 'high', {
            collisions: [
              { path: 'checkout.py', overlapping: false, branch_a_hunks: [[3, 5], [17, 17]], branch_b_hunks: [[24, 29]] },
            ],
            symbol_evidence: ['total: changed by feat/b (checkout.py), called by feat/a (tests/t.py)'],
          }),
        ]}
      />
    );
    const files = screen.getByRole('list', { name: 'Files both branches change' });
    expect(files).toHaveTextContent('checkout.py');
    expect(files).toHaveTextContent('edited in different places');
    expect(files).toHaveTextContent('feat/alines 3-5, 17');
    expect(files).toHaveTextContent('feat/blines 24-29');
    const symbols = screen.getByRole('list', { name: 'Functions both branches touch' });
    expect(within(symbols).getByText('total')).toHaveClass('symbol');
    expect(symbols).toHaveTextContent('changed by feat/b (checkout.py), called by feat/a (tests/t.py)');
  });

  it('keeps a low-risk row collapsed with its score and reason in the summary', () => {
    const { container } = render(
      <PairList pairs={[pair('docs/x', 'feat/a', 0, 'none', { rationale: 'No shared files.' })]} />
    );
    const details = container.querySelector('[data-testid="quiet-row"] details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary')!;
    expect(summary).toHaveTextContent('docs/x');
    expect(summary).toHaveTextContent('feat/a');
    expect(within(summary).getByTestId('pair-score')).toHaveTextContent('0/100, None');
    expect(summary).toHaveTextContent('No shared files.');
  });

  it('shows per-pair token use and the cache flag in the scores', () => {
    render(
      <PairList
        pairs={[pair('a', 'b', 80, 'high', { score_source: 'model', prompt_tokens: 1200, completion_tokens: 300, model_cached: true })]}
      />
    );
    expect(screen.getByText('Tokens', { selector: 'dt' }).nextElementSibling).toHaveTextContent('1,200 in, 300 out (cached)');
  });

  it('renders no docs block when docs_sources is empty or missing', () => {
    render(
      <PairList
        pairs={[
          pair('feat/a', 'feat/b', 80, 'high', { docs_sources: [] }),
          pair('feat/c', 'feat/d', 0, 'none'),
        ]}
       
      />
    );
    expect(screen.queryByTestId('docs-sources')).toBeNull();
    expect(screen.queryByText(/Tavily/)).toBeNull();
  });
});
