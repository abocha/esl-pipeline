import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('JSON logger', () => {
  it.each(['development', 'production'])('writes structured fields and errors in %s', (nodeEnv) => {
    const moduleUrl = new URL('../src/infrastructure/logger.ts', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      const { createJobLogger } = await import(${JSON.stringify(moduleUrl)});
      const log = createJobLogger('job-1', 'run-1');
      log.info('upload started', { backend: 's3' });
      log.error(new Error('upload failed'));
    `,
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: 'info' } },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const entries = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: 30,
      msg: 'upload started',
      jobId: 'job-1',
      runId: 'run-1',
      backend: 's3',
    });
    expect(entries[1]).toMatchObject({
      level: 50,
      msg: 'upload failed',
      err: { name: 'Error', message: 'upload failed' },
    });
  });
});
