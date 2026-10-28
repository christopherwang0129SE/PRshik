import type { PairRisk } from '../types';
import { keptRuns } from './verification';

export type ProofTarget = 'a' | 'b' | 'merge' | 'base';
export type ProofOutcome = 'pass' | 'fail';

/** The run fields shared by generated intent tests and existing branch tests. */
export interface ProofRun {
  target: string;
  exit_code: number | null;
  passed: number;
  failed: number;
  errors: number;
  timed_out: boolean;
}

export interface ProofComparison {
  actual: string;
  expected: string;
}

export interface PairProof {
  assertion: string | null;
  proof: string | null;
  comparison: ProofComparison | null;
  runs: ProofRun[];
  outcomes: Record<ProofTarget, ProofOutcome | null>;
  branchesPass: boolean;
  /** A and B pass independently, while the combined code fails. */
  semanticConflict: boolean;
  /** A and B pass, so a base failure is the expected pre-change baseline. */
  baseExpected: boolean;
}

const usableRuns = (pair: PairRisk): ProofRun[] => {
  const runs: ProofRun[] = pair.verification
    ? keptRuns(pair.verification)
    : (pair.branch_tests?.runs ?? []);
  return runs.filter(
    (run) =>
      !run.timed_out &&
      run.exit_code !== null &&
      run.errors === 0 &&
      run.passed + run.failed > 0 &&
      (run.failed > 0 || run.exit_code === 0)
  );
};

/**
 * The proof shown in both the run summary and pair detail. Keeping the run
 * filtering and assertion parsing here prevents the two views from telling
 * different stories about the same pair.
 */
export const pairProof = (pair: PairRisk): PairProof => {
  const branchFailure = pair.branch_tests?.confirming[0];
  const mergeRun = pair.verification?.runs.find(
    (run) => run.target === 'merge' && (run.failed > 0 || run.errors > 0)
  );
  const output = mergeRun?.output || branchFailure?.excerpt;
  const lines = output?.split('\n') ?? [];
  const failureLine =
    lines.find((line) => /AssertionError:.* != /.test(line)) ??
    lines.find((line) => /^E\s+assert\s/.test(line.trim())) ??
    lines.find((line) => /assert\s|AssertionError|Expected:|expected .* (?:to|but)/i.test(line));
  const assertion =
    (failureLine?.replace(/^(?:E\s+|>\s*)?\s*/, '').slice(0, 240) ?? output?.trim().slice(0, 240)) || null;

  const runs = usableRuns(pair);
  const outcome = (target: ProofTarget): ProofOutcome | null => {
    const run = runs.find((candidate) => candidate.target === target);
    return run ? (run.failed > 0 ? 'fail' : 'pass') : null;
  };
  const outcomes: Record<ProofTarget, ProofOutcome | null> = {
    a: outcome('a'),
    b: outcome('b'),
    merge: outcome('merge'),
    base: outcome('base'),
  };
  const branchesPass = outcomes.a === 'pass' && outcomes.b === 'pass';

  const literal = String.raw`(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|'(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*")`;
  const comparisonMatch =
    assertion?.match(/^(?:AssertionError:\s*|assert\s+)?(.+?)\s+!=\s+(.+)$/) ??
    assertion?.match(new RegExp(`^assert\\s+(${literal})\\s+==\\s+(${literal})\\s*$`));
  const comparison =
    comparisonMatch && comparisonMatch[1] !== undefined && comparisonMatch[2] !== undefined
      ? { actual: comparisonMatch[1], expected: comparisonMatch[2] }
      : null;

  return {
    assertion,
    proof: assertion ?? pair.static_breaks?.[0] ?? null,
    comparison,
    runs,
    outcomes,
    branchesPass,
    semanticConflict: branchesPass && outcomes.merge === 'fail',
    baseExpected: branchesPass && outcomes.base === 'fail',
  };
};
