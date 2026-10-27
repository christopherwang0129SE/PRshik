import { describe, it, expect } from 'vitest';
import { sentinelStatus, sentinelMode } from './agent';
import type { HealthResponse, PairRisk } from '../types';

const baseHealth: HealthResponse = {
  status: 'ok',
  nebius_status: 'ok',
  nebius_ready: false,
  nebius_enabled: false,
  nebius_model: null,
  tavily_ready: false,
};

describe('sentinelStatus', () => {
  it('is online when health responds', () => {
    expect(sentinelStatus(baseHealth)).toBe('online');
  });

  it('is online even when Nebius is not ready (git scoring still works)', () => {
    expect(sentinelStatus({ ...baseHealth, nebius_ready: false, nebius_enabled: false })).toBe(
      'online'
    );
  });

  it('is offline when health is unavailable', () => {
    expect(sentinelStatus(null)).toBe('offline');
  });
});

describe('sentinelMode', () => {
  it('marks unchecked health as unverified even after a cached model result', () => {
    const health = { ...baseHealth, nebius_ready: true, nebius_enabled: true, nebius_status: 'unchecked' as const };
    expect(sentinelMode(health)).toBe('git+Nemotron (unverified)');
    expect(sentinelMode(health, [{ model_score: 20 } as PairRisk])).toBe('git+Nemotron (unverified)');
  });
  it('only degrades a failed run when no model score succeeded', () => {
    const health = { ...baseHealth, nebius_ready: true, nebius_enabled: true };
    const failed = { fallback_reason: 'unparsable', model_score: null } as PairRisk;
    expect(sentinelMode(health, [failed])).toBe('git only · Nemotron failed');
    expect(sentinelMode(health, [failed, { model_score: 20 } as PairRisk])).toBe('git+Nemotron');
    expect(sentinelMode({ ...health, nebius_status: 'auth_failed' }, [{ model_score: 20 } as PairRisk])).toBe('git only · Nemotron failed');
  });
  it('is "git only" when Nebius is neither ready nor enabled', () => {
    expect(sentinelMode({ ...baseHealth, nebius_ready: false, nebius_enabled: false })).toBe(
      'git only'
    );
  });

  it('is "git+Nemotron" when nebius_ready is true', () => {
    expect(sentinelMode({ ...baseHealth, nebius_ready: true, nebius_enabled: true })).toBe(
      'git+Nemotron'
    );
  });

  it('is "git only" when enabled but no key is configured', () => {
    expect(sentinelMode({ ...baseHealth, nebius_ready: false, nebius_enabled: true })).toBe(
      'git only'
    );
  });

  it('falls back to "git only" when health is unavailable', () => {
    expect(sentinelMode(null)).toBe('git only');
  });
});
