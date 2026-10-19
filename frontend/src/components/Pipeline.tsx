import { STEPS } from '../utils/pipeline';

export type PipelineMode = 'intro' | 'running' | 'done';

interface PipelineProps {
  mode: PipelineMode;
  /** Running mode: index of the step in progress. */
  activeStep?: number;
  /** Running mode: seconds since the request started. */
  elapsedS?: number;
  /** Done mode: one result line per step. */
  facts?: [string, string, string];
  /** Done mode: the test step was reached but no test ran. */
  testsSkipped?: boolean;
}

const HEADINGS: Record<PipelineMode, string> = {
  intro: 'How it works',
  running: 'Analyzing',
  done: 'How this result was reached',
};

type StepState = 'todo' | 'active' | 'done' | 'skipped';

const stateOf = (mode: PipelineMode, index: number, active: number, testsSkipped: boolean): StepState => {
  if (mode === 'done') return testsSkipped && index === STEPS.length - 1 ? 'skipped' : 'done';
  if (mode === 'intro') return 'todo';
  if (index < active) return 'done';
  return index === active ? 'active' : 'todo';
};

const STATE_TEXT = { todo: 'Up next', active: 'In progress', done: 'Done', skipped: 'Skipped' } as const;

/**
 * The three-step pipeline, drawn as a commit graph. The same list explains
 * the product on the first screen, tracks progress while the analysis runs,
 * and recaps what each step found once it is done.
 */
export const Pipeline = ({ mode, activeStep = 0, elapsedS = 0, facts, testsSkipped = false }: PipelineProps) => (
  <section className={`pipeline pipeline-${mode}`} aria-labelledby="pipeline-heading">
    <div className="pipeline-head">
      <h2 id="pipeline-heading">{HEADINGS[mode]}</h2>
      {mode === 'running' && (
        <p className="pipeline-elapsed">
          <span>
            <span className="tabular">{elapsedS}</span> s elapsed
          </span>
          <span className="pipeline-expect">Usually 20 to 60 s with live model calls</span>
        </p>
      )}
    </div>
    <ol className="pipeline-steps">
      {STEPS.map((step, index) => {
        const state = stateOf(mode, index, activeStep, testsSkipped);
        return (
          <li key={step.title} className="pipeline-step" data-state={state}>
            <span className="pipeline-node" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'skipped' ? '–' : index + 1}
            </span>
            <div className="pipeline-body">
              <h3 className="pipeline-title">
                {mode === 'running' && state === 'active' ? step.running : step.title}
                {(mode === 'running' || state === 'skipped') && <span className="sr-only">: {STATE_TEXT[state]}</span>}
              </h3>
              <p className="pipeline-text">
                {mode === 'done' && facts ? facts[index] : step.description}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  </section>
);
