import { describe, it, expect } from 'vitest';
import { failureExcerpts, formatHunks, groupByQuery, splitSymbolEvidence, MAX_HUNKS } from './evidence';

const PYTEST = `FF                                                                       [100%]
=================================== FAILURES ===================================
___________ test_branch_a_total ___________

    def test_branch_a_total():
        dollars = client.normalize_amount(10000)
>       assert client.invoice_total(dollars, 2, 10.0) == 220.0
E       assert 2.2 == 220.0
E        +  where 2.2 = <function invoice_total>(100.0, 2, 10.0)

test_mergeguard_intent.py:18: AssertionError
___________ test_branch_b_total ___________

    def test_branch_b_total():
>       assert client.invoice_total(1, 2, 10.0) == 220.0
E       assert 0.022 == 220.0

test_mergeguard_intent.py:35: AssertionError
=========================== short test summary info ============================
FAILED test_mergeguard_intent.py::test_branch_a_total
2 failed in 0.14s`;

describe('formatHunks', () => {
  it('joins ranges and collapses one-line hunks', () => {
    expect(formatHunks([[3, 5], [13, 16], [17, 17]])).toBe('3-5, 13-16, 17');
  });

  it('caps the list and counts the rest', () => {
    const many = Array.from({ length: MAX_HUNKS + 5 }, (_, i) => [i * 10, i * 10 + 1] as [number, number]);
    expect(formatHunks(many)).toMatch(/ \+5 more$/);
    expect(formatHunks(many).split(', ')).toHaveLength(MAX_HUNKS);
  });

  it('is empty for no hunks', () => {
    expect(formatHunks([])).toBe('');
  });
});

describe('splitSymbolEvidence', () => {
  it('splits the symbol from the sentence', () => {
    expect(splitSymbolEvidence('total: changed by feat/b (checkout.py), called by feat/a (t.py)')).toEqual({
      symbol: 'total',
      detail: 'changed by feat/b (checkout.py), called by feat/a (t.py)',
    });
  });

  it('keeps dotted names and leaves unrecognised lines whole', () => {
    expect(splitSymbolEvidence('Client.get: changed by a').symbol).toBe('Client.get');
    expect(splitSymbolEvidence('no colon here')).toEqual({ symbol: '', detail: 'no colon here' });
  });
});

describe('failureExcerpts', () => {
  it('keeps the source, E and location lines per failing test', () => {
    const excerpts = failureExcerpts(PYTEST);
    expect(excerpts.map((e) => e.test)).toEqual(['test_branch_a_total', 'test_branch_b_total']);
    expect(excerpts[0].lines).toEqual([
      '>       assert client.invoice_total(dollars, 2, 10.0) == 220.0',
      'E       assert 2.2 == 220.0',
      'E        +  where 2.2 = <function invoice_total>(100.0, 2, 10.0)',
      'test_mergeguard_intent.py:18: AssertionError',
    ]);
    expect(excerpts[1].lines).toHaveLength(3);
  });

  it('ignores the summary section after the failures', () => {
    const lines = failureExcerpts(PYTEST).flatMap((e) => e.lines);
    expect(lines.some((line) => line.startsWith('FAILED'))).toBe(false);
  });

  it('returns nothing for empty or passing output', () => {
    expect(failureExcerpts(undefined)).toEqual([]);
    expect(failureExcerpts('.. [100%]\n2 passed in 0.1s')).toEqual([]);
  });
});

describe('groupByQuery', () => {
  it('groups sources under their query in first-seen order', () => {
    const groups = groupByQuery([
      { title: 'A', url: 'https://a', query: 'requests' },
      { title: 'B', url: 'https://b', query: 'pydantic' },
      { title: 'C', url: 'https://c', query: 'requests' },
    ]);
    expect(groups.map((g) => [g.query, g.sources.map((s) => s.title)])).toEqual([
      ['requests', ['A', 'C']],
      ['pydantic', ['B']],
    ]);
  });
});
