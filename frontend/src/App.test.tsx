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

  it('explains the product on the first screen', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/merge conflicts git can't see/i);
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sentinel diffs every branch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nemotron explains the risk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tests prove it' })).toBeInTheDocument();
    expect(await screen.findByText('Sentinel online')).toBeInTheDocument();
  });

  it('fills the repo field with the demo path and runs the analysis on "Try demo repo"', async () => {
    routeFetch(fetchMock, () => Promise.resolve(jsonResponse(RESULT)));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Try demo repo' }));

    const input = screen.getByLabelText('Repository path or URL') as HTMLInputElement;
    expect(input.value).toBe(expectedDemoPath);
    // Progress is shown while the request runs.
    expect(screen.getByRole('heading', { name: 'Analyzing' })).toBeInTheDocument();

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
    expect(screen.getByText('python3 demo/make_demo_repo.py')).toBeInTheDocument();
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
