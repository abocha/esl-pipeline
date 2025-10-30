import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigPaths, createPipeline, loadEnvFiles } from '../src/pipeline.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pipeline helpers', () => {
  it('locates repository configs by default', () => {
    const paths = resolveConfigPaths();
    expect(existsSync(paths.presetsPath)).toBe(true);
    expect(existsSync(paths.voicesPath)).toBe(true);
  });

  it('falls back to bundled configs when working directory lacks configs', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pipeline-config-'));
    tempDirs.push(temp);
    const pipeline = createPipeline({ cwd: temp });
    expect(existsSync(pipeline.defaults.presetsPath)).toBe(true);
    expect(existsSync(pipeline.defaults.voicesPath)).toBe(true);
  });

  it('loads env files without mutating process env when disabled', () => {
    const temp = mkdtempSync(join(tmpdir(), 'env-load-'));
    tempDirs.push(temp);
    const envFile = join(temp, '.env');
    writeFileSync(envFile, 'FOO=bar\n');
    delete process.env.FOO;
    const result = loadEnvFiles({ cwd: temp, assignToProcess: false });
    expect(result.FOO).toBe('bar');
    expect(process.env.FOO).toBeUndefined();
  });
});
