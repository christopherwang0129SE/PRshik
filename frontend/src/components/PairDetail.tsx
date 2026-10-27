import { keptRuns } from '../utils/verification';
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

/** "raised: confirmed by test" + blended 44 -> "Raised from 44: confirmed by test". */
const scoreNote = (pair: PairRisk): string => {
  const note = pair.score_note ?? '';
  const match = /^(raised|lowered):\s*(.*)$/i.exec(note);
  if (match && pair.blended_score !== null && pair.blended_score !== undefined) {
    const verb = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    return `${verb} from ${Math.round(pair.blended_score)}: ${match[2]}`;
  }
  return note;
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
  const branchFailure = pair.branch_tests?.confirming[0];
  const mergeRun = pair.verification?.runs.find(r => r.target === 'merge' && (r.failed > 0 || r.errors > 0));
  const output = mergeRun?.output || branchFailure?.excerpt;
  const lines = output?.split('\n') ?? [];
  const failureLine = lines.find(line => /AssertionError:.* != /.test(line))
    ?? lines.find(line => /^E\s+assert\s/.test(line.trim()))
    ?? lines.find(line => /assert\s|AssertionError|Expected:|expected .* (?:to|but)/i.test(line));
  const assertion = failureLine?.replace(/^(?:E\s+|>\s*)?\s*/, '').slice(0, 240) ?? output?.trim().slice(0, 240);
  const proof = assertion || pair.static_breaks?.[0];
  const outcomes = (pair.verification ? keptRuns(pair.verification) : pair.branch_tests?.runs ?? [])
    .filter(r => !r.timed_out && r.exit_code !== null && r.errors === 0 && r.passed + r.failed > 0 && (r.failed > 0 || r.exit_code === 0));
  const outcome = (target: string) => {
    const run = outcomes.find(r => r.target === target);
    return run ? (run.failed > 0 ? 'fail' : 'pass') : null;
  };
  const branchesPass = outcome('a') === 'pass' && outcome('b') === 'pass';
  const caption = branchesPass && outcome('merge') === 'fail' && outcome('base') === 'fail';
  const comparison = assertion?.match(/^(?:AssertionError:\s*)?(.+?)\s+!=\s+(.+)$/);
  const confirmedLine = branchesPass && outcome('merge') === 'fail'
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
        {verdict === 'confirmed' && pair.git_score != null && pair.git_score < 40 && pair.model_score != null && <p className="git-blind-callout">
          Git heuristic: {Math.round(pair.git_score)}/100{pair.overlapping_files === 0 && !pair.branch_tests?.merge_conflict && !pair.verification?.merge_conflict ? ' (no overlapping hunks, merges cleanly)' : ' (low risk)'}. Nemotron: {Math.round(pair.model_score)}/100. The test on the merged code confirms it.
        </p>}
        <p className="detail-verdict">
          <span className="verdict-word">{awaitingVerdict ? 'Awaiting verdict' : VERDICT_TEXT[verdict]}</span>
          <span className="verdict-why">{awaitingVerdict ? 'Risk scoring and test checks are still running.' : verdict === 'confirmed' ? confirmedLine : VERDICT_LINE[verdict]}</span>
        </p>
        {provisional && <p className="detail-provisional">Still running: this pair may change when the tests finish.</p>}
      </header>

      {proof && <section className="block proof-card" aria-label="Critical proof">
        <h3 className="block-title">{pair.verification ? "Nemotron's intent test, run on all four states" : assertion ? 'Branch test failed on A+B merge' : 'Static evidence'}</h3>
        <div className="proof-strip">
          {comparison && <div className="proof-comparison"><div><span>got</span><strong>{comparison[1]}</strong></div><span className="proof-not-equal">≠</span><div><span>expected</span><strong>{comparison[2]}</strong></div></div>}
          <code className="proof-assertion">{proof}</code>
        </div>
        {outcomes.length > 0 && <dl className="proof-matrix" aria-label="Verification run outcomes">
          {(['a', 'b', 'merge', 'base'] as const).map(target => {
            const result = outcome(target);
            if (!result) return null;
            return <div key={target} className={target === 'base' ? 'proof-base' : undefined}><dt>{{ base: 'merge-base (before either branch)', a: 'A only', b: 'B only', merge: 'A+B merge' }[target]}</dt><dd data-outcome={result}>{result === 'fail' ? 'FAIL' : 'PASS'}</dd></div>;
          })}
        </dl>}
        {caption && <p className="proof-caption">Passes on each branch alone and fails on the merge; it also fails on the base, where neither change exists yet.</p>}
      </section>}

      <div className="detail-top">
        <Explanation pair={pair} />
        <div className="detail-gauge">
          <RiskGauge pair={pair} provisional={provisional} />
          {provisional && <p className="gauge-note">Provisional {pair.model_score == null ? 'git ' : ''}score · tests running</p>}
          {pair.score_note && (
            <p className="gauge-note" data-testid="score-note">
              {scoreNote(pair)}
            </p>
          )}
        </div>
      </div>

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
      {verdict === 'confirmed' && [pair.branch_a, pair.branch_b].includes('feat/discount-cap') && [pair.branch_a, pair.branch_b].includes('feat/tax-before-discount') && (
        <section className="block" aria-labelledby="suggestion-heading">
          <h3 id="suggestion-heading" className="block-title">Suggested next step</h3>
          <div className="block-body">
            <p>Agree on whether the discount cap applies before or after tax. Keep the cap on the pre-tax subtotal, then apply tax, if preserving the discount branch’s contract.</p>
            <p>Update the competing tax-order contract and rerun both branches’ tests together before merging.</p>
            <p className="muted">Demo guidance for human review. This dashboard has no integrated planner or resolver and has not applied a fix.</p>
            {gitOnly && <p>The resolver {NEEDS_NEBIUS_KEY}.</p>}
          </div>
        </section>
      )}
      {advancedView() && <Cost pair={pair} usage={usage} />}
    </article>
  );
};
