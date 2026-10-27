import { pairProof } from '../utils/proof';
import { useState, type Ref } from 'react';
import type { AnalyzeRequest, PairRisk, UsageSummary } from '../types';
import { isFloorRule, isHiddenConflict, gitLevelFromScore, levelToText } from '../utils/risk';
import { VERDICT_TEXT, pairVerdict } from '../utils/verdict';
import { usableDocs } from '../utils/docs';
import { formatCost } from '../utils/usage';
import { splitSymbolEvidence } from '../utils/evidence';
import { RiskGauge } from './RiskGauge';
import { PairDiff } from './PairDiff';
import { VerificationDetails } from './VerificationDetails';
import { BranchTestDetails } from './BranchTestDetails';
import { DocsSources } from './DocsSources';
import { advancedView } from '../utils/presentation';
import { NEEDS_NEBIUS_KEY } from '../utils/agent';

interface PairDetailProps {
  pair: PairRisk;
  source: Pick<AnalyzeRequest, 'repo_path' | 'repo_url'>;
  baseBranch: string;
  usage?: UsageSummary | null;
  /** True while the stream may still update this pair. */
  provisional?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Health says the model is off. Model-only actions explain that instead of failing. */
  gitOnly?: boolean;
}

const VERDICT_LINE: Record<ReturnType<typeof pairVerdict>, string> = {
  confirmed: 'A test passes on each branch and fails once they are merged.',
  suspected: 'Flagged by the diff or by Nemotron. No test has failed on the merge.',
  clean: 'Nothing here needs attention.',
  skipped: 'These branches share code, but Nemotron did not review the pair in this run.',
};

const FALLBACK_TEXT: Record<string, string> = {
  no_api_key: NEEDS_NEBIUS_KEY,
  disabled: 'Nemotron is turned off',
  prefiltered: 'the branches share no files or functions',
  pair_cap: 'more pairs than the per-run model limit',
  model_error: 'the model call failed',
  unparsable: 'the model answer was unreadable',
};

