interface ProofRun {
  target: string;
  ref: string;
  passed: number;
  failed: number;
  errors: number;
  timed_out: boolean;
}

interface ProofStripProps {
  runs: ProofRun[];
}

const outcome = (run: ProofRun): { ok: boolean; text: string } => {
  if (run.timed_out) return { ok: false, text: 'timed out' };
  const bad = run.failed + run.errors;
  if (bad > 0) return { ok: false, text: `${bad} failed` };
  return { ok: run.passed > 0, text: run.passed > 0 ? `${run.passed} passed` : 'no tests ran' };
};

/**
 * The proof in one row: tests pass on branch A, pass on branch B, and fail
 * on the merge of both. Only the three checkouts that make the argument.
 */
export const ProofStrip = ({ runs }: ProofStripProps) => {
  const cells = (
    [
      ['a', null],
      ['b', null],
      ['merge', 'On the merge'],
    ] as const
  ).flatMap(([target, label]) => {
    const run = runs.find((r) => r.target === target);
    return run ? [{ target, label: label ?? `On ${run.ref}`, ...outcome(run) }] : [];
  });
  if (cells.length === 0) return null;

  return (
    <ul className="proof-strip" aria-label="Test results per checkout">
      {cells.map((cell) => (
        <li key={cell.target} className="proof-cell" data-ok={cell.ok}>
          <span className="proof-mark" aria-hidden="true">
            {cell.ok ? '✓' : '✗'}
          </span>
          <span className="proof-label">{cell.label}</span>
          <span className="proof-result">{cell.text}</span>
        </li>
      ))}
    </ul>
  );
};
