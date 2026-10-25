import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHistory, storeHistory } from './history';
import type { SavedRun } from './history';
const saved: SavedRun = { id: '1', repo: '/demo', base: 'main', source: { repo_path: '/demo' },
  createdAt: '2026-10-25T12:00:00Z', result: { base_branch: 'main', branches: ['a'], diffs: [], pairs: [] } };
beforeEach(() => localStorage.clear());
describe('run history', () => {
  it('restores completed results and limits retained runs', () => {
    expect(storeHistory(Array.from({ length: 20 }, (_, i) => ({ ...saved, id: String(i) })))).toBe(true);
    expect(readHistory()).toHaveLength(12);
    expect(readHistory()[0].result).toEqual(saved.result);
    storeHistory([]);
    expect(readHistory()).toEqual([]);
  });
  it('reports unavailable browser storage without throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(storeHistory([saved])).toBe(false);
    spy.mockRestore();
  });
  it('ignores malformed and incompatible storage', () => {
    for (const text of ['broken', '{}', '[null, {"id":"a"}]']) {
      localStorage.setItem('mergeguard.runs.v1', text);
      expect(readHistory()).toEqual([]);
    }
  });
});
