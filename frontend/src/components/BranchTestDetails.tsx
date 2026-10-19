import type { BranchTestRun, BranchTests } from '../types';
import { ProofStrip } from './ProofStrip';

interface BranchTestDetailsProps {
  branchTests: BranchTests;
}

const BADGE: Record<BranchTests['status'], { label: string; className: string }> = {
  confirmed: {
    label: 'Confirmed by branch test',
    className: 'badge badge-confirmed badge-branch-test',
  },
  passed: { label: 'Branch tests pass on merge', className: 'badge badge-neutral' },
  skipped: { label: 'Branch tests skipped', className: 'badge badge-neutral' },
  unsupported: { label: 'Branch tests unsupported', className: 'badge badge-neutral' },
  error: { label: 'Branch tests error', className: 'badge badge-suspected' },
};

const TARGET_LABEL: Record<BranchTestRun['target'], string> = {
  a: 'Branch A',
  b: 'Branch B',
  base: 'Merge-base',
  merge: 'Merge A+B',
  'merge-rerun': 'Merge A+B (rerun)',
};

const runSummary = (run: BranchTestRun): string => {
  if (run.timed_out) {
    return 'timed out';
  }
  if (run.problem && run.passed + run.failed + run.errors === 0) {
    return `no results: ${run.problem}`;
  }
  const parts = [`${run.passed} passed`];
  if (run.failed > 0) parts.push(`${run.failed} failed`);
  if (run.errors > 0) parts.push(`${run.errors} errors`);
  return parts.join(', ');
};

/**
 * Deterministic "branch tests on merge" result: the test files each branch
 * added or modified, run on its own branch and on the A+B merge. Kept
 * visually separate from the Nemotron intent test.
 */
export const BranchTestDetails = ({ branchTests }: BranchTestDetailsProps) => {
  const badge = BADGE[branchTests.status];
  const confirmed = branchTests.status === 'confirmed';
  return (
    <section className="evidence" data-status={branchTests.status} data-testid="branch-tests">
      <div className="evidence-head">
        <h4>The branches&apos; own tests</h4>
        <span className={badge.className}>{badge.label}</span>
      </div>
      <p className="evidence-what">
        Test files each branch changed, run on its branch and on the merge. No LLM involved.
      </p>
      {!confirmed && <p className="evidence-reason">{branchTests.reason}</p>}
      {confirmed && <ProofStrip runs={branchTests.runs} />}
      {branchTests.confirming.length > 0 && (
        <ul className="failing-tests" aria-label="Branch tests failing on merge">
          {branchTests.confirming.map((failure) => (
            <li key={failure.test_id}>
              <code className="test-id">{failure.test_id}</code>
              <span className="failing-meta">
                {failure.branch}&apos;s test
                {failure.excerpt ? (
                  <>
                    {': '}
                    <code className="excerpt">{failure.excerpt}</code>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {branchTests.runs.length > 0 && (
        <details className="disclosure">
          <summary>Branch test runs ({branchTests.duration_s.toFixed(1)}s)</summary>
          {confirmed && <p className="evidence-reason">{branchTests.reason}</p>}
          <ul className="run-list">
            {branchTests.runs.map((run, index) => (
              <li key={`${run.target}-${run.runner ?? 'pytest'}-${run.package ?? ''}-${index}`}>
                <strong>{TARGET_LABEL[run.target]}</strong> ({run.ref}
                {run.runner && run.runner !== 'pytest'
                  ? `, ${run.runner} in ${run.package || '.'}`
                  : ''}
                , {run.files.length} file
                {run.files.length === 1 ? '' : 's'}): {runSummary(run)}
              </li>
            ))}
          </ul>
          {(branchTests.setup?.length ?? 0) > 0 && (
            <p className="run-note" data-testid="branch-test-setup">
              JS setup
              {(branchTests.install_s ?? 0) > 0 || (branchTests.build_s ?? 0) > 0
                ? ` (install ${(branchTests.install_s ?? 0).toFixed(1)}s, builds ${(branchTests.build_s ?? 0).toFixed(1)}s)`
                : ''}
              : {branchTests.setup?.join('; ')}
            </p>
          )}
          {branchTests.sandbox && <p className="run-note">Sandbox: {branchTests.sandbox}</p>}
        </details>
      )}
    </section>
  );
};
