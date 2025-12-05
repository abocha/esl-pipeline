import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadEnvFiles,
  loadEnvFilesWithSummary,
  readBool,
  readInt,
  readString,
} from '../src/env/loaders.js';

describe('env utilities', () => {
  describe('readBool', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns default when env var is not set', () => {
      expect(readBool('NONEXISTENT_VAR', true)).toBe(true);
      expect(readBool('NONEXISTENT_VAR', false)).toBe(false);
    });

    it('returns true for "1"', () => {
      process.env.TEST_BOOL = '1';
      expect(readBool('TEST_BOOL', false)).toBe(true);
    });

    it('returns true for "true" (case insensitive)', () => {
      process.env.TEST_BOOL = 'true';
      expect(readBool('TEST_BOOL', false)).toBe(true);
      process.env.TEST_BOOL = 'TRUE';
      expect(readBool('TEST_BOOL', false)).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.TEST_BOOL = '0';
      expect(readBool('TEST_BOOL', true)).toBe(false);
      process.env.TEST_BOOL = 'false';
      expect(readBool('TEST_BOOL', true)).toBe(false);
    });

    it('returns default for empty string', () => {
      process.env.TEST_BOOL = '';
      expect(readBool('TEST_BOOL', true)).toBe(true);
    });
  });

  describe('readInt', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns default when env var is not set', () => {
      expect(readInt('NONEXISTENT_VAR', 42)).toBe(42);
    });

    it('parses valid integers', () => {
      process.env.TEST_INT = '123';
      expect(readInt('TEST_INT', 0)).toBe(123);
    });

    it('returns default for invalid values', () => {
      process.env.TEST_INT = 'not a number';
      expect(readInt('TEST_INT', 42)).toBe(42);
    });

    it('returns default for empty string', () => {
      process.env.TEST_INT = '';
      expect(readInt('TEST_INT', 42)).toBe(42);
    });
  });

  describe('readString', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns default when env var is not set', () => {
      expect(readString('NONEXISTENT_VAR', 'default')).toBe('default');
    });

    it('returns env var value when set', () => {
      process.env.TEST_STRING = 'hello';
      expect(readString('TEST_STRING', 'default')).toBe('hello');
    });

    it('returns default for empty string', () => {
      process.env.TEST_STRING = '';
      expect(readString('TEST_STRING', 'default')).toBe('default');
    });

    it('returns undefined when no default provided and var not set', () => {
      expect(readString('NONEXISTENT_VAR')).toBeUndefined();
    });
  });

  describe('loadEnvFiles', () => {
    let testDir: string;
    const originalEnv = process.env;

    beforeEach(() => {
      testDir = join(tmpdir(), `test-env-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
      process.env = originalEnv;
    });

    it('loads variables from .env file', () => {
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'TEST_VAR=test_value\nANOTHER_VAR=another_value');

      const result = loadEnvFiles({ cwd: testDir, assignToProcess: false });

      expect(result.TEST_VAR).toBe('test_value');
      expect(result.ANOTHER_VAR).toBe('another_value');
    });

    it('assigns variables to process.env by default', () => {
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'PROCESS_VAR=process_value');

      loadEnvFiles({ cwd: testDir });

      expect(process.env.PROCESS_VAR).toBe('process_value');
    });

    it('does not override existing process.env vars by default', () => {
      process.env.EXISTING_VAR = 'original';
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'EXISTING_VAR=new_value');

      loadEnvFiles({ cwd: testDir, override: false });

      expect(process.env.EXISTING_VAR).toBe('original');
    });

    it('overrides existing vars when override is true', () => {
      process.env.EXISTING_VAR = 'original';
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'EXISTING_VAR=new_value');

      loadEnvFiles({ cwd: testDir, override: true });

      expect(process.env.EXISTING_VAR).toBe('new_value');
    });

    it('handles missing files gracefully', () => {
      const result = loadEnvFiles({ cwd: testDir });
      expect(result).toEqual({});
    });

    it('supports memoization with invalidation on mtime change', async () => {
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'FOO=one');

      const first = loadEnvFiles({ cwd: testDir, assignToProcess: false, memoize: true });
      expect(first.FOO).toBe('one');

      // Update file to change mtime and contents
      await new Promise((resolve) => setTimeout(resolve, 5));
      writeFileSync(envFile, 'FOO=two');

      const second = loadEnvFiles({ cwd: testDir, assignToProcess: false, memoize: true });
      expect(second.FOO).toBe('two');
    });

    it('returns empty assigned/overridden on cached no-op runs', () => {
      const envFile = join(testDir, '.env');
      writeFileSync(envFile, 'CACHED_VAR=one');

      const first = loadEnvFilesWithSummary({ cwd: testDir, memoize: true });
      expect(first.assignedKeys).toContain('CACHED_VAR');

      const second = loadEnvFilesWithSummary({ cwd: testDir, memoize: true });
      expect(second.assignedKeys).toEqual([]);
      expect(second.overriddenKeys).toEqual([]);
    });
  });
});
