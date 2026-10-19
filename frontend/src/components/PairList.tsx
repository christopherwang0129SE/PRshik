import {
  effectivePairLevel,
  levelToText,
  sortPairsByScoreDesc,
  isFloorRule,
  isHiddenConflict,
  isConfirmedByTest,
} from '../utils/risk';
import { needsAttention } from '../utils/verdict';
import type { PairRisk } from '../types';
import { VerificationDetails } from './VerificationDetails';
import { BranchTestDetails } from './BranchTestDetails';
import { DocsSources } from './DocsSources';

interface PairListProps {
  pairs: PairRisk[];
  risk_model: string | null;
}

const formatScore = (score: number | null | undefined): string =>
  score === null || score === undefined ? '—' : String(Math.round(score));

/**
 * Two-line rationale for the floor rule: the model's assessment plus why
 * the git level was kept. File names come from the overlapping collisions.
 */
const floorRationale = (pair: PairRisk): [string, string] => {
  const modelLine =
    pair.model_level === 'medium' || pair.model_level === 'high'
      ? `Nemotron: ${pair.model_level} risk (${formatScore(pair.model_score)}/100).`
      : `Nemotron: no conflict expected (${formatScore(pair.model_score)}/100).`;
  const files = pair.collisions
    .filter((c) => c.overlapping)
    .map((c) => c.path);
  const touched = files.length > 0 ? files.join(', ') : `${pair.overlapping_files} files`;
  const floorLine = `Floor rule: both branches touch ${touched}, so kept ${levelToText(pair.level)}.`;
  return [modelLine, floorLine];
};

const pairKey = (pair: PairRisk): string => `${pair.branch_a}\u0000${pair.branch_b}`;

const statusLabel = (pair: PairRisk): string => {
  if (isConfirmedByTest(pair)) return 'Proven conflict';
  if (isHiddenConflict(pair)) return 'Hidden conflict';
  return `${levelToText(effectivePairLevel(pair))} risk`;
};

const Branches = ({ pair, as: Tag }: { pair: PairRisk; as: 'h3' | 'p' }) => (
  <Tag className="pair-branches">
    <span className="branch-name">{pair.branch_a}</span>
    <span className="pair-join" aria-hidden="true">+</span>
    <span className="sr-only"> and </span>
    <span className="branch-name">{pair.branch_b}</span>
  </Tag>
);

const SourceBadge = ({ pair }: { pair: PairRisk }) =>
  pair.score_source === 'model' ? (
    <span className="badge badge-neutral">Nemotron</span>
  ) : (
    <span className="badge badge-neutral" data-testid="source-badge">
      Git fallback
      {pair.fallback_reason ? <span className="fallback-reason"> · {pair.fallback_reason}</span> : null}
    </span>
  );

