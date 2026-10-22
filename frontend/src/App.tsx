import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnalyzeRequest, AnalyzeResponse, HealthResponse } from './types';
import { analyzeRepo, checkHealth, API_BASE_URL } from './services/api';
import { classifyRepoInput } from './utils/repo';
import { describeError, BACKEND_START_COMMAND } from './utils/errors';
import { pipelineFacts, verdictFor } from './utils/verdict';
import { PairList } from './components/PairList';
import { SummaryBar } from './components/SummaryBar';
import { AgentStatus } from './components/AgentStatus';
import { Progress } from './components/Progress';
import { STEPS, estimatedStep } from './utils/pipeline';
import { ErrorPanel } from './components/ErrorPanel';
import './App.css';

// Demo repo paths, injected by Vite (see vite.config.ts `define`).
// An empty string hides that button.
const DEMO_REPO_PATH: string = import.meta.env.VITE_DEMO_REPO_PATH ?? '';
const API_DEMO_REPO_PATH: string = import.meta.env.VITE_API_DEMO_REPO_PATH ?? '';

function App() {
  const [repoInput, setRepoInput] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [response, setResponse] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  // What the running analysis is looking at, for the progress line.
  const [runTarget, setRunTarget] = useState({ repo: '', base: 'main' });

  const repoRef = useRef<HTMLInputElement>(null);
  const verdictRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  // Bumped per request so a slow, superseded response is ignored.
  const requestId = useRef(0);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await checkHealth();
      setHealth(res);
    } catch (err) {
      // Health unavailable -> Sentinel shows offline. Keep the panel visible.
      setHealth(null);
      console.error('Failed to fetch health', err);
    } finally {
      setHealthChecked(true);
    }
  }, []);

  useEffect(() => {
    // Fetch health on mount so the header reflects /api/health before any
    // analyze. fetchHealth is async, so setHealth runs after the await, not
    // synchronously in the effect.
    // eslint-disable-next-line react/set-state-in-effect
    fetchHealth();
  }, [fetchHealth]);

  // Elapsed-seconds clock while an analysis runs.
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const activeStep = estimatedStep(elapsed);

  // Announce stage changes, not every tick of the clock.
  useEffect(() => {
    if (loading) {
      // eslint-disable-next-line react/set-state-in-effect
      setAnnouncement(`${STEPS[activeStep].running}.`);
    }
  }, [loading, activeStep]);

  // On a phone the progress can sit below the fold: bring it into view.
  useEffect(() => {
    if (!loading) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    progressRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [loading]);

  // Move focus to the outcome so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (response && !loading) verdictRef.current?.focus();
  }, [response, loading]);
  useEffect(() => {
    if (error && !loading) errorRef.current?.focus();
  }, [error, loading]);

  const runAnalysis = async (repo: string) => {
    const repoField = classifyRepoInput(repo);
    if (!repoField.repo_url && !repoField.repo_path) {
      setFieldError('Enter a repository path or URL, or choose a demo.');
      repoRef.current?.focus();
      return;
    }
    const request: AnalyzeRequest = {
      ...repoField,
      base_branch: baseBranch.trim() || 'main',
    };
    const id = ++requestId.current;
    setRunTarget({ repo: repo.trim(), base: request.base_branch ?? 'main' });
    setFieldError(null);
    setError(null);
    setResponse(null);
    setElapsed(0);
    setLoading(true);
    try {
      const res = await analyzeRepo(request);
      if (id !== requestId.current) return;
      setResponse(res);
      setAnnouncement(`Analysis finished. ${verdictFor(res.pairs).headline}.`);
    } catch (err) {
      if (id !== requestId.current) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setAnnouncement(`Analysis failed. ${describeError(message, API_BASE_URL).title}.`);
      // A failed analyze may mean the backend went down: refresh the header.
      fetchHealth();
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runAnalysis(repoInput);
  };

  const handleTryDemo = (path: string) => {
    if (!path) return;
    setRepoInput(path);
    runAnalysis(path);
  };

  const backendOffline = healthChecked && !health;
  const errorHelp = error ? describeError(error, API_BASE_URL) : null;
  const hasDemo = Boolean(DEMO_REPO_PATH || API_DEMO_REPO_PATH);
  // Once a run exists the outcome leads: the intake drops its explanations.
  const compact = loading || Boolean(response) || Boolean(error);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="wordmark" href="/">
            MergeGuard
          </a>
          <AgentStatus health={health} checked={healthChecked} />
        </div>
      </header>

      <main className="page" id="main" tabIndex={-1}>
        <section className={compact ? 'intro is-compact' : 'intro'} aria-labelledby="intro-heading">
          <h1 id="intro-heading">Check branches for conflicts before merging</h1>
          {!compact && (
            <p className="intro-text">
              MergeGuard diffs every branch against the base, asks Nemotron to explain pairs that change related
              code, and runs tests on the merged result to prove conflicts that git merges without a marker.
            </p>
          )}

          <form onSubmit={handleSubmit} className="repo-form" noValidate aria-label="Analyze a repository">
            <div className="field field-repo">
              <label htmlFor="repo-input">Repository path or URL</label>
              <input
                id="repo-input"
                ref={repoRef}
                type="text"
                name="repo"
                autoComplete="off"
                spellCheck={false}
                placeholder="/path/to/repo or https://github.com/org/repo.git"
                value={repoInput}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'repo-error' : undefined}
                onChange={(e) => {
                  setRepoInput(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
              {fieldError && (
                <p className="field-error" id="repo-error">
                  {fieldError}
                </p>
              )}
            </div>
            <div className="field field-base">
              <label htmlFor="base-input">Base branch</label>
              <input
                id="base-input"
                type="text"
                name="base-branch"
                autoComplete="off"
                spellCheck={false}
                placeholder="main"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>

          {hasDemo && (
            <div className="demos" role="group" aria-labelledby="demos-label">
              <p id="demos-label" className="demos-label">
                {compact ? 'Demos' : 'Or run a bundled demo'}
              </p>
              <ul className="demo-list">
                {DEMO_REPO_PATH && (
                  <li>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleTryDemo(DEMO_REPO_PATH)}
                      disabled={loading}
                      aria-describedby={compact ? undefined : 'demo-note'}
                    >
                      Try demo repo
                    </button>
                    {!compact && (
                      <span className="demo-note" id="demo-note">
                        Checkout service. Two branches change how discount and tax combine; git merges them cleanly.
                      </span>
                    )}
                  </li>
                )}
                {API_DEMO_REPO_PATH && (
                  <li>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleTryDemo(API_DEMO_REPO_PATH)}
                      disabled={loading}
                      aria-describedby={compact ? undefined : 'api-demo-note'}
                    >
                      Try API demo (Tavily)
                    </button>
                    {!compact && (
                      <span className="demo-note" id="api-demo-note">
                        Uses requests and pydantic. Two branches disagree on cents versus dollars; Tavily looks up
                        the library docs.
                      </span>
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}

          {backendOffline && !error && (
            <div className="problem problem-quiet">
              <p>
                <strong>The backend isn&apos;t answering</strong> at <code>{API_BASE_URL}</code>. Start it from the
                repository root:
              </p>
              <pre className="code command" role="region" tabIndex={0} aria-label="Command to start the backend">
                <code>{BACKEND_START_COMMAND}</code>
              </pre>
            </div>
          )}
        </section>

        <div ref={progressRef}>
          {loading && (
            <Progress target={runTarget.repo} baseBranch={runTarget.base} activeStep={activeStep} elapsedS={elapsed} />
          )}
        </div>

        {errorHelp && !loading && (
          <ErrorPanel ref={errorRef} help={errorHelp} onRetry={() => runAnalysis(repoInput)} />
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {response && !loading && (
          <div className="results">
            <SummaryBar
              pairs={response.pairs}
              usage={response.usage ?? null}
              headingRef={verdictRef}
              branches={response.branches}
              facts={pipelineFacts(response)}
              riskModel={response.risk_model ?? null}
            />
            <PairList pairs={response.pairs} />
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          Explanations by NVIDIA Nemotron 3 Super on Nebius Token Factory. Library docs from Tavily search. API at{' '}
          <code>{API_BASE_URL}</code>.
        </p>
      </footer>
    </div>
  );
}

export default App;
