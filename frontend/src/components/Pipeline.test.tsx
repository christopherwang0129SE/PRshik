import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pipeline } from './Pipeline';
import { estimatedStep } from '../utils/pipeline';

describe('Pipeline', () => {
  it('explains the three steps in intro mode', () => {
    render(<Pipeline mode="intro" />);
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/Plain git, no LLM/)).toBeInTheDocument();
  });

  it('marks the running step and shows elapsed time', () => {
    const { container } = render(<Pipeline mode="running" activeStep={1} elapsedS={7} />);
    expect(screen.getByRole('heading', { name: 'Analyzing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nemotron is reviewing pairs that share code: In progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sentinel diffs every branch: Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tests prove it: Up next' })).toBeInTheDocument();
    expect(container.querySelector('.pipeline-elapsed')).toHaveTextContent('7 s elapsed');
  });

  it('shows one fact per step when done', () => {
    render(<Pipeline mode="done" facts={['one', 'two', 'three']} />);
    expect(screen.getByRole('heading', { name: 'How this result was reached' })).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('estimates the step from elapsed seconds', () => {
    expect(estimatedStep(0)).toBe(0);
    expect(estimatedStep(5)).toBe(1);
    expect(estimatedStep(30)).toBe(2);
  });
});
