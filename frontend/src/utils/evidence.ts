import type { DocSource } from '../types';

/** How many hunk ranges a collision row lists before "+N more". */
export const MAX_HUNKS = 6;

/** "3-5, 13-16, 17" from [[3, 5], [13, 16], [17, 17]], capped at MAX_HUNKS. */
export const formatHunks = (hunks: Array<[number, number]>): string => {
  const shown = hunks
    .slice(0, MAX_HUNKS)
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(', ');
  const rest = hunks.length - MAX_HUNKS;
  return rest > 0 ? `${shown} +${rest} more` : shown;
};

/**
 * "total: changed by feat/b (checkout.py), called by feat/a (tests/x.py)"
 * split into the symbol and the sentence about it.
 */
export const splitSymbolEvidence = (line: string): { symbol: string; detail: string } => {
  const match = /^([\w.]+):\s+(.*)$/.exec(line);
  return match ? { symbol: match[1], detail: match[2] } : { symbol: '', detail: line };
};

export interface FailureExcerpt {
  test: string;
  lines: string[];
}

const HEADER = /^_{3,}\s+(\S.*?)\s+_{3,}$/;
const KEEP = /^(>|E\s)|^\S+\.py:\d+:\s/;

/**
 * The lines that show why each test failed in pytest output: the `>` source
 * line, the `E` assertion lines and the `file.py:18: AssertionError`
 * location. Tests are listed in output order; one with no such lines is
 * dropped.
 */
export const failureExcerpts = (output: string | null | undefined): FailureExcerpt[] => {
  const excerpts: FailureExcerpt[] = [];
  let current: FailureExcerpt | null = null;
  for (const line of (output ?? '').split('\n')) {
    const header = HEADER.exec(line.trim());
    if (header) {
      current = { test: header[1], lines: [] };
      excerpts.push(current);
    } else if (/^={3,}/.test(line)) {
      current = null;
    } else if (current && KEEP.test(line)) {
      current.lines.push(line.trimEnd());
    }
  }
  return excerpts.filter((excerpt) => excerpt.lines.length > 0);
};

/** Tavily hits grouped by the search query that found them, in order. */
export const groupByQuery = (sources: DocSource[]): Array<{ query: string; sources: DocSource[] }> => {
  const groups = new Map<string, DocSource[]>();
  for (const source of sources) {
    const query = (source.query ?? '').trim();
    groups.set(query, [...(groups.get(query) ?? []), source]);
  }
  return [...groups].map(([query, list]) => ({ query, sources: list }));
};
