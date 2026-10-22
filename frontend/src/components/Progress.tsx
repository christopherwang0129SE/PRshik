import { STEPS } from '../utils/pipeline';

interface ProgressProps {
  /** Path or URL being analyzed. */
  target: string;
  baseBranch: string;
  /** Index of the step that is probably running. */
  activeStep: number;
  elapsedS: number;
}

type StepState = 'done' | 'active' | 'todo';

const STATE_TEXT: Record<StepState, string> = { todo: 'up next', active: 'in progress', done: 'done' };

const SHORT = ['Diff branches', 'Explain risky pairs', 'Test the merge'];

/**
 * Inline progress for a running analysis. The backend answers once, so the
 * stage is an estimate from elapsed time, and the text says so.
 */
export const Progress = ({ target, baseBranch, activeStep, elapsedS }: ProgressProps) => (
  <section className="progress" aria-labelledby="progress-heading" aria-busy="true">
    <div className="progress-head">
      <h2 id="progress-heading">Analyzing</h2>
      <p className="progress-elapsed tabular">{elapsedS}s elapsed</p>
    </div>
    <p className="progress-target">
      <code>{target}</code> against <code>{baseBranch}</code>
    </p>
    <ol className="progress-steps">
      {STEPS.map((step, index) => {
        const state: StepState = index < activeStep ? 'done' : index === activeStep ? 'active' : 'todo';
        return (
          <li key={step.title} data-state={state}>
            {SHORT[index]}
            <span className="sr-only">: {STATE_TEXT[state]}</span>
          </li>
        );
      })}
    </ol>
    <p className="progress-note">
      Stage is estimated from elapsed time. A run takes 20 to 60s with live model calls, a few seconds when cached.
    </p>
  </section>
);
