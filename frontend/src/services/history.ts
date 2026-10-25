import type { AnalyzeRequest, AnalyzeResponse } from '../types';

export interface SavedRun {
  id: string;
  createdAt: string;
  repo: string;
  base: string;
  source: Pick<AnalyzeRequest, 'repo_path' | 'repo_url'>;
  result: AnalyzeResponse;
}
const KEY = 'mergeguard.runs.v1';
export function readHistory(): SavedRun[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is SavedRun => r && typeof r.id === 'string' &&
      typeof r.repo === 'string' && typeof r.base === 'string' && typeof r.createdAt === 'string' &&
      r.source && r.result && Array.isArray(r.result.pairs) && Array.isArray(r.result.branches)).slice(0, 12);
  } catch { return []; }
}
export function storeHistory(runs: SavedRun[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(runs.slice(0, 12))); return true; }
  catch { return false; }
}
