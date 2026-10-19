import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnalyzeRequest, AnalyzeResponse, HealthResponse } from './types';
import { analyzeRepo, checkHealth, API_BASE_URL } from './services/api';
import { classifyRepoInput } from './utils/repo';
import { describeError, BACKEND_START_COMMAND } from './utils/errors';
import { noTestsRan, pipelineFacts, verdictFor } from './utils/verdict';
import { BranchLights } from './components/BranchLights';
import { PairList } from './components/PairList';
import { SummaryBar } from './components/SummaryBar';
import { AgentStatus } from './components/AgentStatus';
import { Pipeline } from './components/Pipeline';
import { STEPS, estimatedStep } from './utils/pipeline';
import { ErrorPanel } from './components/ErrorPanel';
import './App.css';

// Demo repo path, injected by Vite (see vite.config.ts `define`).
const DEMO_REPO_PATH: string = import.meta.env.VITE_DEMO_REPO_PATH ?? '';

const Logo = () => (
  <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
    <path d="M9 4v24" />
    <path d="M23 4v6c0 6-14 6-14 13" />
    <circle cx="9" cy="6" r="2.6" />
    <circle cx="23" cy="6" r="2.6" />
    <circle cx="9" cy="26" r="3.2" className="logo-merge" />
  </svg>
);

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

  // On a phone the progress sits below the form: bring it into view. A no-op
  // on wide screens, where it is already beside the form.
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
      setFieldError('Enter a repository path or URL, or choose Try demo repo.');
      repoRef.current?.focus();
      return;
    }
    const request: AnalyzeRequest = {
      ...repoField,
      base_branch: baseBranch.trim() || 'main',
    };
    const id = ++requestId.current;
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

  const handleTryDemo = () => {
    if (DEMO_REPO_PATH) {
      setRepoInput(DEMO_REPO_PATH);
      runAnalysis(DEMO_REPO_PATH);
    }
  };

  const backendOffline = healthChecked && !health;
  const mode = loading ? 'running' : response ? 'done' : 'intro';
  const errorHelp = error ? describeError(error, API_BASE_URL) : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-row">
          <a className="brand" href="/" aria-label="MergeGuard home">
            <Logo />
            <span className="brand-name">MergeGuard</span>
          </a>
          <AgentStatus health={health} checked={healthChecked} />
        </div>
      </header>

      <main className="container" id="main">
        <div className="hero">
          <div className="hero-main">
            <h1>Catch the merge conflicts git can&apos;t see</h1>
            <p className="lede">
              Two branches can merge without a single conflict marker and still break each other.
              MergeGuard checks every pair of open branches before you merge, and proves the risky
              ones by running tests on the merged code.
            </p>

            <div className="start-card">
              {DEMO_REPO_PATH && (
                <div className="demo-row">
                  <button type="button" className="btn btn-primary btn-demo" onClick={handleTryDemo} disabled={loading}>
                    Try demo repo
                  </button>
                  <p className="demo-note" id="demo-note">
                    A small checkout service with three branches. Two of them change how discounts and
                    tax combine, and git merges them cleanly.
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="input-form" noValidate aria-labelledby="own-repo-heading">
                <h2 id="own-repo-heading" className="form-heading">
                  {DEMO_REPO_PATH ? 'Or analyze your own repository' : 'Analyze a repository'}
                </h2>
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
                <button type="submit" className="btn btn-secondary btn-analyze" disabled={loading}>
                  {loading ? 'Analyzing…' : 'Analyze'}
                </button>
              </form>
            </div>

            {errorHelp && !loading && (
              <ErrorPanel ref={errorRef} help={errorHelp} onRetry={() => runAnalysis(repoInput)} />
            )}

            {backendOffline && !error && (
              <div className="offline-note">
                <p>
                  <strong>The backend isn&apos;t answering</strong> at {API_BASE_URL}. Start it from the
                  repository root:
                </p>
                <pre className="command">
                  <code>{BACKEND_START_COMMAND}</code>
                </pre>
              </div>
            )}
          </div>

          <div className="hero-side" aria-busy={loading} ref={progressRef}>
            <Pipeline
              mode={mode}
              activeStep={activeStep}
              elapsedS={elapsed}
              facts={response ? pipelineFacts(response) : undefined}
              testsSkipped={response ? noTestsRan(response.pairs) : false}
            />
          </div>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {response && !loading && (
          <div className="results">
            <SummaryBar pairs={response.pairs} usage={response.usage ?? null} headingRef={verdictRef} />
            <BranchLights branches={response.branches} pairs={response.pairs} />
            <PairList pairs={response.pairs} risk_model={response.risk_model ?? null} />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>
            Explanations by NVIDIA Nemotron 3 Super on Nebius Token Factory, grounded with Tavily
            search. Planner and Merger agents are on the roadmap.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
