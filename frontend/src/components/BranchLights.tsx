import { getBranchRiskLevel, levelToText } from '../utils/risk';
import type { PairRisk, RiskLevel } from '../types';

interface BranchLightsProps {
  branches: string[];
  pairs: PairRisk[];
}

/** Each branch with the worst risk level of any pair it is in, worst first. */
export const BranchLights = ({ branches, pairs }: BranchLightsProps) => {
  if (branches.length === 0) return <p className="muted">No branches to display.</p>;
  const rows = branches.map((branch) => ({ branch, level: getBranchRiskLevel(branch, pairs) as RiskLevel }));
  const order: RiskLevel[] = ['high', 'medium', 'low', 'none'];
  rows.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return (
    <ul className="branch-levels" aria-label="Branches by risk">
      {rows.map(({ branch, level }) => (
        <li key={branch} data-level={level}>
          <span className="light-branch">{branch}</span>
          <span className="sr-only">: </span>
          <span className="level">{levelToText(level)}</span>
        </li>
      ))}
    </ul>
  );
};
