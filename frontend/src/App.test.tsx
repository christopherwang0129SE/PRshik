import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import type { AnalyzeResponse } from './types';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const HEALTH = {
  status: 'ok',
  nebius_ready: true,
  nebius_enabled: true,
  nebius_model: 'nvidia/nemotron',
  tavily_ready: false,
};

const RESULT: AnalyzeResponse = {
  base_branch: 'main',
  branches: ['feat/discount-cap', 'feat/tax-before-discount'],
  diffs: [],
  risk_model: 'nvidia/nemotron',
  pairs: [
    {
      branch_a: 'feat/discount-cap',
      branch_b: 'feat/tax-before-discount',
      score: 90,
      level: 'high',
      shared_files: 1,
      overlapping_files: 0,
      collisions: [],
      rationale: 'Cap assumes a pre-tax subtotal.',
      score_source: 'model',
      git_score: 10,
      model_score: 85,
      model_level: 'high',
      fallback_reason: null,
      branch_tests: {
        status: 'confirmed',
        reason: 'fail on merge',
        files_a: [],
        files_b: [],
        unsupported_files: [],
        runs: [],
        confirming: [
          { test_id: 't::a', branch: 'feat/discount-cap', file: 't.py', excerpt: '200 != 198' },
          { test_id: 't::b', branch: 'feat/tax-before-discount', file: 't.py', excerpt: '90 != 88' },
        ],
        merge_conflict: false,
        duration_s: 0.7,
      },
    },
  ],
};

// The demo path is injected via `define` in vite.config.ts: the absolute
// path to demo/checkout-demo, resolved from the config location.
const expectedDemoPath = path.resolve(process.cwd(), '../demo/checkout-demo');
const expectedApiDemoPath = path.resolve(process.cwd(), '../demo/api-demo');

/** Route the fetch mock by URL so call order does not matter. */
const routeFetch = (fetchMock: ReturnType<typeof vi.fn>, analyze: () => Promise<Response>) => {
  fetchMock.mockImplementation((url: string) =>
    String(url).endsWith('/api/health') ? Promise.resolve(jsonResponse(HEALTH)) : analyze()
  );
};

