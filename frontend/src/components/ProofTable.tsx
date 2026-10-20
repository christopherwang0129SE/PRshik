interface ProofRun {
  target: string;
  ref: string;
  passed: number;
  failed: number;
  errors: number;
  timed_out: boolean;
}

interface ProofTableProps {
  runs: ProofRun[];
  /** Accessible name; two tables can sit on one pair. */
  label?: string;
}

type Outcome = 'pass' | 'fail' | 'none';

const outcome = (run: ProofRun): { state: Outcome; text: string } => {
  if (run.timed_out) return { state: 'fail', text: 'timed out' };
  const bad = run.failed + run.errors;
  if (bad > 0) {
    return { state: 'fail', text: run.passed > 0 ? `${bad} failed, ${run.passed} passed` : `${bad} failed` };
  }
  return run.passed > 0 ? { state: 'pass', text: `${run.passed} passed` } : { state: 'none', text: 'no tests ran' };
};

const ROWS = [
  ['a', 'A'],
  ['b', 'B'],
  ['merge', 'A+B'],
] as const;

/**
 * The proof in three rows: the tests pass on branch A, pass on branch B and
 * fail on the merge of both. Other checkouts live in the run details.
 */
export const ProofTable = ({ runs, label = 'Test results per checkout' }: ProofTableProps) => {
  const rows = ROWS.flatMap(([target, side]) => {
    const run = runs.find((r) => r.target === target);
    return run ? [{ target, side, ref: run.ref, ...outcome(run) }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <table className="proof" aria-label={label}>
      <thead className="sr-only">
        <tr>
          <th scope="col">Side</th>
          <th scope="col">Checkout</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.target} data-outcome={row.state}>
            <td className="proof-side">{row.side}</td>
            <td className="proof-ref">{row.target === 'merge' ? 'merged' : row.ref}</td>
            <td className="proof-result">{row.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
