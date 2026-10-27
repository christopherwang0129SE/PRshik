import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnalyzeRequest, AnalyzeResponse, HealthResponse, PairRisk } from './types';
import { analyzeRepo, checkHealth, API_BASE_URL } from './services/api';
import { analyzeStream, StreamUnavailableError } from './services/stream';
import { classifyRepoInput } from './utils/repo';
import { describeError, BACKEND_START_COMMAND } from './utils/errors';
import { rankPairs, summaryLine } from './utils/verdict';
import { modelFailure } from './utils/agent';
import { activeStage, finishRun, formatClock, initialRun, pairKey, reduceRun } from './utils/run';
import type { RunState } from './utils/run';
import { formatHash, parseHash } from './utils/hash';
import { AgentStatus } from './components/AgentStatus';
import { Pipeline } from './components/Pipeline';
import { PairIndex } from './components/PairIndex';
import { PairDetail } from './components/PairDetail';
import { RunSummary } from './components/RunSummary';
import { ErrorPanel } from './components/ErrorPanel';
import { clearPairDiffCache } from './services/pairDiffCache';
import { RepositoryBrowser } from './components/RepositoryBrowser';
import { readHistory, storeHistory } from './services/history';
import type { SavedRun } from './services/history';
import './App.css';
import { advancedView } from './utils/presentation';

// Demo repo paths, injected by Vite (see vite.config.ts `define`).
// An empty string hides that button.
const DEMO_REPO_PATH: string = import.meta.env.VITE_DEMO_REPO_PATH ?? '';
const API_DEMO_REPO_PATH: string = import.meta.env.VITE_API_DEMO_REPO_PATH ?? '';

type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

interface Target {
  repo: string;
  base: string;
  source: Pick<AnalyzeRequest, 'repo_path' | 'repo_url'>;
}

const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');

/** Below this width the pair list and the detail stack. */
const STACKED = '(max-width: 959px)';

