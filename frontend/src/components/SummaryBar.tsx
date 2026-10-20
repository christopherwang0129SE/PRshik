import {
  levelToText,
  levelRank,
  isDisagree,
  isHiddenConflict,
  effectivePairLevel,
  isConfirmedByTest,
} from '../utils/risk';
import type { PairRisk, RiskLevel, UsageSummary } from '../types';
import { formatCost } from '../utils/usage';
import { verdictFor } from '../utils/verdict';
import type { Ref } from 'react';
import { BranchLights } from './BranchLights';

interface SummaryBarProps {
  pairs: PairRisk[];
  usage?: UsageSummary | null;
  /** Receives the verdict heading so the app can move focus to it. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Branch names, for the per-branch risk row. */
  branches?: string[];
  /** One result line per pipeline step: diff, explain, test. */
  facts?: [string, string, string];
  riskModel?: string | null;
}

/**
 * Worst effective level across all pairs: the published level, raised to the
 * model's level for hidden conflicts (the model flagged a medium/high
 * semantic clash the git heuristic missed).
 */
const worstLevel = (pairs: PairRisk[]): RiskLevel =>
  pairs.reduce<RiskLevel>(
    (worst, pair) => (levelRank(effectivePairLevel(pair)) > levelRank(worst) ? effectivePairLevel(pair) : worst),
    'none'
  );

/** Counts line: how many pairs sit at the worst level, and how they are known. */
const countsLine = (pairs: PairRisk[]): string => {
  const total = pairs.length;
  const worst = worstLevel(pairs);
  const hidden = pairs.filter((pair) => isHiddenConflict(pair)).length;
  const confirmed = pairs.filter((pair) => isConfirmedByTest(pair)).length;
  const risky = pairs.filter((pair) => levelRank(effectivePairLevel(pair)) >= levelRank('medium')).length;
  const atWorst = pairs.filter((pair) => effectivePairLevel(pair) === worst).length;

  if (risky === 0) return `No risky pairs among ${total}`;
  if (hidden > 0 && !pairs.some((pair) => pair.level === 'medium' || pair.level === 'high')) {
    // Only hidden conflicts, nothing published medium/high.
    return `${hidden} hidden conflict${hidden === 1 ? '' : 's'} among ${total} pairs`;
  }
  const confirmedPart = confirmed > 0 ? `, ${confirmed} confirmed by test` : '';
  const hiddenPart = hidden > 0 ? `, ${hidden} hidden` : '';
  return `${atWorst} of ${total} branch pairs at ${levelToText(worst).toLowerCase()} risk${confirmedPart}${hiddenPart}`;
};

/** Does Nemotron agree with git? A none <-> low move is not a disagreement. */
const agreementLine = (pairs: PairRisk[]): string => {
  const modelUsed = pairs.filter((pair) => pair.score_source === 'model').length;
  const disagree = pairs.filter((pair) => isDisagree(pair)).length;
  if (modelUsed === 0 && pairs.length > 0 && pairs.every((pair) => pair.fallback_reason === 'prefiltered')) {
    return 'No pair needed Nemotron: static prefilter found no overlap';
  }
  if (modelUsed === 0) return 'Git only: Nemotron unavailable';
  if (disagree > 0) return `Nemotron disagrees with git on ${disagree} pair${disagree === 1 ? '' : 's'}`;
  return 'Nemotron agrees with git on all pairs';
};

/** LLM usage as labelled numbers rather than one dotted chain. */
const Usage = ({ usage }: { usage: UsageSummary }) => {
  const items: Array<[string, string]> = [
    ['LLM calls', String(usage.llm_calls)],
    ['Tokens', usage.total_tokens.toLocaleString('en-US')],
    ['Cost', `${formatCost(usage.estimated_cost_usd)} est.`],
  ];
  if (usage.cache_hits > 0) items.push(['Cached', String(usage.cache_hits)]);
  if (usage.pairs_prefiltered > 0) items.push(['Filtered before LLM', String(usage.pairs_prefiltered)]);
  if (usage.elapsed_s > 0) items.push(['Time', `${usage.elapsed_s.toFixed(1)}s`]);
  return (
    <dl className="kv">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

/**
 * The verdict for one analysis: one plain line saying what was found, the
 * sentence behind it, then the run facts as a compact key/value list.
 */
export const SummaryBar = ({ pairs, usage, headingRef, branches, facts, riskModel }: SummaryBarProps) => {
  const verdict = verdictFor(pairs);
  const level = verdict.tone === 'empty' ? worstLevel(pairs) : verdict.level;

  return (
    <section
      className="verdict"
      data-tone={verdict.tone}
      data-level={level}
      aria-labelledby="verdict-heading"
      data-testid="summary-bar"
    >
      <div className="verdict-line">
        <span className="verdict-mark" aria-hidden="true"></span>
        <h2 id="verdict-heading" ref={headingRef} tabIndex={-1}>
          {verdict.headline}
        </h2>
      </div>
      <p className="verdict-detail">{verdict.detail}</p>
      <dl className="kv-rows">
        {branches && (
          <div>
            <dt>Branches</dt>
            <dd>
              <BranchLights branches={branches} pairs={pairs} />
            </dd>
          </div>
        )}
        <div>
          <dt>Pairs</dt>
          <dd>
            <span>{countsLine(pairs)}</span>
            {facts && <span className="muted">{facts[0]}</span>}
          </dd>
        </div>
        <div>
          <dt>Nemotron</dt>
          <dd>
            <span>{agreementLine(pairs)}</span>
            {facts && <span className="muted">{facts[1]}</span>}
          </dd>
        </div>
        {facts && (
          <div>
            <dt>Tests</dt>
            <dd>{facts[2]}</dd>
          </div>
        )}
        {(usage || riskModel) && (
          <div className="kv-run">
            <dt>Run</dt>
            <dd>
              {riskModel && <span className="mono">{riskModel}</span>}
              {usage && (
                <span data-testid="summary-usage">
                  <Usage usage={usage} />
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
};
