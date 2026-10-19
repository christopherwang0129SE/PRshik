import {
  effectivePairLevel,
  levelToText,
  sortPairsByScoreDesc,
  isFloorRule,
  isHiddenConflict,
  isConfirmedByTest,
} from '../utils/risk';
import { needsAttention } from '../utils/verdict';
import { usableDocs } from '../utils/docs';
import { formatHunks, splitSymbolEvidence } from '../utils/evidence';
import type { PairRisk } from '../types';
import { VerificationDetails } from './VerificationDetails';
import { BranchTestDetails } from './BranchTestDetails';
import { DocsSources } from './DocsSources';

interface PairListProps {
  pairs: PairRisk[];
}

const formatScore = (score: number | null | undefined): string =>
  score === null || score === undefined ? 'n/a' : String(Math.round(score));

/**
 * Two-line rationale for the floor rule: the model's assessment plus why
 * the git level was kept. File names come from the overlapping collisions.
 */
const floorRationale = (pair: PairRisk): [string, string] => {
  const modelLine =
    pair.model_level === 'medium' || pair.model_level === 'high'
      ? `Nemotron: ${pair.model_level} risk (${formatScore(pair.model_score)}/100).`
      : `Nemotron: no conflict expected (${formatScore(pair.model_score)}/100).`;
  const files = pair.collisions.filter((c) => c.overlapping).map((c) => c.path);
  const touched = files.length > 0 ? files.join(', ') : `${pair.overlapping_files} files`;
  const floorLine = `Floor rule: both branches touch ${touched}, so kept ${levelToText(pair.level)}.`;
  return [modelLine, floorLine];
};

const pairKey = (pair: PairRisk): string => `${pair.branch_a}\u0000${pair.branch_b}`;

const statusOf = (pair: PairRisk): { label: string; tone: 'fail' | 'warn' | 'neutral' } => {
  if (isConfirmedByTest(pair)) return { label: 'Proven conflict', tone: 'fail' };
  if (isHiddenConflict(pair)) return { label: 'Hidden conflict', tone: 'warn' };
  return { label: `${levelToText(effectivePairLevel(pair))} risk`, tone: 'neutral' };
};

const Branches = ({ pair }: { pair: PairRisk }) => (
  <>
    <span className="branch">{pair.branch_a}</span>{' '}
    <span className="join" aria-hidden="true">
      +
    </span>
    <span className="sr-only">and</span> <span className="branch">{pair.branch_b}</span>
  </>
);

const Score = ({ pair }: { pair: PairRisk }) => (
  <span className="score" data-level={pair.level} data-testid="pair-score">
    <span className="score-num tabular">{Math.round(pair.score)}</span>
    <span className="score-max">/100</span>
    <span className="sr-only">,</span> <span className="level">{levelToText(pair.level)}</span>
  </span>
);

/** Why the pair scored as it did: Nemotron's explanation or the git heuristic. */
const Why = ({ pair }: { pair: PairRisk }) => {
  const floor = isFloorRule(pair);
  const hidden = isHiddenConflict(pair);
  const [modelLine, floorLine] = floor ? floorRationale(pair) : ['', ''];
  return (
    <section className="fact">
      <h4 className="fact-label">
        Why
        <span className="fact-sub">{pair.score_source === 'model' ? 'Nemotron' : 'git heuristic'}</span>
      </h4>
      <div className="fact-body prose">
        {floor ? (
          <>
            <p>
              <span className="status" data-tone="neutral">
                Floor rule: {pair.overlapping_files} shared files
              </span>
            </p>
            <p>{modelLine}</p>
            <p>{floorLine}</p>
          </>
        ) : hidden ? (
          <>
            <p>
              <span className="status" data-tone="warn">
                Nemotron flags hidden conflict
              </span>
            </p>
            <p>{pair.model_rationale ?? pair.rationale}</p>
          </>
        ) : (
          <p>{pair.rationale}</p>
        )}
        {pair.static_breaks && pair.static_breaks.length > 0 && (
          <ul className="plain-list" aria-label="Static signature check">
            {pair.static_breaks.map((line) => (
              <li key={line}>Static check: {line}</li>
            ))}
          </ul>
        )}
        {pair.unsupported_claims && pair.unsupported_claims.length > 0 && (
          <p className="muted">Not supported by the static checks: {pair.unsupported_claims.join(' ')}</p>
        )}
      </div>
    </section>
  );
};

