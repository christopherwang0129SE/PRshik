import {
  levelToColor,
  levelToText,
  levelRank,
  isDisagree,
  isHiddenConflict,
  effectivePairLevel,
  isConfirmedByTest,
  isConfirmedByBranchTest,
} from '../utils/risk';
import type { PairRisk, RiskLevel, UsageSummary } from '../types';
import { usageLine } from '../utils/usage';
import { verdictFor, type VerdictTone } from '../utils/verdict';
import type { CSSProperties, Ref } from 'react';

interface SummaryBarProps {
  pairs: PairRisk[];
  usage?: UsageSummary | null;
  /** Receives the verdict heading so the app can move focus to it. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * Worst effective level across all pairs: the published level, raised to the
 * model's level for hidden conflicts (the model flagged a medium/high
 * semantic clash the git heuristic missed).
 */
const worstLevel = (pairs: PairRisk[]): RiskLevel =>
  pairs.reduce<RiskLevel>(
    (worst, pair) =>
      levelRank(effectivePairLevel(pair)) > levelRank(worst)
        ? effectivePairLevel(pair)
        : worst,
    'none'
  );

/**
 * Pairs where Nemotron disagrees with git: the published score came from
 * the model, the levels differ, and at least one side is medium or high
 * (a none <-> low move is not a disagreement).
 */
const disagreeCount = (pairs: PairRisk[]): number =>
  pairs.filter((pair) => isDisagree(pair)).length;

/**
 * Pairs where the model was actually used (published score from the model).
 */
const modelUsedCount = (pairs: PairRisk[]): number =>
  pairs.filter((pair) => pair.score_source === 'model').length;

const KICKER: Record<VerdictTone, string> = {
  proven: 'Verdict: proven',
  risky: 'Verdict: needs review',
  clear: 'Verdict: clear',
  empty: 'Verdict',
};

/**
 * The verdict for one analysis: a headline saying what was found and how it
 * is known, then the counts and the LLM usage in smaller print.
 */
export const SummaryBar = ({ pairs, usage, headingRef }: SummaryBarProps) => {
  const total = pairs.length;
  const worst = worstLevel(pairs);
  const hidden = pairs.filter((pair) => isHiddenConflict(pair)).length;
  const confirmed = pairs.filter((pair) => isConfirmedByTest(pair)).length;
  const byBranchTest = pairs.filter((pair) => isConfirmedByBranchTest(pair)).length;
  // Pairs whose effective level is medium or high: shown medium/high pairs
  // plus hidden conflicts.
  const risky = pairs.filter(
    (pair) =>
      levelRank(effectivePairLevel(pair)) >= levelRank('medium')
  ).length;
  // Pairs sitting at the worst effective level, e.g. "1 of 3 branch pairs at
  // medium risk" when one of three pairs is medium (the worst).
  const atWorst = pairs.filter(
    (pair) => effectivePairLevel(pair) === worst
  ).length;
  const disagree = disagreeCount(pairs);
  const modelUsed = modelUsedCount(pairs);

  let line1: string;
  if (risky === 0) {
    line1 = `No risky pairs among ${total}`;
  } else if (hidden > 0 && !pairs.some((pair) => pair.level === 'medium' || pair.level === 'high')) {
    // Only hidden conflicts, nothing published medium/high.
    line1 = `${hidden} hidden conflict${hidden === 1 ? '' : 's'} among ${total} pairs`;
  } else {
    const branchPart = byBranchTest > 0 ? ` (${byBranchTest} by branch test)` : '';
    const confirmedPart = confirmed > 0 ? ` · ${confirmed} confirmed by test${branchPart}` : '';
    const hiddenPart = hidden > 0 ? ` · ${hidden} hidden` : '';
    const suffix = `${confirmedPart}${hiddenPart}`;
    line1 = `${atWorst} of ${total} branch pairs at ${levelToText(worst).toLowerCase()} risk${suffix}`;
  }

  let line2: string;
  if (modelUsed === 0 && total > 0 && pairs.every((pair) => pair.fallback_reason === 'prefiltered')) {
    line2 = 'No pair needed Nemotron: static prefilter found no overlap';
  } else if (modelUsed === 0) {
    line2 = 'Git only: Nemotron unavailable';
  } else if (disagree > 0) {
    line2 = `Nemotron disagrees on ${disagree} pair(s)`;
  } else {
    line2 = 'Nemotron agrees with git on all pairs';
  }

  const verdict = verdictFor(pairs);

  return (
    <section
      className="summary-bar"
      data-tone={verdict.tone}
      style={{ '--verdict-color': levelToColor(verdict.tone === 'empty' ? worst : verdict.level) } as CSSProperties}
      aria-labelledby="verdict-heading"
      data-testid="summary-bar"
    >
      <p className="verdict-kicker">{KICKER[verdict.tone]}</p>
      <h2 id="verdict-heading" className="verdict-headline" ref={headingRef} tabIndex={-1}>
        {verdict.headline}
      </h2>
      <p className="verdict-detail">{verdict.detail}</p>
      <div className="summary-meta">
        <p className="summary-line1">{line1}</p>
        <p className="summary-line2">{line2}</p>
        {usage && (
          <p className="summary-usage" data-testid="summary-usage">
            {usageLine(usage)}
          </p>
        )}
      </div>
    </section>
  );
};
