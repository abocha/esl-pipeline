import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition } from '../src/domain/job-model';

describe('domain/job-model - job state transitions', () => {
  /**
   * Intent:
   * - Protect the core lifecycle contract for jobs.
   * - Ensure only allowed transitions are permitted.
   * - This defends against subtle state-corruption bugs in repository / processor logic.
   */

  it('allows key happy-path transitions', () => {
    expect(canTransition('queued', 'queued')).toBe(true);
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'failed')).toBe(true);

    expect(canTransition('running', 'running')).toBe(true);
    expect(canTransition('running', 'succeeded')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('rejects transitions out of terminal states', () => {
    expect(canTransition('succeeded', 'queued')).toBe(false);
    expect(canTransition('succeeded', 'running')).toBe(false);
    expect(canTransition('succeeded', 'failed')).toBe(false);

    expect(canTransition('failed', 'queued')).toBe(false);
    expect(canTransition('failed', 'running')).toBe(false);
    expect(canTransition('failed', 'succeeded')).toBe(false);
  });

  it('rejects invalid backwards transitions', () => {
    expect(canTransition('running', 'queued')).toBe(false);
  });

  it('assertTransition passes on valid transitions and throws on invalid ones', () => {
    expect(() => assertTransition('queued', 'running')).not.toThrow();
    expect(() => assertTransition('running', 'succeeded')).not.toThrow();

    expect(() => assertTransition('succeeded', 'queued')).toThrow();
    expect(() => assertTransition('failed', 'running')).toThrow();
    expect(() => assertTransition('running', 'queued')).toThrow();
  });
});
