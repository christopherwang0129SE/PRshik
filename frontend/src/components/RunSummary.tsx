import type { Ref } from 'react';
import type { AnalyzeResponse } from '../types';
import { formatCost } from '../utils/usage';
import { summaryLine, verdictFor, rankPairs, pairVerdict, mergesCleanly } from '../utils/verdict';
import { usableDocs } from '../utils/docs';
import { pairProof } from '../utils/proof';

interface RunSummaryProps {
  response: AnalyzeResponse;
  /** What was analyzed, as the user typed it. */
  target: string;
  modelOk?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The answer first: one sentence saying how many pairs break and how we
 * know, the evidence sentence under it, then the run's cost in figures.
 */
export const RunSummary = ({ response, target, headingRef, modelOk = false }: RunSummaryProps) => {
  const { pairs, usage } = response;
  const verdict = verdictFor(pairs);
  const top = rankPairs(pairs).find(p => pairVerdict(p) === 'confirmed');
  const reading = top?.score_source === 'model' ? (top.model_rationale ?? top.rationale)?.trim().match(/^.*?[.!?](?=\s|$)|^.+$/)?.[0] : undefined;
  const joinedReading = reading?.replace(/^(The|A|An|This|These|Both|Each)(?=\s)/, word => word[0].toLowerCase() + word.slice(1));
  const model = response.risk_model ?? usage?.model;
  const why = top && reading ? `${top.branch_a} and ${top.branch_b} ${mergesCleanly(top) && (top.branch_tests?.merge_conflict === false || top.verification?.merge_conflict === false) ? 'merge without a git conflict' : 'are merged'} — but ${joinedReading}` : verdict.detail;
  const docs = usableDocs(pairs.flatMap((p) => [...(p.docs_sources ?? []), ...(p.verification?.docs_sources ?? [])]));
  // Only generated verification evidence belongs in this Nemotron proof strip.
  const proof = top?.verification ? pairProof(top) : null;
  const showProof =
    proof !== null && (['a', 'b', 'merge', 'base'] as const).some((target) => proof.outcomes[target] !== null);
  const figures: Array<[string, string]> = [];
  figures.push(['Branches', `${response.branches.length} vs ${response.base_branch}`]);
  if (usage) {
    const cached = usage.llm_calls === 0 && (usage.cached_llm_calls ?? 0) > 0;
    if (usage.llm_calls != null) figures.push(['Nemotron calls', `${cached ? usage.cached_llm_calls : usage.llm_calls}${cached ? ' (cached)' : ''}`]);
    if ((cached ? usage.cached_tokens : usage.total_tokens) != null) figures.push(['Tokens', `${(cached ? usage.cached_tokens! : usage.total_tokens).toLocaleString('en-US')}${cached ? ' (cached)' : ''}`]);
    if ((cached ? usage.cached_cost_usd : usage.estimated_cost_usd) != null) figures.push(['Est. cost', `${formatCost(cached ? usage.cached_cost_usd! : usage.estimated_cost_usd)}${cached ? ' (cached)' : ''}`]);
    if (usage.elapsed_s > 0) figures.push(['Time', `${usage.elapsed_s.toFixed(1)}s`]);
  }
  if (docs.length > 0) figures.push(['Tavily docs', String(docs.length)]);

  return (
    <section className="summary" data-tone={verdict.tone} aria-labelledby="summary-heading" data-testid="run-summary">
      <p className="summary-target">
        <span className="sr-only">Analyzed </span>
        <span className="mono">{target}</span>
      </p>
      <h1 id="summary-heading" className="summary-line" ref={headingRef} tabIndex={-1}>
        {summaryLine(pairs)}
      </h1>
      <p className="summary-detail">{why}</p>
      {modelOk && model ? <p className="model-attribution sponsor-chip">Scoring & intent tests: Nemotron · Nebius Token Factory</p> : !modelOk && <p className="model-attribution">Scores come from git + branch tests.</p>}
      {showProof && proof && (
        <section className="summary-proof" aria-label="Proof from the top confirmed pair">
          <p className="summary-proof-label">Proof — Nemotron&apos;s intent test, 4 states:</p>
          <div className="summary-proof-badges">
            {(['a', 'b', 'merge', 'base'] as const).map((target) => {
              const result = proof.outcomes[target];
              if (!result) return null;
              const expected = target === 'base' && proof.baseExpected;
              return (
                <span
                  key={target}
                  className="summary-proof-badge"
                  data-outcome={result}
                  data-expected={expected ? 'true' : undefined}
                >
                  <span>{{ a: 'A only', b: 'B only', merge: 'A+B merge', base: 'merge-base' }[target]}</span>
                  <strong>{result === 'fail' ? 'FAIL' : 'PASS'}</strong>
                  {expected && <span>(expected)</span>}
                </span>
              );
            })}
          </div>
          {proof.comparison && (
            <p className="summary-proof-money">
              Merged code returns {proof.comparison.actual} — expected {proof.comparison.expected}.
            </p>
          )}
        </section>
      )}
      <dl className="figures" data-testid="run-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
