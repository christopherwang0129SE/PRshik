import { describe, it, expect } from 'vitest';
import { describeError, API_DEMO_REPO_COMMAND, BACKEND_START_COMMAND, DEMO_REPO_COMMAND } from './errors';

describe('describeError', () => {
  it('turns a network failure into a start-the-backend fix', () => {
    const help = describeError('Failed to fetch', 'http://localhost:8000');
    expect(help.title).toBe("Can't reach the MergeGuard backend");
    expect(help.body).toBe('Nothing answered at http://localhost:8000.');
    expect(help.fix?.command).toBe(BACKEND_START_COMMAND);
  });

  it('suggests the demo repo for a path that is not a git repository', () => {
    const help = describeError('/tmp/x is not a git repository', 'http://localhost:8000');
    expect(help.title).toBe("That path isn't a git repository");
    expect(help.body).toBe('/tmp/x is not a git repository');
    expect(help.fix?.command).toBe(`${DEMO_REPO_COMMAND}\n${API_DEMO_REPO_COMMAND}`);
  });

  it('explains a repository with no branches to compare', () => {
    expect(describeError('No branches to analyze (base=main).', '').title).toBe('No branches to compare');
  });

  it('falls back to the server message', () => {
    expect(describeError('500 Internal Server Error', '')).toEqual({
      title: 'Analysis failed',
      body: '500 Internal Server Error',
    });
  });
});
