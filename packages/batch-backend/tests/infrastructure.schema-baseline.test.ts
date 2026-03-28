import { describe, expect, it } from 'vitest';

import { selectDockerPostgresContainerId } from '../src/infrastructure/schema-baseline.js';

describe('infrastructure/schema-baseline', () => {
  it('selects the only matching postgres container even when other containers are running', () => {
    const containerId = selectDockerPostgresContainerId(
      ['abc123 postgres:16 0.0.0.0:5432->5432/tcp', 'def456 redis:7 0.0.0.0:6379->6379/tcp'].join(
        '\n',
      ),
      '16',
    );

    expect(containerId).toBe('abc123');
  });

  it('returns null when more than one matching postgres container is running', () => {
    const containerId = selectDockerPostgresContainerId(
      [
        'abc123 postgres:16 0.0.0.0:5432->5432/tcp',
        'def456 postgres:16-alpine 0.0.0.0:5433->5432/tcp',
      ].join('\n'),
      '16',
    );

    expect(containerId).toBeNull();
  });
});