/** Why the pair scored as it did, from the source that set the score. */
const Explanation = ({ pair }: { pair: PairRisk }) => {
  const fromModel = pair.score_source === 'model';
  const text = fromModel ? pair.model_rationale ?? pair.rationale : pair.rationale;
  return (
    <section className="explain" aria-labelledby="explain-heading">
      <h3 id="explain-heading" className="explain-title">
        {fromModel ? 'Nemotron’s reading' : 'Git heuristic'}
      </h3>
      <p className="explain-text">{text}</p>
      {isHiddenConflict(pair) && pair.git_score != null && pairVerdict(pair) !== 'confirmed' && (
        <p className="explain-note">
          Nemotron rates this {pair.model_level} risk while the diff alone looks{' '}
          {(pair.git_score === 0 ? 'low' : levelToText(gitLevelFromScore(pair.git_score)).toLowerCase())}: a conflict git cannot see.
        </p>
      )}
      {isFloorRule(pair) && (
        <p className="explain-note">
          Both branches edit the same lines, so the score stays at the git level ({Math.round(pair.git_score!)})
          even though Nemotron scored it {Math.round(pair.model_score!)}.
        </p>
      )}
      {!fromModel && pair.fallback_reason && FALLBACK_TEXT[pair.fallback_reason] && (
        <p className="explain-note">Nemotron skipped this pair: {FALLBACK_TEXT[pair.fallback_reason]}.</p>
      )}
      {fromModel && pair.git_rationale && <p className="explain-aside">Git heuristic: {pair.git_rationale}</p>}
      {(pair.static_breaks?.length ?? 0) > 0 && (
        <ul className="explain-list" aria-label="Static signature check">
          {pair.static_breaks?.map((line) => (
            <li key={line}>Static check: {line}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

/** Functions one branch changes and the other relies on. */
const Symbols = ({ pair }: { pair: PairRisk }) => {
  const lines = pair.symbol_evidence ?? [];
  if (lines.length === 0) return null;
  return (
    <ul className="symbols" aria-label="Functions both branches touch">
      {lines.map((line) => {
        const { symbol, detail } = splitSymbolEvidence(line);
        return (
          <li key={line}>
            {symbol && <code className="symbol">{symbol}</code>} <span>{detail}</span>
          </li>
        );
      })}
    </ul>
  );
};

/** Tokens this pair used (risk call plus test writing) and their estimated price. */
const Cost = ({ pair, usage }: { pair: PairRisk; usage?: UsageSummary | null }) => {
  const tokensIn = (pair.prompt_tokens ?? 0) + (pair.verification?.prompt_tokens ?? 0);
  const tokensOut = (pair.completion_tokens ?? 0) + (pair.verification?.completion_tokens ?? 0);
  if (tokensIn + tokensOut === 0) {
    return pair.model_cached ? (
      <section className="block block-cost" aria-labelledby="cost-heading">
        <h3 id="cost-heading" className="block-title">
          Model usage for this pair
        </h3>
        <p className="muted">Answered from the cache: no tokens spent in this run.</p>
      </section>
    ) : null;
  }
  const cost = usage
    ? (tokensIn * usage.input_usd_per_1m + tokensOut * usage.output_usd_per_1m) / 1_000_000
    : null;
  return (
    <section className="block block-cost" aria-labelledby="cost-heading">
      <h3 id="cost-heading" className="block-title">
        Model usage for this pair
      </h3>
      <dl className="figures">
        <div>
          <dt>Tokens in</dt>
          <dd className="tabular">{tokensIn.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Tokens out</dt>
          <dd className="tabular">{tokensOut.toLocaleString('en-US')}</dd>
        </div>
        {cost !== null && (
          <div>
            <dt>Estimated cost</dt>
            <dd className="tabular">{formatCost(cost)}</dd>
          </div>
        )}
        {pair.model_cached && (
          <div>
            <dt>Risk call</dt>
            <dd>from cache</dd>
          </div>
        )}
      </dl>
    </section>
  );
};

/**
 * One branch pair in full: verdict and score, the explanation, both diffs
 * side by side, the test evidence, the docs Nemotron read and what it cost.
 */
export const PairDetail = ({ pair, source, baseBranch, usage, provisional = false, headingRef, gitOnly = false }: PairDetailProps) => {
  const [changesOpen, setChangesOpen] = useState(() => !window.matchMedia?.('(max-width: 640px)').matches);
  const verdict = pairVerdict(pair);
  const awaitingVerdict = provisional && verdict === 'clean';
  const docs = usableDocs([...(pair.docs_sources ?? []), ...(pair.verification?.docs_sources ?? [])]);
  const evidence = pairProof(pair);
  const { proof, comparison } = evidence;
  const confirmedLine = evidence.semanticConflict
    ? VERDICT_LINE.confirmed : 'A test confirms a failure on the merged code.';
  return (
    <article className="detail" data-verdict={awaitingVerdict ? 'pending' : verdict} aria-labelledby="detail-heading" data-testid="pair-detail">
      <header className="detail-head">
        <h2 id="detail-heading" className="detail-pair" ref={headingRef} tabIndex={-1}>
          <span className="pair-side">
            <span className="side-key" aria-hidden="true">A</span>
            <span className="pair-branch" title={pair.branch_a}><bdi>{pair.branch_a}</bdi></span>
          </span>
          <span className="sr-only"> and </span>
          <span className="pair-side">
            <span className="side-key" aria-hidden="true">B</span>
            <span className="pair-branch" title={pair.branch_b}><bdi>{pair.branch_b}</bdi></span>
          </span>
        </h2>
        <RiskGauge pair={pair} provisional={provisional} />
        <p className="detail-verdict">
          <span className="verdict-word">{awaitingVerdict ? 'Awaiting verdict' : VERDICT_TEXT[verdict]}</span>
          <span className="verdict-why">{awaitingVerdict ? 'Risk scoring and test checks are still running.' : verdict === 'confirmed' ? confirmedLine : VERDICT_LINE[verdict]}</span>
        </p>
        {provisional && <p className="detail-provisional">Still running: this pair may change when the tests finish.</p>}
      </header>

      {proof && <section className="block proof-card" aria-label="Critical proof">
        <h3 className="block-title">{pair.verification ? "Nemotron's intent test, run on all four states" : evidence.assertion ? 'Branch test failed on A+B merge' : 'Static evidence'}</h3>
        {comparison && <p className="proof-money">Merged code returns {comparison.actual} — expected {comparison.expected}.</p>}
        <div className="proof-strip">
          <code className="proof-assertion">{proof}</code>
        </div>
        {Object.values(evidence.outcomes).some(Boolean) && <dl className="proof-matrix" aria-label="Verification run outcomes">
          {(['a', 'b', 'merge', 'base'] as const).map(target => {
            const result = evidence.outcomes[target];
            if (!result) return null;
            const expectedBase = target === 'base' && evidence.baseExpected;
            return (
              <div key={target} className={target === 'base' ? 'proof-base' : undefined}>
                <dt>
                  <span>{{ base: 'merge-base (before either branch)', a: 'A only', b: 'B only', merge: 'A+B merge' }[target]}</span>
                  {target === 'merge' && evidence.semanticConflict && (
                    <span className="proof-row-note proof-merge-note">← the semantic conflict</span>
                  )}
                  {expectedBase && (
                    <span className="proof-row-note proof-base-note">expected — neither change exists on the base yet</span>
                  )}
                </dt>
                <dd data-outcome={result} data-expected={expectedBase ? 'true' : undefined}>
                  {result === 'fail' ? 'FAIL' : 'PASS'}
                </dd>
              </div>
            );
          })}
        </dl>}
      </section>}

      <Explanation pair={pair} />

      <details className="block changes-disclosure" open={changesOpen} onToggle={e => setChangesOpen(e.currentTarget.open)}>
        <summary>Show changes</summary>
        <h3 id="diff-heading" className="block-title">
          Both diffs <span className="block-sub">against {baseBranch}, lined up on the base file</span>
        </h3>
        <div className="block-body">
          <Symbols pair={pair} />
          <PairDiff source={source} baseBranch={baseBranch} branchA={pair.branch_a} branchB={pair.branch_b} />
        </div>
      </details>

      {pair.verification ? (
        <VerificationDetails verification={pair.verification} branchA={pair.branch_a} branchB={pair.branch_b} />
      ) : gitOnly && pair.shared_files > 0 ? (
        <section className="block" aria-labelledby="intent-off-heading">
          <h3 id="intent-off-heading" className="block-title">
            Verify by test <span className="block-sub">generated intent tests</span>
          </h3>
          <div className="block-body">
            <p>Intent test generation {NEEDS_NEBIUS_KEY}. Each branch&apos;s own tests still run on the merge.</p>
          </div>
        </section>
      ) : null}
      {pair.branch_tests && (
        <BranchTestDetails branchTests={pair.branch_tests} branchA={pair.branch_a} branchB={pair.branch_b} />
      )}
      <DocsSources sources={docs} />
      {advancedView() && <Cost pair={pair} usage={usage} />}
    </article>
  );
};