describe('App', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a compact first screen: one-line description, the form and both demos', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);
    expect(screen.getByRole('banner')).toHaveTextContent('MergeGuard');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Check branches for conflicts before merging');
    expect(screen.getByText(/runs tests on the merged result/)).toBeInTheDocument();
    // No marketing hero, no three-step explainer.
    expect(screen.queryByText(/git can't see/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'How it works' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Analyze a repository' })).toBeInTheDocument();
    expect(screen.getByLabelText('Base branch')).toHaveValue('main');
    expect(screen.getByRole('button', { name: 'Analyze' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Try demo repo' })).toHaveAccessibleDescription(/discount and tax/);
    expect(screen.getByRole('button', { name: 'Try API demo (Tavily)' })).toHaveAccessibleDescription(/Tavily/);
    expect(await screen.findByText('Sentinel online')).toBeInTheDocument();
    expect(screen.getByText('git+Nemotron')).toBeInTheDocument();
    // The model id is named once, in the footer, not in the header too.
    expect(screen.queryByText('nvidia/nemotron')).toBeNull();
  });

  it('shows inline progress with the target, the estimated stage and elapsed time', async () => {
    let resolve: (r: Response) => void = () => {};
    routeFetch(fetchMock, () => new Promise<Response>((r) => (resolve = r)));
    render(<App />);
    fireEvent.change(screen.getByLabelText('Repository path or URL'), { target: { value: '/tmp/repo' } });
    fireEvent.change(screen.getByLabelText('Base branch'), { target: { value: 'develop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    const progress = screen.getByRole('region', { name: 'Analyzing' });
    expect(progress).toHaveAttribute('aria-busy', 'true');
    expect(progress).toHaveTextContent('/tmp/repo against develop');
    expect(progress).toHaveTextContent('0s elapsed');
    // The stage is named once, by the step list; the sentence is for the live region.
    expect(progress).not.toHaveTextContent('Sentinel is diffing every branch');
    expect(progress).toHaveTextContent('Diff branches: in progress');
    expect(progress).toHaveTextContent(/estimated/);
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sentinel is diffing every branch.');

    resolve(jsonResponse(RESULT));
    await screen.findByRole('heading', { name: '1 hidden conflict proven by tests' });
    expect(screen.queryByRole('region', { name: 'Analyzing' })).toBeNull();
  });

  it('orders the results: verdict, then the risky pair with its evidence', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try demo repo' }));
    const verdict = await screen.findByRole('heading', { name: '1 hidden conflict proven by tests' });
    const pairHeading = screen.getByRole('heading', { level: 3, name: /feat\/discount-cap\s+and\s+feat\/tax-before-discount/ });
    expect(verdict.compareDocumentPosition(pairHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('nvidia/nemotron', { selector: '.kv-run span' })).toBeInTheDocument();
    // The intake collapses once a run exists: no intro paragraph, no demo notes.
    expect(screen.queryByText(/diffs every branch against the base/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try demo repo' })).not.toHaveAccessibleDescription();
    expect(screen.getByText('Tested 1 pair on the merged code: 1 proven.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Failure in t::a' })).toHaveTextContent('200 != 198');
  });

  it('fills the repo field with the demo path and runs the analysis on "Try demo repo"', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Try demo repo' }));

    const input = screen.getByLabelText('Repository path or URL') as HTMLInputElement;
    expect(input.value).toBe(expectedDemoPath);
    // Progress is shown inline while the request runs.
    expect(screen.getByRole('heading', { name: 'Analyzing' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Analyzing' })).toHaveTextContent(expectedDemoPath);

    const verdict = await screen.findByRole('heading', { name: '1 hidden conflict proven by tests' });
    expect(verdict).toHaveFocus();
    expect(
      screen.getByText(
        'feat/discount-cap and feat/tax-before-discount merge without a git conflict, but 2 tests fail on the merged code.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Analysis finished. 1 hidden conflict proven by tests.');

    const analyzeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/analyze'))!;
    expect(JSON.parse(analyzeCall[1].body)).toEqual({ repo_path: expectedDemoPath, base_branch: 'main' });
  });

  it('fills the repo field with the API demo path on "Try API demo (Tavily)"', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Try API demo (Tavily)' }));

    const input = screen.getByLabelText('Repository path or URL') as HTMLInputElement;
    expect(input.value).toBe(expectedApiDemoPath);
    expect(screen.getByRole('heading', { name: 'Analyzing' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: '1 hidden conflict proven by tests' });

    const analyzeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/analyze'))!;
    expect(JSON.parse(analyzeCall[1].body)).toEqual({ repo_path: expectedApiDemoPath, base_branch: 'main' });
  });

  it('flags an empty repository field without calling the API', () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    const input = screen.getByLabelText('Repository path or URL');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/enter a repository path or url/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/analyze'))).toBe(false);
  });

  it('explains a path that is not a git repository and how to fix it', async () => {
    routeFetch(fetchMock, () =>
      Promise.resolve(jsonResponse({ detail: '/tmp/not-a-repo is not a git repository' }, 400))
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText('Repository path or URL'), { target: { value: '/tmp/not-a-repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    const heading = await screen.findByRole('heading', { name: "That path isn't a git repository" });
    expect(heading).toHaveFocus();
    expect(screen.getByText('/tmp/not-a-repo is not a git repository')).toBeInTheDocument();
    expect(screen.getByText(/python3 demo\/make_demo_repo\.py/)).toBeInTheDocument();
    expect(screen.getByText(/python3 demo\/make_api_demo_repo\.py/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('tells the user to start the backend when it cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    expect(await screen.findByText('Sentinel offline')).toBeInTheDocument();
    expect(screen.getByText(/isn't answering/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Repository path or URL'), { target: { value: '/tmp/repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByRole('heading', { name: "Can't reach the MergeGuard backend" })).toBeInTheDocument();
    expect(screen.getByText('cd backend && uvicorn app.main:app --port 8000')).toBeInTheDocument();
  });
});

describe('hosted cold start', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('shows a friendly notice, backs off and enables demos after recovery', async () => {
    vi.stubEnv('PROD', true);
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(jsonResponse(HEALTH));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const { act } = await import('@testing-library/react');
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Waking up the free server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try demo repo' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Waking up the free server/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try demo repo' })).toBeEnabled();
  });
});
