import { Fragment } from 'react';
import type { RunState, StageProgress } from '../utils/run';
import { activeStage, formatClock, formatDuration, skippedModelDetail, stagesFor } from '../utils/run';

export type PipelineMode = 'idle' | 'live' | 'blind' | 'finished';

interface PipelineProps {
  run: RunState;
  /**
   * idle: nothing run yet, the stages explain themselves.
   * live: stage events stream in. blind: the backend answers in one
   * response, so no stage is known until it ends. finished: the run is over.
   */
  mode: PipelineMode;
  elapsedS?: number;
  onCancel?: () => void;
  /** Health says Nemotron is off. Model steps must not claim they will run. */
  gitOnly?: boolean;
  model?: string | null;
}

const stateText = (stage: StageProgress, mode: PipelineMode): string => {
  switch (stage.state) {
    case 'running':
      return 'running';
    case 'done':
      return stage.startedAt !== undefined && stage.endedAt !== undefined
        ? `✓ ${formatDuration(stage.endedAt - stage.startedAt)}`
        : 'done';
    case 'skipped':
      return 'skipped';
    default:
      return mode === 'live' || mode === 'blind' ? 'waiting' : mode === 'finished' ? 'not run' : '';
  }
};

const durationOf = (stage: StageProgress): number | null => {
  if (stage.startedAt === undefined || stage.endedAt === undefined) return null;
  return Math.max(0, stage.endedAt - stage.startedAt);
};

/**
 * The analysis pipeline as a row of stages that light up as the stream
 * reports them. Before a run it doubles as the explanation of what will
 * happen; after a run it keeps the time each stage took.
 */
export const Pipeline = ({ run, mode, elapsedS = 0, onCancel, gitOnly = false, model }: PipelineProps) => {
  const running = mode === 'live' || mode === 'blind';
  const stages = stagesFor(gitOnly);
  const gitScored = run.pairs.some(p => p.git_score != null);
  const modelPairs = run.pairs.filter(p => p.model_score != null || p.score_source === 'model');
  const modelCached = modelPairs.length > 0 && modelPairs.every(p => p.model_cached === true);
  const timingSummary = (['model', 'verify'] as const).map((id) => {
    const def = stages.find(stage => stage.id === id);
    const duration = durationOf(run.stages[id]);
    if (!def || duration === null) return null;
    return `${def.title} ${formatDuration(duration)}${id === 'model' && modelCached ? ' (cached)' : ''}`;
  }).filter((part): part is string => part !== null);
  const historySummary = [
    `${stages.length} stages`,
    ...(elapsedS > 0 ? [formatDuration(elapsedS)] : []),
    ...timingSummary,
  ].join(' · ');
  const currentStage = mode === 'live' ? activeStage(run) : undefined;
  const currentStageDetail = currentStage ? run.stages[currentStage.id].detail : null;
  const renderStages = (compact: boolean) => (
    <ol className={compact ? "run-stepper" : "stages"} aria-label={compact ? "Run stages" : undefined}>
        {stages.map((def) => {
          const stage = run.stages[def.id];
          const modelFailed = def.id === 'model' && run.pairs.some(p => p.fallback_reason === 'model_error' || p.fallback_reason === 'unparsable');
          const modelDone = def.id === 'model' && stage.state !== 'running' && run.pairs.some(p => p.model_score != null);
          const noKeySkipped = def.id === 'model' && gitOnly && (mode === 'finished' || stage.state === 'skipped' || run.pairs.length > 0);
          const state = modelFailed ? 'failed' : modelDone ? 'done' : noKeySkipped ? 'skipped' : stage.state;
          const text = modelFailed ? 'failed' : modelDone ? (stage.startedAt !== undefined && stage.endedAt !== undefined ? stateText(stage, mode) : 'done') : noKeySkipped ? 'skipped (no key)' : stateText(stage, mode);
          const detail =
            gitOnly && state === 'skipped' && (def.id === 'model' || def.id === 'verify')
              ? skippedModelDetail(def.id, stage.detail)
              : stage.detail;
          const duration = durationOf(stage);
          const instant = state === 'done' && duration !== null && formatDuration(duration) === '0.0s';
          return (
            <Fragment key={def.id}>
            {mode === 'idle' && def.id === 'model' && <li className="stage" data-state={gitScored ? 'done' : 'idle'} data-testid={compact ? undefined : "stage-git"}>
              <span className="stage-bar" aria-hidden="true"></span>
              <span className="stage-title">Git score</span>
              {gitScored && <span className="stage-state">done</span>}
              {mode === 'idle' && <span className="stage-about">Scores git hunk overlap for every pair.</span>}
            </li>}
            <li className="stage" data-state={state} data-instant={instant ? 'true' : undefined} data-testid={compact ? undefined : `stage-${def.id}`}>
              <span className="stage-bar" aria-hidden="true"></span>
              <span className="stage-title">{def.title}</span>
              {text && <span className="stage-state tabular">{text}</span>}
              {mode === 'idle' ? (
                <span className="stage-about">{def.about}</span>
              ) : (
                detail && <span className="stage-detail">{detail}</span>
              )}
            </li>
            </Fragment>
          );
        })}
      </ol>
  );
  const content = (
    <section className="pipeline" data-mode={mode} aria-labelledby="pipeline-heading" data-testid="pipeline">
      <div className="pipeline-head">
        <h2 id="pipeline-heading" className="pipeline-title">
          {mode === 'idle' ? 'How a run works' : 'Pipeline'}
        </h2>
      </div>
      {mode === 'idle' ? <>
        <ol className="pipeline-beats">{[
          ['Find pairs', 'Static prefilter, no LLM'],
          [gitOnly ? 'Git scores' : 'Nemotron scores & explains', gitOnly ? 'Model unavailable' : 'Review shared code'],
          ['Prove by test on A, B, base, A+B', 'Compare test outcomes'],
          ['Cost, cached', 'Report usage and cache hits'],
        ].map(([title, description], i) => <li key={title}><span>{i + 1}</span><h3>{title}</h3><p>{description}</p></li>)}</ol>
        <details><summary>Full pipeline</summary>{renderStages(false)}</details>
      </> : renderStages(false)}
      {mode === 'blind' && (
        <p className="pipeline-note">
          This backend has no live progress stream, so stages show when the whole run finishes.
        </p>
      )}
    </section>
  );
  return mode === 'idle' ? content : (
    <>
      {running && <section className="stepper-panel" aria-label="Pipeline progress">
        {running && (
          <div className="pipeline-head">
            <h2 className="pipeline-title">Analyzing</h2>
            <div className="pipeline-clock">
              <span className="sr-only">Elapsed</span>
              <span className="clock tabular" data-testid="elapsed">{formatClock(elapsedS)}</span>
              {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
            </div>
          </div>
        )}
        {renderStages(true)}
        {currentStage && (
          <p className="pipeline-live-note" aria-live="polite">
            <strong>{currentStage.title} is running…</strong>{' '}
            {currentStageDetail || currentStage.about}
          </p>
        )}
      </section>}
      <details className="pipeline-history">
        <summary>Run details <span>{historySummary}</span></summary>
        {model && <p className="run-model mono">Model: {model}</p>}
        {content}
      </details>
    </>
  );
};