function App() {
  const advanced = advancedView();
  const [history, setHistory] = useState<SavedRun[]>(readHistory);
  const historyRef = useRef(history);
  const [historyWarning, setHistoryWarning] = useState('');
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [healthRetry, setHealthRetry] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamed, setStreamed] = useState(true);
  const [run, setRun] = useState<RunState>(initialRun);
  const [response, setResponse] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const repoRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // A pair named in the URL, selected once the run has scored it.
  const wantedPair = useRef<string | null>(null);
  // Bumped per request so a slow, superseded response is ignored.
  const requestId = useRef(0);

  const loading = phase === 'running';
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selectedKey;
  }, [selectedKey]);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await checkHealth();
      setHealth(res);
    } catch {
      setHealth(null);
      setHealthRetry((attempt) => attempt + 1);
    } finally {
      setHealthChecked(true);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    const poll = async () => {
      try {
        const res = await checkHealth();
        if (!stopped) {
          setHealth(res);
          setHealthChecked(true);
        }
      } catch {
        if (!stopped) {
          setHealthChecked(true);
          timer = setTimeout(poll, delay);
          delay = Math.min(delay * 2, 10000);
        }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [healthRetry]);

  // Elapsed clock while an analysis runs.
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  // Announce stage changes, not every tick of the clock.
  const stageTitle = loading ? activeStage(run)?.title : undefined;
  useEffect(() => {
    if (stageTitle) {
      // eslint-disable-next-line react/set-state-in-effect
      setAnnouncement(`${stageTitle} running.`);
    }
  }, [stageTitle]);

  // Move focus to the outcome so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (phase === 'done') summaryRef.current?.focus({ preventScroll: true });
    if (phase === 'error') errorRef.current?.focus();
  }, [phase]);

  const writeHash = (t: Target | null, key: string | null) => {
    if (!t) return;
    const [a, b] = key ? key.split('..') : [];
    const hash = formatHash({ repo: t.repo, base: t.base, pair: a && b ? { a, b } : undefined });
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
  };

  const runAnalysis = async (repo: string, base: string) => {
    const repoField = classifyRepoInput(repo);
    if (!repoField.repo_url && !repoField.repo_path) {
      setFieldError('Enter a repository path or URL, or choose a demo.');
      repoRef.current?.focus();
      return;
    }
    const baseName = base.trim() || 'main';
    const request: AnalyzeRequest = { ...repoField, base_branch: baseName };
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const nextTarget: Target = { repo: repo.trim(), base: baseName, source: repoField };
    clearPairDiffCache();
    setRestoredAt(null);
    setTarget(nextTarget);
    setFieldError(null);
    setError(null);
    setResponse(null);
    setRun(initialRun());
    setStreamed(true);
    setElapsed(0);
    setPhase('running');
    setAnnouncement('Analysis started.');
    if (!wantedPair.current) setSelectedKey(null);
    writeHash(nextTarget, wantedPair.current);

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      pipelineRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    );

    const onEvent = (event: Parameters<typeof reduceRun>[1]) => {
      if (id !== requestId.current) return;
      setRun((r) => reduceRun(r, event));
      if (event.type === 'pair') {
        // First scored pair, or the one the URL asked for: open it.
        const key = pairKey(event.pair);
        setSelectedKey((current) => {
          if (wantedPair.current) return wantedPair.current === key ? key : current;
          return current ?? key;
        });
      }
    };

    try {
      let result: AnalyzeResponse;
      try {
        result = await analyzeStream(request, onEvent, controller.signal);
      } catch (err) {
        if (!(err instanceof StreamUnavailableError)) throw err;
        if (id !== requestId.current) return;
        setStreamed(false);
        result = await analyzeRepo(request, controller.signal);
      }
      if (id !== requestId.current) return;
      const saved: SavedRun = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...nextTarget, result };
      const nextHistory = [saved, ...historyRef.current].slice(0, 12);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      if (!storeHistory(nextHistory)) {
        setHistoryWarning('Browser storage is unavailable or full. History is kept for this session only.');
      }
      setResponse(result);
      setRun((r) => finishRun(r, result));
      const ranked = rankPairs(result.pairs);
      const keys = ranked.map(pairKey);
      const wanted = wantedPair.current;
      const current = selectedRef.current;
      wantedPair.current = null;
      const chosen =
        wanted && keys.includes(wanted) ? wanted : current && keys.includes(current) ? current : keys[0] ?? null;
      setSelectedKey(chosen);
      writeHash(nextTarget, chosen);
      setPhase('done');
      setAnnouncement(`Analysis finished. ${summaryLine(result.pairs)}`);
    } catch (err) {
      if (id !== requestId.current) return;
      if (isAbort(err)) {
        setPhase('cancelled');
        setAnnouncement('Analysis cancelled.');
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setPhase('error');
      setAnnouncement(`Analysis failed. ${describeError(message, API_BASE_URL).title}.`);
      // A failed analyze may mean the backend went down: refresh the header.
      fetchHealth();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  // A shared link (#repo=...&pair=a..b) re-runs that analysis and opens the pair.
  useEffect(() => {
    const state = parseHash(window.location.hash);
    if (!state.repo) return;
    wantedPair.current = state.pair ? `${state.pair.a}..${state.pair.b}` : null;
    /* eslint-disable react/set-state-in-effect */
    setRepoInput(state.repo);
    if (state.base) setBaseBranch(state.base);
    /* eslint-enable react/set-state-in-effect */
    runAnalysis(state.repo, state.base ?? 'main');
    return () => abortRef.current?.abort();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editing the hash by hand (or back/forward) switches the open pair.
  useEffect(() => {
    const onHash = () => {
      const state = parseHash(window.location.hash);
      if (state.pair) setSelectedKey(`${state.pair.a}..${state.pair.b}`);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectPair = (pair: PairRisk) => {
    const key = pairKey(pair);
    setSelectedKey(key);
    writeHash(target, key);
    // Stacked layout: the detail sits below the list, take the reader there.
    if (window.matchMedia?.(STACKED).matches) {
      requestAnimationFrame(() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        detailRef.current?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        detailRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    wantedPair.current = null;
    runAnalysis(repoInput, baseBranch);
  };

  const handleTryDemo = (path: string) => {
    if (!path) return;
    wantedPair.current = null;
    setRepoInput(path);
    setBaseBranch('main');
    runAnalysis(path, 'main');
  };

  const restoreRun = (saved: SavedRun) => {
    ++requestId.current;
    clearPairDiffCache();
    const chosen = rankPairs(saved.result.pairs)[0];
    const key = chosen ? pairKey(chosen) : null;
    setRepoInput(saved.repo);
    setBaseBranch(saved.base);
    setTarget({ repo: saved.repo, base: saved.base, source: saved.source });
    setResponse(saved.result);
    setRun(finishRun(initialRun(), saved.result));
    setSelectedKey(key);
    setError(null);
    setPhase('done');
    setElapsed(saved.result.usage?.elapsed_s ?? 0);
    setRestoredAt(saved.createdAt);
    writeHash(saved, key);
    requestAnimationFrame(() => summaryRef.current?.focus({ preventScroll: true }));
    setAnnouncement('Saved analysis opened. Run Analyze for a fresh verdict.');
  };

  const backendOffline = healthChecked && !health;
  const gitOnly = health !== null && !(health.nebius_ready && health.nebius_enabled);
  const errorHelp = error ? describeError(error, API_BASE_URL) : null;
  const pairs = response?.pairs ?? run.pairs;
  const failure = modelFailure(health, pairs);
  const modelReady = health !== null && !gitOnly && !failure;
  const selected = pairs.find((p) => pairKey(p) === selectedKey) ?? null;
  const pending = loading ? Math.max(0, (run.branches.length * (run.branches.length - 1)) / 2 - run.pairs.length) : 0;
  const showWorkspace = target && (response || (loading && (run.pairs.length > 0 || run.branches.length > 1)));
  const pipelineMode = phase === 'idle' ? 'idle' : loading ? (streamed ? 'live' : 'blind') : 'finished';
  const showPipeline = phase !== 'error';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="wordmark" href="/" aria-label="MergeGuard home">
            <span className="wordmark-glyph" aria-hidden="true">
              <span></span>
              <span></span>
            </span>
            MergeGuard
          </a>
          <AgentStatus health={health} pairs={pairs} checked={healthChecked && !(import.meta.env.PROD && !health)} />
        </div>
      </header>

      <main className="page" id="main" tabIndex={-1}>
        {gitOnly && (
          <p className="mode-note" role="status">
            <strong>Git-only scores.</strong> This demo runs without a Nebius Token Factory key, so Nemotron and Tavily are off. Risk comes from git hunk overlap and the branch tests still run.
          </p>
        )}
        <section className="intake" data-phase={phase} aria-labelledby="intake-heading">
          <h1 id="intake-heading" className={phase === 'idle' ? 'intake-title' : 'intake-title is-compact'}>
            Find branch pairs that merge cleanly and still break
          </h1>
          {phase === 'idle' && (
            <p className="intake-lede">
              {modelReady
                ? 'MergeGuard diffs every branch against the base, asks Nemotron which pairs interact, and proves a conflict by running tests on the merged code.'
                : 'MergeGuard diffs every branch against the base, scores pairs from git hunk overlap, and proves a conflict by running each branch\'s tests on the merged code.'}
            </p>
          )}

          {advanced && health?.demo_mode !== true && <form onSubmit={handleSubmit} className="repo-form" noValidate aria-label="Analyze a repository">
            <div className="field field-repo">
              <label htmlFor="repo-input">Repository</label>
              <input
                id="repo-input"
                ref={repoRef}
                type="text"
                name="repo"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="/path/to/repo or https://github.com/owner/repo"
                value={repoInput}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'repo-hint repo-error' : 'repo-hint'}
                onChange={(e) => {
                  setRepoInput(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
              <p className="field-hint" id="repo-hint">
                Local path, git URL, GitHub repository or pull request URL.
              </p>
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
                autoCapitalize="off"
                spellCheck={false}
                placeholder="main"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || (import.meta.env.PROD && !health)}>
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>}

          {(DEMO_REPO_PATH || API_DEMO_REPO_PATH) && (
            <div className="demos" role="group" aria-label="Bundled demos">
              {DEMO_REPO_PATH && (
                <div className="demo">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleTryDemo(DEMO_REPO_PATH)}
                    disabled={loading || (import.meta.env.PROD && !health)}
                    aria-describedby={phase === "idle" ? "demo-note" : undefined}
                  >
                    Try demo repo
                  </button>
                  {phase === "idle" && (
                    <p className="demo-note" id="demo-note">
                      Checkout service. Two branches change how discount and tax combine; git merges them cleanly.
                    </p>
                  )}
                </div>
              )}
              {advanced && API_DEMO_REPO_PATH && (
                <div className="demo">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleTryDemo(API_DEMO_REPO_PATH)}
                    disabled={loading || (import.meta.env.PROD && !health)}
                    aria-describedby={phase === "idle" ? "api-demo-note" : undefined}
                  >
                    Try API demo (Tavily)
                  </button>
                  {phase === "idle" && (
                    <p className="demo-note" id="api-demo-note">
                      {gitOnly
                        ? 'Payments client on requests and pydantic. Tavily lookup needs a Nebius key; not enabled in this demo.'
                        : 'Payments client on requests and pydantic. Tavily looks up the library docs Nemotron reads.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {import.meta.env.PROD && !health && (
            <div className="notice" role="status">
              <p><strong>Waking up the free server, first load can take ~1 minute</strong></p>
              <p>We’re checking the connection automatically. Demo buttons will be ready when the server responds.</p>
            </div>
          )}

          {backendOffline && phase !== 'error' && import.meta.env.DEV && !import.meta.env.PROD && (
            <div className="inline-problem">
              <p>
                <strong>The backend isn&apos;t answering</strong> at <code>{API_BASE_URL || window.location.origin}</code>. Start it from the
                repository root:
              </p>
              <pre className="command" role="region" tabIndex={0} aria-label="Command to start the backend">
                <code>{BACKEND_START_COMMAND}</code>
              </pre>
            </div>
          )}
        </section>

        {advanced && <RepositoryBrowser demoMode={health?.demo_mode !== false} disabled={loading || (import.meta.env.PROD && !health)} onAnalyze={(repo, base) => {
          wantedPair.current = null;
          setRepoInput(repo); setBaseBranch(base); runAnalysis(repo, base);
        }} />}
        {(advanced || history.length > 0) && <section className="library" aria-label="Analysis history">
          <details>
            <summary>Analysis history <span className="tabular">({history.length})</span></summary>
            <div className="library-body">
              <p>The last 12 completed analyses are saved in this browser. Failed and cancelled runs are excluded.</p>
              {historyWarning && <p role="status">{historyWarning}</p>}
              {history.length === 0 ? <p>No completed analyses yet. Choose a demo or analyze a repository.</p> : <>
                <ul className="library-list">{history.map((saved) => <li key={saved.id}>
                  <div><strong>{saved.repo}</strong><p><time dateTime={saved.createdAt}>{new Date(saved.createdAt).toLocaleString()}</time> · {saved.base}</p><p>{summaryLine(saved.result.pairs)}</p></div>
                  <button className="btn" disabled={loading || (import.meta.env.PROD && !health)} onClick={() => restoreRun(saved)}>Open saved analysis</button>
                </li>)}</ul>
                <button className="btn" onClick={() => {
                  historyRef.current = [];
                  setHistory([]);
                  setHistoryWarning(storeHistory([]) ? '' : 'Could not clear browser storage. History may return after reload.');
                }}>Clear history</button>
              </>}
            </div>
          </details>
        </section>}
        {restoredAt && <p className="notice" role="status">Saved verdict from {new Date(restoredAt).toLocaleString()}. Diffs load from the repository as it is now. Run Analyze to check current branch heads.</p>}

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {failure && <p className="mode-note degraded-note" role="status">Nemotron unavailable: {failure === 'auth_failed' ? 'Token Factory authentication failed.' : failure === 'unreachable' ? 'Token Factory could not be reached.' : 'The model call failed.'} Scores fall back to git + branch tests.</p>}
        {phase === 'done' && response && target && (
          <RunSummary response={response} target={target.repo} headingRef={summaryRef} modelOk={health?.nebius_status === 'ok' && !failure} />
        )}

        <div ref={pipelineRef} className="pipeline-slot">
          {showPipeline && (
            <Pipeline
              run={run}
              mode={pipelineMode}
              elapsedS={elapsed}
              onCancel={loading ? cancel : undefined}
              gitOnly={gitOnly}
            />
          )}
        </div>

        {phase === 'cancelled' && (
          <section className="notice" aria-labelledby="cancel-heading">
            <h2 id="cancel-heading">Analysis cancelled after {formatClock(elapsed)}</h2>
            <p>
              The backend may finish the current step on its own; nothing was saved. Run it again with Analyze or a
              demo button.
            </p>
          </section>
        )}

        {errorHelp && phase === 'error' && (
          <ErrorPanel ref={errorRef} help={errorHelp} onRetry={() => runAnalysis(target?.repo ?? repoInput, target?.base ?? baseBranch)} />
        )}

        {showWorkspace && target && (
          <div className="workspace" data-live={loading || undefined}>
            <PairIndex
              pairs={pairs}
              selectedKey={selectedKey}
              onSelect={selectPair}
              live={loading}
              pendingCount={pending}
            />
            <div className="workspace-detail">
              {selected ? (
                <PairDetail
                  key={`${requestId.current}:${pairKey(selected)}`}
                  pair={selected}
                  source={target.source}
                  baseBranch={response?.base_branch ?? run.baseBranch ?? target.base}
                  usage={response?.usage ?? null}
                  provisional={loading && !(selected.branch_tests && (selected.verification || ['done', 'skipped'].includes(run.stages.verify.state)))}
                  headingRef={detailRef}
                  gitOnly={gitOnly}
                />
              ) : (
                <p className="detail-empty">
                  {loading
                    ? modelReady
                      ? 'Pairs appear here as Nemotron scores them.'
                      : 'Pairs appear here as git scores them.'
                    : pairs.length === 0
                      ? 'Analyze a repository with at least two branches besides the base to see pair evidence.'
                      : 'Choose a pair to see the evidence.'}
                </p>
              )}
            </div>
          </div>
        )}
        {phase === 'done' && <section className="library" aria-labelledby="credibility-heading">
          <div className="library-body">
            <h2 id="credibility-heading">Beyond the demo</h2>
            <p>Replayable public-repository cases include daimon, KISS, Elastic and qwen-code. The checked-in report records exact commits, test evidence, costs and limitations.</p>
            <p><a href="https://github.com/christopherwang0129SE/mergeguard/blob/main/docs/HALL_OF_FAME.md" target="_blank" rel="noreferrer">Read the real-repo evidence</a></p>
            <p>Before merging, check what the branches assume together. A clean git merge is only the beginning.</p>
          </div>
        </section>}
      </main>

      <footer className="footer">
        <p><a href={advanced ? '/' : '/?advanced=1'}>{advanced ? 'Demo view' : 'More tools'}</a></p>
        <p>
          {gitOnly ? (
            <>
              Git scoring and branch tests run without a model. Using Nemotron, intent tests, the resolver, or Tavily
              needs a Nebius key; not enabled in this demo. API at <code>{API_BASE_URL || window.location.origin}</code>.
            </>
          ) : (
            <>
              Risk explanations and intent tests by NVIDIA Nemotron 3 Super on Nebius Token Factory. Library docs from
              Tavily. API at <code>{API_BASE_URL || window.location.origin}</code>.
            </>
          )}
        </p>
      </footer>
    </div>
  );
}

export default App;
