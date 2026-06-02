import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const ASSIGN_CATALOG_TEST_TIMEOUT_MS = 30_000;

describe('loadVoicesCatalog error policy', () => {
  it(
    'returns empty voices when catalog file is missing',
    async () => {
      vi.resetModules();
      const { loadVoicesCatalog } = await import('../src/assign.js');
      const missingPath = join(tmpdir(), `missing-voices-${Date.now()}.json`);
      const result = await loadVoicesCatalog(missingPath);
      expect(result).toEqual({ voices: [] });
    },
    ASSIGN_CATALOG_TEST_TIMEOUT_MS,
  );

  it(
    'fails fast when catalog JSON is invalid',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-assign-'));
      const invalidPath = join(dir, 'voices.json');
      await writeFile(invalidPath, '{ invalid-json', 'utf8');

      vi.resetModules();
      const { loadVoicesCatalog } = await import('../src/assign.js');
      await expect(loadVoicesCatalog(invalidPath)).rejects.toThrow(
        /Invalid ElevenLabs voices catalog JSON/,
      );
      await expect(loadVoicesCatalog(invalidPath)).rejects.toThrow(invalidPath);
    },
    ASSIGN_CATALOG_TEST_TIMEOUT_MS,
  );

  it(
    'throws when catalog path points to a directory',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-assign-'));

      vi.resetModules();
      const { loadVoicesCatalog } = await import('../src/assign.js');
      await expect(loadVoicesCatalog(dir)).rejects.toThrow(
        /Failed to read ElevenLabs voices catalog/,
      );
    },
    ASSIGN_CATALOG_TEST_TIMEOUT_MS,
  );

  it(
    'throws on unreadable catalog file instead of silently falling back',
    async () => {
      const unreadablePath = join(tmpdir(), `unreadable-voices-${Date.now()}.json`);

      vi.resetModules();
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        return {
          ...actual,
          readFile: vi.fn(async () => {
            const error = new Error('permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }),
        };
      });

      try {
        const { loadVoicesCatalog } = await import('../src/assign.js');
        await expect(loadVoicesCatalog(unreadablePath)).rejects.toThrow(
          /Failed to read ElevenLabs voices catalog/,
        );
      } finally {
        vi.doUnmock('node:fs/promises');
      }
    },
    ASSIGN_CATALOG_TEST_TIMEOUT_MS,
  );
});
