import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentStatus } from './AgentStatus';
import type { HealthResponse } from '../types';

const health = (over: Partial<HealthResponse> = {}): HealthResponse => ({
  status: 'ok',
  nebius_ready: false,
  nebius_enabled: false,
  nebius_model: null,
  tavily_ready: false,
  ...over,
});

describe('AgentStatus', () => {
  it.each(['auth_failed', 'unreachable', 'error'] as const)('warns when health reports %s', (status) => {
    render(<AgentStatus health={health({ nebius_ready: true, nebius_enabled: true, nebius_status: status })} />);
    expect(screen.getByText('git only · Nemotron failed')).toHaveAttribute('data-degraded', 'true');
    expect(screen.queryByText('git + Nemotron')).not.toBeInTheDocument();
  });
  it('shows Engine online with git only mode when Nebius is off', () => {
    render(<AgentStatus health={health({ nebius_ready: false, nebius_enabled: false })} />);
    expect(screen.getByText(/online/i)).toBeInTheDocument();
    expect(screen.getByText(/git only/i)).toBeInTheDocument();
  });

  it('shows Engine online with git + Nemotron mode when Nebius is ready, without repeating the model id', () => {
    render(
      <AgentStatus
        health={health({ nebius_ready: true, nebius_enabled: true, nebius_model: 'nemotron' })}
      />
    );
    expect(screen.getByText(/online/i)).toBeInTheDocument();
    expect(screen.getByText(/git \+ Nemotron/i)).toBeInTheDocument();
    expect(screen.queryByText('nemotron')).toBeNull();
  });

  it('shows Engine offline when health is unavailable', () => {
    render(<AgentStatus health={null} />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('says it is checking before the first health answer', () => {
    render(<AgentStatus health={null} checked={false} />);
    expect(screen.getByText('Checking backend')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });
});
