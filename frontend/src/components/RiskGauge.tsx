import type { PairRisk } from '../types';
import { levelToText } from '../utils/risk';

interface RiskGaugeProps {
  pair: PairRisk;
  provisional?: boolean;
}

export const RiskGauge = ({ pair, provisional = false }: RiskGaugeProps) => {
  const score = pair.score == null ? null : Math.round(pair.score);
  const legend = [
    pair.git_score != null ? `git heuristic ${Math.round(pair.git_score)}` : null,
    pair.model_score != null ? `Nemotron ${Math.round(pair.model_score)}` : null,
    score != null ? `final ${score}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <figure className="gauge" data-level={provisional ? 'pending' : pair.level} data-testid="risk-gauge">
      <div className="gauge-label">Risk score</div>
      {score != null && <div className="gauge-readout">
        <span className="gauge-num tabular" data-testid="gauge-score">{score}</span>
        <span className="gauge-unit">/ 100 · {provisional ? 'provisional' : levelToText(pair.level).toLowerCase()}</span>
      </div>}
      <div className="risk-track" aria-hidden="true">
        {score != null && <span className="risk-marker" style={{ left: `${Math.min(100, Math.max(0, score))}%` }}>
          <span className="risk-value" data-align={score < 15 ? 'start' : score > 85 ? 'end' : undefined}>{score}{provisional ? ' provisional' : ''}</span>
        </span>}
      </div>
      {legend && <p className="risk-legend">{legend}</p>}
      <figcaption className="sr-only">
        {score != null && `Risk score ${score} out of 100${provisional ? '; checks running' : `, ${levelToText(pair.level).toLowerCase()} risk`}.`}
        {pair.git_score != null && ` git scored ${Math.round(pair.git_score)}.`}
        {pair.model_score != null && ` Nemotron scored ${Math.round(pair.model_score)}.`}
      </figcaption>
    </figure>
  );
};
