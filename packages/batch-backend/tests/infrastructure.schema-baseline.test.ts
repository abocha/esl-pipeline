import { describe, expect, it } from 'vitest';

import {
  normalizeDumpSql,
  selectDockerPostgresContainerId,
} from '../src/infrastructure/schema-baseline.js';

describe('infrastructure/schema-baseline', () => {
  it('preserves executable function bodies and delayed validation while removing dump session setup', () => {
    const body = [
      '    AS $function$',
      'BEGIN',
      '  -- This SET updates business state, not the dump connection.',
      '  UPDATE example',
      '  SET value = 1',
      '  WHERE id = NEW.id;',
      '',
      '',
      "  RAISE NOTICE 'still inside the body';",
      '  RETURN NEW;',
      'END',
      '$function$;',
    ].join('\n');
    const normalized = normalizeDumpSql(
      [
        '-- PostgreSQL database dump',
        'SET statement_timeout = 0;',
        'SET check_function_bodies = false;',
        'CREATE FUNCTION public.example() RETURNS trigger LANGUAGE plpgsql',
        body,
      ].join('\n'),
    );
    expect(normalized).toContain(body);
    expect(normalized).toContain('SET check_function_bodies = false;');
    expect(normalized).not.toContain('SET statement_timeout');
    expect(normalized).not.toContain('-- PostgreSQL database dump');
  });
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