/** The signals behind the score: kept collapsed so the card stays scannable. */
const Signals = ({ pair, withEvidence = false }: { pair: PairRisk; withEvidence?: boolean }) => (
  <details className="disclosure pair-signals">
    <summary>Scores, files and signals</summary>
    <dl className="signal-grid">
      <div>
        <dt>Git score</dt>
        <dd className="tabular" data-testid="git-score">{formatScore(pair.git_score)}</dd>
      </div>
      <div>
        <dt>Nemotron score</dt>
        <dd className="tabular" data-testid="model-score">{formatScore(pair.model_score)}</dd>
      </div>
      <div>
        <dt>Score from</dt>
        <dd>
          <SourceBadge pair={pair} />
        </dd>
      </div>
      <div>
        <dt>Shared files</dt>
        <dd className="tabular">
          {pair.shared_files}
          {pair.overlapping_files > 0 ? `, ${pair.overlapping_files} with overlapping edits` : ', no overlapping edits'}
        </dd>
      </div>
    </dl>
    {pair.git_rationale && pair.score_source === 'model' && (
      <p className="signal-note">Git heuristic: {pair.git_rationale}</p>
    )}
    {pair.collisions.length > 0 && (
      <ul className="signal-list" aria-label="Files both branches change">
        {pair.collisions.map((c) => (
          <li key={c.path}>
            <code>{c.path}</code> {c.overlapping ? 'edited in the same lines' : 'edited in different places'}
          </li>
        ))}
      </ul>
    )}
    {pair.symbol_evidence && pair.symbol_evidence.length > 0 && (
      <ul className="signal-list" aria-label="Functions both branches touch">
        {pair.symbol_evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    )}
    {pair.docs_sources && pair.docs_sources.length > 0 && <DocsSources sources={pair.docs_sources} />}
    {withEvidence && pair.branch_tests && <BranchTestDetails branchTests={pair.branch_tests} />}
    {withEvidence && pair.verification && <VerificationDetails verification={pair.verification} />}
  </details>
);

const PairCard = ({ pair }: { pair: PairRisk }) => {
  const floor = isFloorRule(pair);
  const hidden = isHiddenConflict(pair);
  const confirmed = isConfirmedByTest(pair);
  const level = confirmed ? 'high' : effectivePairLevel(pair);
  const [modelLine, floorLine] = floor ? floorRationale(pair) : ['', ''];
  const cardClass = ['pair-card', confirmed ? 'pair-confirmed' : hidden ? 'pair-hidden-conflict' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <article className={cardClass} data-level={level} data-testid="pair-card">
        <div className="pair-top">
          <span className="pair-status">{statusLabel(pair)}</span>
          <span className="pair-score" data-level={pair.level}>
            <span className="risk-number tabular">Risk {Math.round(pair.score)} / 100</span>
            <span className="level-word">{levelToText(pair.level)}</span>
          </span>
        </div>
        <Branches pair={pair} as="h3" />
        {pair.score_note && (
          <p className="score-note" data-testid="score-note">
            {pair.score_note}
            {pair.blended_score !== null && pair.blended_score !== undefined
              ? ` (blend ${Math.round(pair.blended_score)})`
              : ''}
          </p>
        )}

        <div className="pair-why">
          <h4>{pair.score_source === 'model' ? "Nemotron's explanation" : 'Why this score'}</h4>
          {floor ? (
            <div className="rationale-lines">
              <span className="badge badge-floor">Floor rule: {pair.overlapping_files} shared files</span>
              <p>{modelLine}</p>
              <p>{floorLine}</p>
            </div>
          ) : hidden ? (
            <div className="rationale-lines">
              <span className="badge badge-hidden">Nemotron flags hidden conflict</span>
              <p>{pair.model_rationale ?? pair.rationale}</p>
            </div>
          ) : (
            <p>{pair.rationale}</p>
          )}
          {pair.static_breaks && pair.static_breaks.length > 0 && (
            <ul className="static-breaks" aria-label="Static signature check">
              {pair.static_breaks.map((line) => (
                <li key={line}>Static check: {line}</li>
              ))}
            </ul>
          )}
          {pair.unsupported_claims && pair.unsupported_claims.length > 0 && (
            <p className="unsupported-claims">
              Not supported by the static checks: {pair.unsupported_claims.join(' ')}
            </p>
          )}
        </div>

        {(pair.branch_tests || pair.verification) && (
          <div className="pair-evidence">
            {pair.branch_tests && <BranchTestDetails branchTests={pair.branch_tests} />}
            {pair.verification && <VerificationDetails verification={pair.verification} />}
          </div>
        )}

        <Signals pair={pair} />
      </article>
    </li>
  );
};

/** A pair with nothing to act on: one quiet row, details on request. */
const QuietRow = ({ pair }: { pair: PairRisk }) => (
  <li className="quiet-row" data-level={pair.level} data-testid="quiet-row">
    <div className="quiet-head">
      <Branches pair={pair} as="p" />
      <span className="pair-score" data-level={pair.level}>
        <span className="risk-number tabular">Risk {Math.round(pair.score)} / 100</span>
        <span className="level-word">{levelToText(pair.level)}</span>
      </span>
    </div>
    <p className="quiet-rationale">{pair.rationale}</p>
    <Signals pair={pair} withEvidence />
  </li>
);

/**
 * Branch pairs, worst first. Pairs that need attention get a full card with
 * the explanation and the test evidence; the rest collapse to quiet rows.
 */
export const PairList = ({ pairs, risk_model }: PairListProps) => {
  const sorted = sortPairsByScoreDesc(pairs);
  const attention = sorted.filter(needsAttention);
  const quiet = sorted.filter((pair) => !needsAttention(pair));

  if (sorted.length === 0) {
    return (
      <section className="pair-list" aria-labelledby="pairs-heading">
        <h2 id="pairs-heading">Branch pairs</h2>
        <p className="empty-state">No branch pairs to display.</p>
      </section>
    );
  }

  return (
    <>
      {attention.length > 0 && (
        <section className="pair-list" aria-labelledby="pairs-heading">
          <h2 id="pairs-heading">
            {attention.length === 1 ? 'The pair that needs attention' : `${attention.length} pairs that need attention`}
          </h2>
          <ol className="pair-cards">
            {attention.map((pair) => (
              <PairCard key={pairKey(pair)} pair={pair} />
            ))}
          </ol>
        </section>
      )}
      {quiet.length > 0 && (
        <section className="pair-list pair-list-quiet" aria-labelledby="quiet-heading">
          <h2 id="quiet-heading">
            {attention.length > 0 ? 'Low-risk pairs' : 'All pairs'}{' '}
            <span className="count tabular">({quiet.length})</span>
          </h2>
          <ul className="quiet-rows">
            {quiet.map((pair) => (
              <QuietRow key={pairKey(pair)} pair={pair} />
            ))}
          </ul>
        </section>
      )}
      {risk_model && <p className="risk-model">Risk model in use: {risk_model}</p>}
    </>
  );
};
