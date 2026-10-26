import type { HealthResponse } from '../types';

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
export function sentinelMode(health: HealthResponse | null): 'git only' | 'git+Nemotron' {
  if (health && (health.nebius_ready && health.nebius_enabled)) {
    return 'git+Nemotron';
  }
  return 'git only';
}

/** Copy for a control that would call Nemotron, Tavily, intent tests, or the resolver. */
export const NEEDS_NEBIUS_KEY = 'needs a Nebius key; not enabled in this demo';
