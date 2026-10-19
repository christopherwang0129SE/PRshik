import type { DocSource } from '../types';

/** How many Tavily sources a pair card lists. */
export const MAX_DOCS = 3;

const httpUrl = (raw: unknown): URL | null => {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/** Safe http(s) sources, one per URL, malformed entries dropped. */
export const usableDocs = (sources: DocSource[] | null | undefined): DocSource[] => {
  const seen = new Set<string>();
  return (sources ?? []).filter((source) => {
    const url = source ? httpUrl(source.url) : null;
    if (!url || seen.has(url.href)) return false;
    seen.add(url.href);
    return true;
  });
};

/** "requests.readthedocs.io" from a source URL, without a leading www. */
export const hostOf = (raw: string): string => httpUrl(raw)?.hostname.replace(/^www\./, '') ?? '';
