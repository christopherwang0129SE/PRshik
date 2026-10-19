import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Progress } from './Progress';
import { estimatedStep, STEPS } from '../utils/pipeline';

describe('Progress', () => {
  it('names the repository, base branch and elapsed seconds', () => {
    render(<Progress target="/tmp/repo" baseBranch="main" activeStep={0} elapsedS={7} />);
    const region = screen.getByRole('region', { name: 'Analyzing' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('/tmp/repo against main');
    expect(region.querySelector('.progress-elapsed')).toHaveTextContent('7s elapsed');
  });

  it('shows the running stage text and marks each step for screen readers', () => {
    render(<Progress target="r" baseBranch="main" activeStep={1} elapsedS={9} />);
    expect(screen.getByText(STEPS[1].running)).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'active', 'todo']);
    expect(items[0]).toHaveTextContent('Diff branches: done');
    expect(items[1]).toHaveTextContent('Explain risky pairs: in progress');
    expect(items[2]).toHaveTextContent('Test the merge: up next');
  });

  it('says the stage is an estimate', () => {
    render(<Progress target="r" baseBranch="main" activeStep={2} elapsedS={40} />);
    expect(screen.getByText(/Stage is estimated from elapsed time/)).toBeInTheDocument();
  });

  it('estimates the step from elapsed seconds', () => {
    expect(estimatedStep(0)).toBe(0);
    expect(estimatedStep(2)).toBe(0);
    expect(estimatedStep(5)).toBe(1);
    expect(estimatedStep(19)).toBe(1);
    expect(estimatedStep(30)).toBe(2);
  });
});
