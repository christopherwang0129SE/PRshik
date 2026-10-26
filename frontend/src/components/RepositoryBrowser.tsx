import { useEffect, useState } from 'react';
import { API_BASE_URL, readError } from '../services/api';

interface Repository { name: string; repo_path: string; base_branch: string; branches: string[]; available: boolean }
interface Pull { number: number; title: string; author: string; url: string; head_branch: string; base_branch: string }
export function RepositoryBrowser({ disabled, onAnalyze, demoMode = false }: {
  disabled: boolean; onAnalyze: (repo: string, base: string) => void; demoMode?: boolean;
}) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repoError, setRepoError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [github, setGithub] = useState('');
  const [base, setBase] = useState('main');
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const [pullError, setPullError] = useState('');
  const [pullLoading, setPullLoading] = useState(false);
  const [queueLocked, setQueueLocked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/repositories`, { signal: controller.signal }).then(async (r) => {
      if (!r.ok) throw new Error(await readError(r));
      return r.json() as Promise<{ repositories: Repository[] }>;
    }).then((data) => { setRepositories(data.repositories); setRepoError(''); })
      .catch((e: Error) => { if (!controller.signal.aborted) setRepoError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const loadPulls = async (e: React.FormEvent) => {
    e.preventDefault(); setPullLoading(true); setPullError(''); setPulls(null);
    if (demoMode || queueLocked) { setPullLoading(false); return; }
    const slug = github.trim().replace(/^https:\/\/github.com\//, '').replace(/\/$/, '');
    try {
      const r = await fetch(`${API_BASE_URL}/api/github/pulls?${new URLSearchParams({ repository: slug, base_branch: base.trim() || 'main' })}`);
      if (r.status === 403) { setQueueLocked(true); return; }
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json() as { pull_requests: Pull[] };
      setPulls(data.pull_requests);
    } catch (e) { setPullError(e instanceof Error ? e.message : 'Could not load pull requests.'); }
    finally { setPullLoading(false); }
  };
  return <section className="library" aria-label="Repository browser">
    <details>
      <summary>Repositories &amp; pull requests</summary>
      <div className="library-body">
        <h2>Bundled repositories</h2>
        {loading && <p role="status">Loading repositories…</p>}
        {repoError && <div role="alert"><p>{repoError}</p><button className="btn" onClick={() => { setLoading(true); setRevision((v) => v + 1); }}>Retry repositories</button></div>}
        {!loading && !repoError && repositories.length === 0 && <p>No bundled repositories are available. Enter a repository above.</p>}
        <ul className="library-list">{repositories.map((repo) => <li key={repo.repo_path}>
          <div><strong>{repo.name}</strong><p>{repo.available ? `${repo.branches.length} branches against ${repo.base_branch}` : 'Not generated. See demo/README.md.'}</p>
            {repo.branches.length > 0 && <ul className="branch-list">{repo.branches.map((branch) => <li key={branch}><code>{branch}</code></li>)}</ul>}
          </div>
          <button className="btn" disabled={disabled || !repo.available} onClick={() => onAnalyze(repo.repo_path, repo.base_branch)}>Analyze {repo.name}</button>
        </li>)}</ul>
        {(demoMode || queueLocked) ? <p role="status">GitHub browsing is unavailable in demo mode. Choose a bundled repository.</p> : <>
        <h2>GitHub pull requests</h2>
        <p>Choose a base branch to list its open PRs. Analyzing a PR compares it with up to eight other open PRs on its base.</p>
        <form className="queue-form" onSubmit={loadPulls}>
          <div className="field"><label htmlFor="github-repository">GitHub repository</label><input id="github-repository" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="owner/repo" required autoCapitalize="off" spellCheck={false} /></div>
          <div className="field queue-base"><label htmlFor="github-base">PR base branch</label><input id="github-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" autoCapitalize="off" spellCheck={false} /></div>
          <button className="btn" disabled={pullLoading}>{pullLoading ? 'Loading PRs…' : 'Load pull requests'}</button>
        </form>
        {pullError && <p role="alert">{pullError} Check the repository and try again.</p>}
        {pulls?.length === 0 && <p role="status">No open pull requests target this base branch.</p>}
        {pulls && pulls.length > 0 && <ul className="library-list">{pulls.map((pull) => <li key={pull.number}>
          <div><a href={pull.url} target="_blank" rel="noreferrer">#{pull.number} {pull.title}</a><p>{pull.author} · {pull.head_branch} into {pull.base_branch}</p></div>
          <button className="btn" disabled={disabled} onClick={() => onAnalyze(pull.url, pull.base_branch)}>Analyze PR #{pull.number}</button>
        </li>)}</ul>}
        </>}
      </div>
    </details>
  </section>;
}
