import type { AnalyzeResponse, PairRisk, RiskLevel } from '../types';
import {
  effectivePairLevel,
  isConfirmedByBranchTest,
  isConfirmedByIntentTest,
  isConfirmedByTest,
  levelRank,
} from './risk';

export type VerdictTone = 'proven' | 'risky' | 'clear' | 'empty';

export interface Verdict {
  tone: VerdictTone;
  /** Effective worst level across pairs, for the colour of the verdict. */
  level: RiskLevel;
  headline: string;
  detail: string;
}

const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;

/** Tests that pass on their own branch and fail on the A+B merge. */
export const failingTestCount = (pair: PairRisk): number =>
  (isConfirmedByBranchTest(pair) ? pair.branch_tests?.confirming.length ?? 0 : 0) +
  (isConfirmedByIntentTest(pair) ? pair.verification?.confirming_tests?.length ?? 0 : 0);

/**
 * A pair git merges cleanly: no overlapping hunks and no textual merge
 * conflict when the tests merged it. A proven conflict here is invisible to
 * git, which is the case MergeGuard exists for.
 */
export const mergesCleanly = (pair: PairRisk): boolean =>
  pair.overlapping_files === 0 &&
  !pair.branch_tests?.merge_conflict &&
  !pair.verification?.merge_conflict;

/** Pairs that need a human look: proven by a test, or effective level medium+. */
export const needsAttention = (pair: PairRisk): boolean =>
  isConfirmedByTest(pair) || levelRank(effectivePairLevel(pair)) >= levelRank('medium');

const worst = (pairs: PairRisk[]): RiskLevel =>
  pairs.reduce<RiskLevel>((acc, pair) => {
    const level = effectivePairLevel(pair);
    return levelRank(level) > levelRank(acc) ? level : acc;
  }, 'none');

/** One-glance verdict for the results: what was found and how sure we are. */
export const verdictFor = (pairs: PairRisk[]): Verdict => {
  const total = pairs.length;
  if (total === 0) {
    return {
      tone: 'empty',
      level: 'none',
      headline: 'No branch pairs to compare',
      detail: 'MergeGuard needs at least two branches besides the base branch.',
    };
  }

  const proven = pairs.filter((pair) => isConfirmedByTest(pair));
  if (proven.length > 0) {
    const allHidden = proven.every(mergesCleanly);
    const headline = `${plural(proven.length, allHidden ? 'hidden conflict' : 'conflict')} proven by tests`;
    let detail: string;
    if (proven.length === 1) {
      const [pair] = proven;
      const failing = failingTestCount(pair);
      const tests = failing > 0 ? plural(failing, 'test') : 'Tests';
      const fail = failing === 1 ? 'fails' : 'fail';
      detail = mergesCleanly(pair)
        ? `${pair.branch_a} and ${pair.branch_b} merge without a git conflict, but ${tests} ${fail} on the merged code.`
        : `${tests} ${fail} when ${pair.branch_a} and ${pair.branch_b} are merged.`;
    } else {
      detail = `Each of these pairs has tests that pass on their own branch and fail after the merge. Checked ${plural(total, 'branch pair')}.`;
    }
    return { tone: 'proven', level: 'high', headline, detail };
  }

  const risky = pairs.filter(needsAttention);
  if (risky.length > 0) {
    return {
      tone: 'risky',
      level: worst(pairs),
      headline: `${plural(risky.length, 'risky pair')} to review before merging`,
      detail: `Flagged by the diff or by Nemotron, but no test failed on the merged code. Checked ${plural(total, 'branch pair')}.`,
    };
  }

  return {
    tone: 'clear',
    level: worst(pairs),
    headline: 'No conflicts found',
    detail: `All ${plural(total, 'branch pair')} look safe to merge in any order.`,
  };
};

/** Short facts for the finished pipeline, one per step. */
export const pipelineFacts = (response: AnalyzeResponse): [string, string, string] => {
  const { pairs, usage } = response;
  const branches = response.branches.length;
  const diffed = `Diffed ${plural(branches, 'branch', 'branches')} against ${response.base_branch} and scored ${plural(pairs.length, 'pair')}.`;

  const sent = usage?.pairs_sent_to_model ?? pairs.filter((p) => p.score_source === 'model').length;
  const skipped = usage?.pairs_prefiltered ?? pairs.filter((p) => p.fallback_reason === 'prefiltered').length;
  let explained =
    sent > 0
      ? `Reviewed ${plural(sent, 'pair')} that share code`
      : 'No pair shared enough code to need Nemotron';
  if (sent > 0 && skipped > 0) explained += `; skipped ${skipped} with nothing in common`;
  if (usage && usage.cache_hits > 0 && usage.llm_calls === 0) explained += ' (cached answers)';
  explained += '.';

  const tested = pairs.filter((p) => p.branch_tests || p.verification).length;
  const proven = pairs.filter((p) => isConfirmedByTest(p)).length;
  const proved =
    tested === 0
      ? 'No pair was risky enough to test.'
      : `Tested ${plural(tested, 'pair')} on the merged code: ${proven > 0 ? `${proven} proven` : 'none failed'}.`;

  return [diffed, explained, proved];
};
