import type { PairDiffResponse } from '../types';

// Reuse pair diffs within a run; App clears them when starting or restoring a run.
export const pairDiffCache = new Map<string, PairDiffResponse>();

/** Forget branch-head-dependent diffs before another analysis. */
export const clearPairDiffCache = () => pairDiffCache.clear();
