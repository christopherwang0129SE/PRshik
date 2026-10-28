import { sentinelMode, sentinelStatus } from '../utils/agent';
import type { HealthResponse, PairRisk } from '../types';

interface AgentStatusProps {
  health: HealthResponse | null;
  /** False until the first /api/health answer or failure. */
  checked?: boolean;
  pairs?: PairRisk[];
}

/**
 * Header status for the backend: Engine online or offline (from
 * /api/health), the scoring mode and whether Tavily is on. The model id
 * lives in the verdict and the footer.
 */
export const AgentStatus = ({ health, checked = true, pairs = [] }: AgentStatusProps) => {
  const status = !checked ? 'checking' : sentinelStatus(health);
  const mode = sentinelMode(health, pairs);

  return (
    <div className="backend" data-status={status}>
      <span className="backend-state">
        <span className="backend-mark" aria-hidden="true"></span>
        {status === 'checking' ? 'Checking backend' : status === 'online' ? 'Engine online' : 'Engine offline'}
      </span>
      {status === 'online' && (
        <>
          <span className="backend-mode" data-degraded={mode.includes('failed') || undefined}>{mode}</span>
          {health?.tavily_ready && <span className="backend-extra">Tavily on</span>}
        </>
      )}
    </div>
  );
};
