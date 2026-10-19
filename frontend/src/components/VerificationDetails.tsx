import type { Verification, VerifyRun } from '../types';
import { ProofStrip } from './ProofStrip';
import { confirmingRuns } from '../utils/verification';
import { DocsSources } from './DocsSources';

interface VerificationDetailsProps {
  verification: Verification;
}

const BADGE: Record<Verification['status'], { label: string; className: string }> = {
  confirmed: { label: 'Confirmed by intent test', className: 'badge badge-confirmed' },
  suspected: { label: 'Suspected: intent test inconclusive', className: 'badge badge-suspected' },
  error: { label: 'Intent test error', className: 'badge badge-suspected' },
  skipped: { label: 'Intent test skipped', className: 'badge badge-neutral' },
};

const TARGET_LABEL: Record<VerifyRun['target'], string> = {
  a: 'Branch A',
  b: 'Branch B',
  base: 'Merge-base',
  merge: 'Merge A+B',
};

const runSummary = (run: VerifyRun): string => {
  if (run.timed_out) {
    return 'timed out';
  }
  const parts = [`${run.passed} passed`];
  if (run.failed > 0) parts.push(`${run.failed} failed`);
  if (run.errors > 0) parts.push(`${run.errors} errors`);
  return parts.join(', ');
};

/**
 * Nemotron intent-test (verify-by-test) result for one pair: a status badge,
 * the pass/pass/fail proof, and an expandable section with the generated
 * pytest test and the per-checkout outcomes.
 */
export const VerificationDetails = ({ verification }: VerificationDetailsProps) => {
  const badge = BADGE[verification.status];
  const confirmed = verification.status === 'confirmed';
  return (
    <section className="evidence" data-status={verification.status} data-testid="verification">
      <div className="evidence-head">
        <h4>Intent tests written by Nemotron</h4>
        <span className={badge.className}>{badge.label}</span>
      </div>
      <p className="evidence-what">
        A test for what each branch meant to do, kept only if it passes on that branch, then run on the merge.
      </p>
      <p className="evidence-reason">{verification.reason}</p>
      {confirmed && <ProofStrip runs={confirmingRuns(verification)} />}
      {verification.confirming_tests && verification.confirming_tests.length > 0 && (
        <p className="failing-inline">
          Fails on merge: {verification.confirming_tests.join(', ')}
        </p>
      )}
      {verification.test_code && (
        <details className="disclosure">
          <summary>
            Generated test ({verification.attempts} attempt
            {verification.attempts === 1 ? '' : 's'}
            {verification.cached_test ? ', cached' : ''}, {verification.duration_s.toFixed(1)}s)
          </summary>
          {verification.runs.length > 0 && (
            <ul className="run-list">
              {verification.runs.map((run) => (
                <li key={run.target}>
                  <strong>{TARGET_LABEL[run.target]}</strong> ({run.ref}): {runSummary(run)}
                </li>
              ))}
            </ul>
          )}
          <pre className="code-block" tabIndex={0} aria-label="Generated test code">
            <code>{verification.test_code}</code>
          </pre>
          {verification.sandbox && <p className="run-note">Sandbox: {verification.sandbox}</p>}
        </details>
      )}
      {verification.docs_sources && verification.docs_sources.length > 0 && (
        <DocsSources sources={verification.docs_sources} />
      )}
    </section>
  );
};
