import { getBranchRiskLevel, levelToText } from '../utils/risk';
import type { PairRisk, RiskLevel } from '../types';

interface BranchLightsProps {
  branches: string[];
  pairs: PairRisk[];
}

/** Each branch with the worst risk level of any pair it is in. */
export const BranchLights = ({ branches, pairs }: BranchLightsProps) => (
  <section className="branch-lights" aria-labelledby="branches-heading">
    <h3 id="branches-heading">Branches</h3>
    {branches.length === 0 ? (
      <p className="empty-state">No branches to display.</p>
    ) : (
      <ul className="lights">
        {branches.map((branch) => {
          const level: RiskLevel = getBranchRiskLevel(branch, pairs);
          return (
            <li key={branch} className="light" data-level={level}>
              <span className="light-dot" aria-hidden="true"></span>
              <span className="light-branch">{branch}</span>
              <span className="light-level">
                <span className="sr-only">: </span>
                {levelToText(level)}
              </span>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
