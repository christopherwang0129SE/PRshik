import type { HealthResponse, PairRisk } from '../types';

export function modelFailure(health: HealthResponse | null, pairs: PairRisk[] = []): string | null {
  if (['auth_failed', 'unreachable', 'error'].includes(health?.nebius_status ?? '')) {
    return health!.nebius_status!;
  }
  const failures = pairs.filter(p => p.fallback_reason === 'model_error' || p.fallback_reason === 'unparsable');
  const succeeded = pairs.some(p => p.model_score != null);
  return failures.length && !succeeded ? failures[0].fallback_reason! : null;
}

/**
 * Sentinel is "online" whenever /api/health responds, because the git-based
 * scoring works without Nebius. It is "offline" only when health is unavailable.
 */
export function sentinelStatus(health: HealthResponse | null): 'online' | 'offline' {
  return health ? 'online' : 'offline';
}

/**
 * Sentinel scoring mode. The git heuristic always runs; Nemotron is added on
 * top when Nebius is both configured and enabled.
 */
export function sentinelMode(health: HealthResponse | null, pairs: PairRisk[] = []): 'git only' | 'git+Nemotron' | 'git+Nemotron (unverified)' | 'git only · Nemotron failed' {
  if (modelFailure(health, pairs)) return 'git only · Nemotron failed';
  if (health && (health.nebius_ready && health.nebius_enabled)) {
    return health.nebius_status === 'ok' ? 'git+Nemotron' : 'git+Nemotron (unverified)';
  }
  return 'git only';
}

/** Copy for a control that would call Nemotron, Tavily, intent tests, or the resolver. */
export const NEEDS_NEBIUS_KEY = 'needs a Nebius key; not enabled in this demo';
