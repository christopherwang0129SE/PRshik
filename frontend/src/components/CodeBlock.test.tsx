import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CodeBlock } from './CodeBlock';
import { ProofTable } from './ProofTable';
import { DocsSources } from './DocsSources';

describe('CodeBlock', () => {
  it('is a named, focusable region so long lines scroll inside it', () => {
    render(<CodeBlock code={'a = 1\n'} label="Generated test code" />);
    const region = screen.getByRole('region', { name: 'Generated test code' });
    expect(region.tagName).toBe('PRE');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('keeps the code text exact, line numbers come from CSS', () => {
    const code = 'import x\n\ndef test():\n    assert x == 1\n';
    const { container } = render(<CodeBlock code={code} label="c" numbered />);
    expect(container.querySelector('code')?.textContent).toBe(code);
    expect(container.querySelector('pre')).toHaveAttribute('data-numbered', 'true');
    expect(container.querySelectorAll('.code-line')).toHaveLength(4);
  });

  it('marks the given lines', () => {
    const { container } = render(<CodeBlock code={'a\nb\nc'} label="c" marked={[2]} />);
    const lines = container.querySelectorAll('.code-line');
    expect([...lines].map((l) => l.hasAttribute('data-marked'))).toEqual([false, true, false]);
  });

  it('marks pytest failure lines when asked', () => {
    const { container } = render(
      <CodeBlock code={'    x = 1\n>   assert x == 2\nE   assert 1 == 2\nt.py:2: AssertionError'} label="c" markFailures />
    );
    const marked = [...container.querySelectorAll('.code-line')].map((l) => l.hasAttribute('data-marked'));
    expect(marked).toEqual([false, true, true, false]);
  });
});

describe('ProofTable', () => {
  const run = (target: string, ref: string, passed: number, failed: number, extra = {}) => ({
    target, ref, passed, failed, errors: 0, timed_out: false, ...extra,
  });

  it('shows A, B and the merge with their outcome, nothing else', () => {
    render(
      <ProofTable
        runs={[run('base', 'merge-base', 0, 2), run('a', 'feat/a', 3, 0), run('b', 'feat/b', 2, 0), run('merge', 'a+b', 3, 2)]}
      />
    );
    const rows = within(screen.getByRole('table', { name: 'Test results per checkout' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['Afeat/a3 passed', 'Bfeat/b2 passed', 'A+Bmerged2 failed, 3 passed']);
    expect(rows.map((r) => r.getAttribute('data-outcome'))).toEqual(['pass', 'pass', 'fail']);
  });

  it('reports a timeout and an empty run honestly', () => {
    render(<ProofTable runs={[run('a', 'feat/a', 0, 0), run('merge', 'a+b', 0, 0, { timed_out: true })]} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('no tests ran');
    expect(rows[0]).toHaveAttribute('data-outcome', 'none');
    expect(rows[1]).toHaveTextContent('timed out');
    expect(rows[1]).toHaveAttribute('data-outcome', 'fail');
  });

  it('renders nothing without proof runs', () => {
    const { container } = render(<ProofTable runs={[run('base', 'merge-base', 1, 0)]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DocsSources', () => {
  it('shows title, host and query for each source', () => {
    render(
      <DocsSources
        sources={[
          { title: 'Validators | Pydantic Docs', url: 'https://docs.pydantic.dev/latest/concepts/validators', query: 'pydantic field_validator' },
        ]}
      />
    );
    const block = screen.getByTestId('docs-sources');
    expect(within(block).getByRole('link', { name: 'Validators | Pydantic Docs' })).toBeInTheDocument();
    expect(block).toHaveTextContent('docs.pydantic.dev');
    expect(within(block).getByText('pydantic field_validator')).toBeInTheDocument();
  });

  it('falls back to the host when a source has no title', () => {
    render(<DocsSources sources={[{ title: '', url: 'https://www.example.com/x', query: '' }]} />);
    expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
    expect(screen.queryByText('Query')).toBeNull();
  });

  it('renders nothing when no source is a safe link', () => {
    const { container } = render(<DocsSources sources={[{ title: 'x', url: 'javascript:alert(1)', query: 'q' }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
