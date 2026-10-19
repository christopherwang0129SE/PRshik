import type { Verification } from '../types';

/**
 * Per-checkout outcome of the confirming tests only. Generated tests that
 * failed on their own branch were discarded, so counting them would show a
 * misleading failure on a branch. Empty when the runs carry no per-case data.
 */
export const confirmingRuns = (verification: Verification) => {
  const names = verification.confirming_tests ?? [];
  if (names.length === 0) return [];
  return verification.runs.flatMap((run) => {
    if (!run.cases || (run.target !== 'a' && run.target !== 'b' && run.target !== 'merge')) return [];
    const statuses = names.map((name) => run.cases?.[name]).filter((s): s is string => Boolean(s));
    if (statuses.length === 0) return [];
    const passed = statuses.filter((s) => s === 'passed').length;
    return [{ ...run, passed, failed: statuses.length - passed, errors: 0 }];
  });
};
