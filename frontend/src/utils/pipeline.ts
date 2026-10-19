export interface Step {
  title: string;
  running: string;
  description: string;
}

export const STEPS: Step[] = [
  {
    title: 'Sentinel diffs every branch',
    running: 'Sentinel is diffing every branch',
    description:
      'Compares each branch with the base and scores every pair by the files and functions both touch. Plain git, no LLM.',
  },
  {
    title: 'Nemotron explains the risk',
    running: 'Nemotron is reviewing pairs that share code',
    description:
      'NVIDIA Nemotron 3 Super reads both diffs and explains how the changes interact, checked against library docs from Tavily.',
  },
  {
    title: 'Tests prove it',
    running: 'Running tests on the merged code',
    description:
      "High-risk pairs are merged in a sandbox. The branches' own tests and intent tests written by Nemotron run on the result. A test that passes on its branch and fails after the merge is proof.",
  },
];

/**
 * Which step is probably running, from elapsed seconds. The backend answers
 * in one response, so this is an estimate: the diff takes a few seconds, the
 * model calls most of the rest, tests run last.
 */
export const estimatedStep = (elapsedS: number): number => (elapsedS < 3 ? 0 : elapsedS < 20 ? 1 : 2);
