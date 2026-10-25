import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RepositoryBrowser } from './RepositoryBrowser';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => vi.unstubAllGlobals());
it('loads backend repositories and starts the selected analysis', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ repositories: [
    { name: 'checkout-demo', repo_path: '/demo', base_branch: 'main', branches: ['feat/a'], available: true },
  ] })));
  const onAnalyze = vi.fn(); render(<RepositoryBrowser disabled={false} onAnalyze={onAnalyze} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze checkout-demo' }));
  expect(onAnalyze).toHaveBeenCalledWith('/demo', 'main');
});
it('loads real PR shapes and analyzes the chosen URL', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repositories: [] })).mockResolvedValueOnce(json({ pull_requests: [
    { number: 8, title: 'Fix', author: 'dev', url: 'https://github.com/owner/repo/pull/8', head_branch: 'fix', base_branch: 'main' },
  ] })));
  const onAnalyze = vi.fn(); render(<RepositoryBrowser disabled={false} onAnalyze={onAnalyze} />);
  fireEvent.change(screen.getByLabelText('GitHub repository'), { target: { value: 'owner/repo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load pull requests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze PR #8' }));
  expect(onAnalyze).toHaveBeenCalledWith('https://github.com/owner/repo/pull/8', 'main');
});
it('shows repository retry and PR errors without inventing rows', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Unavailable' }, 503)));
  render(<RepositoryBrowser disabled={false} onAnalyze={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Retry repositories' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GitHub repository'), { target: { value: 'owner/repo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load pull requests' }));
  expect(await screen.findByText(/Check the repository and try again/)).toBeInTheDocument();
});
