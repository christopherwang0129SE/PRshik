import { sentinelMode, sentinelStatus } from '../utils/agent';
import type { HealthResponse } from '../types';

interface AgentStatusProps {
  health: HealthResponse | null;
  /** False until the first /api/health answer or failure. */
  checked?: boolean;
}

/**
 * Header status for the backend: Sentinel online or offline (from
 * /api/health), the scoring mode, and the model id.
 */
export const AgentStatus = ({ health, checked = true }: AgentStatusProps) => {
  const status = !checked ? 'checking' : sentinelStatus(health);
  const mode = sentinelMode(health);

  return (
    <div className="agent-status" data-status={status}>
      <span className="status-dot" aria-hidden="true"></span>
      <span className="agent-name">
        {status === 'checking'
          ? 'Checking backend'
          : status === 'online'
            ? 'Sentinel online'
            : 'Sentinel offline'}
      </span>
      {status === 'online' && (
        <span className="agent-mode">
          {mode}
          {health?.nebius_model && (
            <span className="agent-model" title={health.nebius_model}>
              {health.nebius_model}
            </span>
          )}
        </span>
      )}
    </div>
  );
};
