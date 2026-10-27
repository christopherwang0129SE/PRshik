import type { Ref } from 'react';
import type { AnalyzeResponse } from '../types';
import { formatCost } from '../utils/usage';
import { summaryLine, verdictFor } from '../utils/verdict';
import { usableDocs } from '../utils/docs';

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
  const docs = usableDocs(pairs.flatMap((p) => [...(p.docs_sources ?? []), ...(p.verification?.docs_sources ?? [])]));
  const figures: Array<[string, string]> = [];
  figures.push(['Branches', `${response.branches.length} vs ${response.base_branch}`]);
  if (usage) {
    const cached = usage.llm_calls === 0 && (usage.cached_llm_calls ?? 0) > 0;
    figures.push(['Nemotron calls', String(cached ? usage.cached_llm_calls : usage.llm_calls)]);
    if (!cached || usage.cached_tokens !== undefined) figures.push(['Tokens', `${(cached ? usage.cached_tokens! : usage.total_tokens).toLocaleString('en-US')}${cached ? ' (cached)' : ''}`]);
    if (!cached || usage.cached_cost_usd !== undefined) figures.push(['Est. cost', `${formatCost(cached ? usage.cached_cost_usd! : usage.estimated_cost_usd)}${cached ? ' (cached)' : ''}`]);
    if (usage.elapsed_s > 0) figures.push(['Time', `${usage.elapsed_s.toFixed(1)}s`]);
  }
  if (docs.length > 0) figures.push(['Tavily docs', String(docs.length)]);

  return (
    <section className="summary" data-tone={verdict.tone} aria-labelledby="summary-heading" data-testid="run-summary">
      <p className="summary-target">
        <span className="sr-only">Analyzed </span>
        <span className="mono">{target}</span>
      </p>
      <h2 id="summary-heading" className="summary-line" ref={headingRef} tabIndex={-1}>
        {summaryLine(pairs)}
      </h2>
      <p className="summary-detail">{verdict.detail}</p>
      <p className="model-attribution">{modelOk ? 'Risk scoring, explanations and intent tests by NVIDIA Nemotron 3 Super on Nebius Token Factory' : 'Scores come from git + branch tests.'}</p>
      <dl className="figures" data-testid="run-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="tabular">{value}{label === 'Nemotron calls' && usage?.llm_calls === 0 && (usage.cached_llm_calls ?? 0) > 0 && <small className="cache-caption">from cache</small>}</dd>
          </div>
        ))}
        {response.risk_model && (
          <div className="figure-model">
            <dt>Model</dt>
            <dd className="mono">{response.risk_model}</dd>
          </div>
        )}
      </dl>
    </section>
  );
};