/** Files and functions both branches change: where the conflict lives. */
const Overlap = ({ pair }: { pair: PairRisk }) => {
  const symbols = pair.symbol_evidence ?? [];
  if (pair.collisions.length === 0 && symbols.length === 0) return null;
  return (
    <section className="fact">
      <h4 className="fact-label">
        Overlap
        <span className="fact-sub">files and symbols both touch</span>
      </h4>
      <div className="fact-body">
        {pair.collisions.length > 0 && (
          <ul className="overlap" aria-label="Files both branches change">
            {pair.collisions.map((c) => (
              <li key={c.path}>
                <p className="overlap-head">
                  <code className="path">{c.path}</code>{' '}
                  <span className={c.overlapping ? 'overlap-kind is-same' : 'overlap-kind'}>
                    {c.overlapping ? 'edited in the same lines' : 'edited in different places'}
                  </span>
                </p>
                <dl className="hunks">
                  <div>
                    <dt>{pair.branch_a}</dt>
                    <dd className="tabular">lines {formatHunks(c.branch_a_hunks)}</dd>
                  </div>
                  <div>
                    <dt>{pair.branch_b}</dt>
                    <dd className="tabular">lines {formatHunks(c.branch_b_hunks)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
        {symbols.length > 0 && (
          <ul className="symbols" aria-label="Functions both branches touch">
            {symbols.map((line) => {
              const { symbol, detail } = splitSymbolEvidence(line);
              return (
                <li key={line}>
                  {symbol && <code className="symbol">{symbol}</code>} <span>{detail}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

const SourceLabel = ({ pair }: { pair: PairRisk }) =>
  pair.score_source === 'model' ? (
    <>Nemotron</>
  ) : (
    <span data-testid="source-badge">
      Git fallback{pair.fallback_reason ? <span className="muted"> ({pair.fallback_reason})</span> : null}
    </span>
  );

/** The numbers behind the score, in one dense row. */
const Scores = ({ pair }: { pair: PairRisk }) => {
  const tokensIn = (pair.prompt_tokens ?? 0) + (pair.verification?.prompt_tokens ?? 0);
  const tokensOut = (pair.completion_tokens ?? 0) + (pair.verification?.completion_tokens ?? 0);
  return (
    <section className="fact">
      <h4 className="fact-label">Scores</h4>
      <div className="fact-body">
        <dl className="kv">
          <div>
            <dt>Git</dt>
            <dd className="tabular" data-testid="git-score">
              {formatScore(pair.git_score)}
            </dd>
          </div>
          <div>
            <dt>Nemotron</dt>
            <dd className="tabular" data-testid="model-score">
              {formatScore(pair.model_score)}
            </dd>
          </div>
          <div>
            <dt>Score from</dt>
            <dd>
              <SourceLabel pair={pair} />
            </dd>
          </div>
          <div>
            <dt>Shared files</dt>
            <dd className="tabular">
              {pair.shared_files}
              {pair.overlapping_files > 0
                ? `, ${pair.overlapping_files} with overlapping edits`
                : ', no overlapping edits'}
            </dd>
          </div>
          {(tokensIn > 0 || tokensOut > 0 || pair.model_cached) && (
            <div>
              <dt>Tokens</dt>
              <dd className="tabular">
                {tokensIn > 0 || tokensOut > 0
                  ? `${tokensIn.toLocaleString('en-US')} in, ${tokensOut.toLocaleString('en-US')} out`
                  : '0'}
                {pair.model_cached ? ' (cached)' : ''}
              </dd>
            </div>
          )}
        </dl>
        {pair.git_rationale && pair.score_source === 'model' && (
          <p className="muted">Git heuristic: {pair.git_rationale}</p>
        )}
      </div>
    </section>
  );
};

/** Pair docs plus any extra docs the intent-test step used, one per URL. */
const pairDocs = (pair: PairRisk) => usableDocs([...(pair.docs_sources ?? []), ...(pair.verification?.docs_sources ?? [])]);

/** Every piece of evidence for one pair, in reading order. */
const Facts = ({ pair, withWhy = true }: { pair: PairRisk; withWhy?: boolean }) => (
  <div className="facts">
    {withWhy && <Why pair={pair} />}
    <Overlap pair={pair} />
    {pair.branch_tests && <BranchTestDetails branchTests={pair.branch_tests} />}
    {pair.verification && <VerificationDetails verification={pair.verification} />}
    <DocsSources sources={pairDocs(pair)} />
    <Scores pair={pair} />
  </div>
);

const PairArticle = ({ pair }: { pair: PairRisk }) => {
  const confirmed = isConfirmedByTest(pair);
  const hidden = isHiddenConflict(pair);
  const level = confirmed ? 'high' : effectivePairLevel(pair);
  const status = statusOf(pair);
  const className = ['pair', confirmed ? 'pair-confirmed' : hidden ? 'pair-hidden-conflict' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <article className={className} data-level={level} data-testid="pair-card">
        <header className="pair-head">
          <h3 className="pair-branches">
            <Branches pair={pair} />
          </h3>
          <Score pair={pair} />
        </header>
        <p className="pair-state">
          <span className="status" data-tone={status.tone}>
            {status.label}
          </span>
          {pair.score_note && (
            <span className="muted" data-testid="score-note">
              {pair.score_note}
              {pair.blended_score !== null && pair.blended_score !== undefined
                ? ` (blend ${Math.round(pair.blended_score)})`
                : ''}
            </span>
          )}
        </p>
        <Facts pair={pair} />
      </article>
    </li>
  );
};

/** A pair with nothing to act on: one row, the evidence on request. */
const QuietRow = ({ pair }: { pair: PairRisk }) => (
  <li className="quiet" data-level={pair.level} data-testid="quiet-row">
    <details>
      <summary>
        <span className="quiet-branches">
          <Branches pair={pair} />
        </span>
        <Score pair={pair} />
        <span className="quiet-why">{pair.rationale}</span>
      </summary>
      <Facts pair={pair} withWhy={false} />
    </details>
  </li>
);

/**
 * Branch pairs, worst first. Pairs that need attention get the explanation
 * and the evidence open; the rest collapse to one row each.
 */
export const PairList = ({ pairs }: PairListProps) => {
  const sorted = sortPairsByScoreDesc(pairs);
  const attention = sorted.filter(needsAttention);
  const quiet = sorted.filter((pair) => !needsAttention(pair));

  if (sorted.length === 0) {
    return (
      <section className="block" aria-labelledby="pairs-heading">
        <h2 id="pairs-heading" className="block-title">
          Branch pairs
        </h2>
        <p className="muted">No branch pairs to display.</p>
      </section>
    );
  }

  return (
    <>
      {attention.length > 0 && (
        <section className="block" aria-labelledby="pairs-heading">
          <h2 id="pairs-heading" className="block-title">
            {attention.length === 1 ? 'The pair that needs attention' : `${attention.length} pairs that need attention`}
          </h2>
          <ol className="pairs">
            {attention.map((pair) => (
              <PairArticle key={pairKey(pair)} pair={pair} />
            ))}
          </ol>
        </section>
      )}
      {quiet.length > 0 && (
        <section className="block" aria-labelledby="quiet-heading">
          <h2 id="quiet-heading" className="block-title">
            {attention.length > 0 ? 'Low-risk pairs' : 'All pairs'}{' '}
            <span className="count tabular">{quiet.length}</span>
          </h2>
          <ul className="quiet-list">
            {quiet.map((pair) => (
              <QuietRow key={pairKey(pair)} pair={pair} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
};
