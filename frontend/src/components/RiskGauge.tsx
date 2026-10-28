import type { PairRisk } from '../types';
import { levelToText } from '../utils/risk';

interface RiskGaugeProps {
  pair: PairRisk;
  provisional?: boolean;
}

export const RiskGauge = ({ pair, provisional = false }: RiskGaugeProps) => {
  const score = pair.score == null ? null : Math.round(pair.score);
  const level = levelToText(pair.level);
  const note = pair.score_note?.trim() ?? '';
  const wasRaised = /^raised:\s*/i.test(note);
  const noteBody = note.replace(/^raised:\s*/i, '').trim();
  const signals = [
    pair.git_score != null ? `git heuristic ${Math.round(pair.git_score)}` : null,
    pair.model_score != null ? `Nemotron ${Math.round(pair.model_score)}` : null,
  ].filter((signal): signal is string => signal !== null);

  let legend = '';
  if (signals.length > 0 || note) {
    legend = `Signals: ${signals.join(' · ')}`;
    if (note && wasRaised && score != null) {
      const raised = `raised to ${score}${noteBody ? ` — ${noteBody}` : ''}`;
      legend = signals.length > 0 ? `${legend} → ${raised}` : `Signals: ${raised}`;
    } else if (note) {
      legend += `${signals.length > 0 ? ' · ' : ''}${note}`;
    }
  }

  const gitClean =
    pair.git_score != null &&
    pair.git_score < 40 &&
    (pair.branch_tests?.merge_conflict === false || pair.verification?.merge_conflict === false) &&
    pair.overlapping_files === 0 &&
    !pair.branch_tests?.merge_conflict &&
    !pair.verification?.merge_conflict;

  return (
    <figure className="gauge" data-level={provisional ? 'pending' : pair.level} data-testid="risk-gauge">
      {score != null && (
        // The figcaption reads the same facts as one sentence.
        <div className="gauge-readout" aria-hidden="true">
          <span className="gauge-label">Risk score</span>
          <span className="gauge-score-line">
            <span className="gauge-num tabular" data-testid="gauge-score">{score}</span>
            <span className="gauge-unit">/ 100 · {provisional ? 'provisional' : level}</span>
          </span>
        </div>
      )}
      <div className="risk-track" aria-hidden="true">
        {score != null && (
          <span className="risk-marker" style={{ left: `${Math.min(100, Math.max(0, score))}%` }}>
            <span className="risk-value" data-align={score < 15 ? 'start' : score > 85 ? 'end' : undefined}>
              {score}{provisional ? ' provisional' : ''}
            </span>
          </span>
        )}
      </div>
      {(legend || gitClean) && (
        <div className="risk-signals">
          {legend && <p className="risk-legend">{legend}</p>}
          {gitClean && <span className="git-clean-tag">git: merges cleanly</span>}
        </div>
      )}
      <figcaption className="sr-only">
        {score != null &&
          `Risk score ${score} out of 100${provisional ? '; checks running' : `, ${level.toLowerCase()} risk`}.`}
        {pair.git_score != null && ` git scored ${Math.round(pair.git_score)}.`}
        {pair.model_score != null && ` Nemotron scored ${Math.round(pair.model_score)}.`}
      </figcaption>
    </figure>
  );
};
