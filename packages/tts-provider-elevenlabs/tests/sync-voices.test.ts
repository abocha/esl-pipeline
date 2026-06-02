import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const syncVoicesTestTimeout = 45_000;

describe.sequential('syncVoices path resolution', () => {
  beforeEach(() => {
    process.chdir(originalCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it(
    'writes default output to workspace-root orchestrator catalog path',
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'tts-sync-'));
      await writeFile(
        join(workspace, 'pnpm-workspace.yaml'),
        'packages:\n  - "packages/*"\n',
        'utf8',
      );
      await writeFile(
        join(workspace, 'package.json'),
        '{"name":"workspace","private":true}',
        'utf8',
      );
      await mkdir(join(workspace, 'packages', 'tts-provider-elevenlabs'), { recursive: true });
      await writeFile(
        join(workspace, 'packages', 'tts-provider-elevenlabs', '.gitkeep'),
        '',
        'utf8',
      );
      process.chdir(join(workspace, 'packages', 'tts-provider-elevenlabs'));

      const eleven = await import('../src/eleven.js');
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        voices: {
          getAll: vi.fn(async () => ({
            voices: [{ voice_id: 'voice_1', name: 'Voice One', labels: { gender: 'female' } }],
          })),
        },
      } as any);

      const { syncVoices } = await import('../src/syncVoices.js');
      const result = await syncVoices();

      const expectedPath = resolve(
        workspace,
        'packages/orchestrator/configs/elevenlabs.voices.json',
      );
      expect(result.outPath).toBe(expectedPath);

      const saved = JSON.parse(await readFile(expectedPath, 'utf8')) as {
        voices: { id: string }[];
      };
      expect(saved.voices).toHaveLength(1);
      expect(saved.voices[0]?.id).toBe('voice_1');
    },
    syncVoicesTestTimeout,
  );

  it(
    'uses explicit --out destination as-is',
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'tts-sync-'));
      await writeFile(
        join(workspace, 'pnpm-workspace.yaml'),
        'packages:\n  - "packages/*"\n',
        'utf8',
      );
      await writeFile(
        join(workspace, 'package.json'),
        '{"name":"workspace","private":true}',
        'utf8',
      );
      await mkdir(join(workspace, 'packages', 'tts-provider-elevenlabs'), { recursive: true });
      await writeFile(
        join(workspace, 'packages', 'tts-provider-elevenlabs', '.gitkeep'),
        '',
        'utf8',
      );
      process.chdir(join(workspace, 'packages', 'tts-provider-elevenlabs'));

      const eleven = await import('../src/eleven.js');
      vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
        voices: {
          getAll: vi.fn(async () => ({
            voices: [{ id: 'voice_2', name: 'Voice Two' }],
          })),
        },
      } as any);

      const explicitPath = resolve(workspace, 'custom', 'voices.json');
      const { syncVoices } = await import('../src/syncVoices.js');
      const result = await syncVoices(explicitPath);

      expect(result.outPath).toBe(explicitPath);
      const saved = JSON.parse(await readFile(explicitPath, 'utf8')) as {
        voices: { id: string }[];
      };
      expect(saved.voices[0]?.id).toBe('voice_2');
    },
    syncVoicesTestTimeout,
  );
});
