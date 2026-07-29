import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SpeechPlannerEvalAttemptRecord } from '../src/application/speech-planner-evaluator.js';
import { loadConfig } from '../src/config/env.js';
import {
  parseEvalSpeechPlannerArgs,
  runEvalSpeechPlannerCli,
  writeSelectedInworldAudio,
} from '../src/tools/eval-speech-planner.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('eval speech planner CLI', () => {
  it('defaults to a provider-free 120-attempt dry-run', async () => {
    const stdout = vi.fn();
    const executeAttempt = vi.fn();
    const result = await runEvalSpeechPlannerCli([], {
      stdout,
      config: loadConfig(),
      gitSha: 'a'.repeat(40),
      executeAttempt,
    });

    expect(result).toMatchObject({
      mode: 'dry-run',
      plannerAttempts: 120,
      compatibilityChecks: 1,
      providerCalls: 0,
      postgresAdapters: 0,
      currentDayUsage: 'unverified',
    });
    expect(executeAttempt).not.toHaveBeenCalled();
    expect(JSON.stringify(stdout.mock.calls)).not.toMatch(/api[_-]?key|credential/i);
  });

  it('parses explicit matrix, usage, audio, private, output, and resume flags', () => {
    expect(
      parseEvalSpeechPlannerArgs([
        '--live',
        '--audio=selected',
        '--models=gemini-3.1-flash-lite,gemini-3.5-flash-lite',
        '--prompts=speech-performance-v1-restrained-natural,speech-performance-v2-inworld-tts2',
        '--repetitions=3',
        '--used-today=7',
        '--private-fixture=tmp/speech-planner-eval-private/issue-154.json',
        '--private-only',
        '--output=tmp/speech-planner-eval',
        '--resume-run=tmp/speech-planner-eval/run-id',
      ]),
    ).toMatchObject({
      live: true,
      audio: 'selected',
      repetitions: 3,
      usedToday: 7,
      privateOnly: true,
      output: 'tmp/speech-planner-eval',
      resumeRun: 'tmp/speech-planner-eval/run-id',
    });
  });

  it('fails closed before live provider construction without explicit usage', async () => {
    const config = loadConfig();
    const executeAttempt = vi.fn();
    await expect(
      runEvalSpeechPlannerCli(['--live'], {
        stdout: vi.fn(),
        config: {
          ...config,
          generation: {
            ...config.generation,
            providers: {
              ...config.generation.providers,
              googleAiStudio: {
                ...config.generation.providers.googleAiStudio,
                apiKey: 'configured-but-not-printed',
              },
            },
          },
        },
        gitSha: 'a'.repeat(40),
        executeAttempt,
      }),
    ).rejects.toThrow('--used-today');
    expect(executeAttempt).not.toHaveBeenCalled();
  });

  it('runs checked-in offline outputs without Gemini, Inworld, budget, or Postgres construction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-eval-cli-'));
    roots.push(root);
    const executeAttempt = vi.fn();
    const result = await runEvalSpeechPlannerCli(
      [
        '--offline-output-fixtures=packages/batch-backend/fixtures/speech-planner-eval/planner-outputs-v1.json',
        `--output=${root}`,
      ],
      {
        stdout: vi.fn(),
        config: loadConfig(),
        gitSha: 'a'.repeat(40),
        executeAttempt,
      },
    );
    expect(result).toMatchObject({
      mode: 'offline',
      providerCalls: 0,
      synthesisCalls: 0,
      postgresAdapters: 0,
      completedAttempts: 5,
    });
    expect(executeAttempt).not.toHaveBeenCalled();
  });

  it('refuses private fixtures outside the ignored private root and audio without live mode', async () => {
    await expect(
      runEvalSpeechPlannerCli(['--private-fixture=fixtures/issue-154.json', '--private-only'], {
        stdout: vi.fn(),
        config: loadConfig(),
        gitSha: 'a'.repeat(40),
      }),
    ).rejects.toThrow('tmp/speech-planner-eval-private');
    await expect(
      runEvalSpeechPlannerCli(['--audio=selected'], {
        stdout: vi.fn(),
        config: loadConfig(),
        gitSha: 'a'.repeat(40),
      }),
    ).rejects.toThrow('--audio=selected requires --live');
  });

  it('accepts only paths contained by the resolved private root', () => {
    const parsed = parseEvalSpeechPlannerArgs([
      '--private-fixture=tmp/speech-planner-eval-private/issue-154.json',
      '--private-only',
    ]);
    expect(parsed.privateFixture).toContain(join('tmp', 'speech-planner-eval-private'));
  });

  it('writes selected audio through the direct Inworld synthesis path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-eval-audio-'));
    roots.push(root);
    const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'] as const;
    const prompts = [
      'speech-performance-v1-restrained-natural',
      'speech-performance-v2-inworld-tts2',
    ] as const;
    const records: SpeechPlannerEvalAttemptRecord[] = models.flatMap((requestedModel) =>
      prompts.map((promptPolicyVersion, index) => ({
        attemptId: `${requestedModel}-${index}`,
        fixtureId: 'neutral-dialogue',
        fixtureTags: ['neutral-dialogue'],
        ttsModel: 'inworld-tts-2',
        requestedModel,
        promptPolicyVersion,
        repetition: 1,
        compatibilitySmoke: false,
        rawParseStatus: 'parsed',
        promptedPlanStatus: 'valid',
        fallbackStatus: 'not_used',
        costStatus: 'unavailable',
        rendered: [
          {
            id: 'segment-1',
            text: 'The train leaves at nine.',
            lexicalText: 'The train leaves at nine.',
            leadingInstructionTagCount: 0,
            voiceId: 'Ashley',
            language: 'en-US',
            speaker: 'Maya',
          },
        ],
      })),
    );
    const synthesizeChunk = vi.fn(async (_text, _voiceId, outFile: string) => {
      writeFileSync(outFile, Buffer.from('chunk'));
    });
    const concatenate = vi.fn(async (_segments, outFile: string) => {
      writeFileSync(outFile, Buffer.from('audio'));
    });

    const calls = await writeSelectedInworldAudio(
      { runDirectory: root, records },
      { synthesizeChunk, concatenate, ffmpegPath: 'ffmpeg' },
    );

    expect(calls).toBe(4);
    expect(synthesizeChunk).toHaveBeenCalledTimes(4);
    expect(concatenate).toHaveBeenCalledTimes(4);
    expect(readFileSync(join(root, 'listening', 'index.html'), 'utf8')).not.toContain('gemini');
  });
});
