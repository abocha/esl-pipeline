import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SpeechPlannerEvalAttemptRecord } from '../src/application/speech-planner-evaluator.js';
import {
  selectSpeechPlannerAudioBlocks,
  writeBlindListeningReport,
} from '../src/application/speech-planner-listening-report.js';

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createBlockRecords(): SpeechPlannerEvalAttemptRecord[] {
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'] as const;
  const prompts = [
    'speech-performance-v1-restrained-natural',
    'speech-performance-v2-inworld-tts2',
  ] as const;
  return models.flatMap((requestedModel) =>
    prompts.map((promptPolicyVersion, index) => ({
      attemptId: `${requestedModel}-${index}`,
      fixtureId: 'neutral-dialogue',
      fixtureTags: ['neutral-dialogue'],
      requestedModel,
      promptPolicyVersion,
      repetition: 1,
      compatibilitySmoke: requestedModel === 'gemini-3.5-flash-lite' && index === 0,
      rawParseStatus: 'parsed' as const,
      promptedPlanStatus: 'valid' as const,
      fallbackStatus: 'not_used' as const,
      latencyMs: 10,
      costStatus: 'estimated' as const,
      estimatedCostUsd: 0.001,
      rendered: [
        {
          id: 'neutral-1',
          text: 'The train leaves at nine.',
          lexicalText: 'The train leaves at nine.',
          leadingInstructionTagCount: 0,
          voiceId: 'Ashley',
          language: 'en-US',
          deliveryMode: 'BALANCED',
        },
      ],
    })),
  );
}

describe('speech planner blocked listening report', () => {
  it('expands a selected fixture and repetition to a fair four-cell block', () => {
    const [block] = selectSpeechPlannerAudioBlocks(createBlockRecords());

    expect(block).toMatchObject({
      fixtureId: 'neutral-dialogue',
      repetition: 1,
      complete: true,
      reasons: expect.arrayContaining(['neutral']),
    });
    expect(block!.variants).toHaveLength(4);
    expect(new Set(block!.variants.map((variant) => variant.fixtureId))).toEqual(
      new Set(['neutral-dialogue']),
    );
    expect(new Set(block!.variants.map((variant) => variant.voiceId))).toEqual(new Set(['Ashley']));
    expect(new Set(block!.variants.map((variant) => variant.settingsHash)).size).toBe(1);
  });

  it('marks incomplete comparison blocks and excludes them from preference aggregation', () => {
    const records = createBlockRecords().slice(0, 3);
    const [block] = selectSpeechPlannerAudioBlocks(records);
    expect(block).toMatchObject({ complete: false, preferenceEligible: false });
  });

  it('writes seeded blind HTML without identities and a separate identity key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-listening-'));
    tempRoots.push(root);
    const synthesize = vi.fn(async ({ blindLabel }: { blindLabel: string }) => ({
      audioPath: `audio/${blindLabel}.mp3`,
      latencyMs: 100,
      durationSeconds: 2,
      bytes: 2048,
      cacheOutcome: 'miss' as const,
    }));

    await writeBlindListeningReport({
      outputDirectory: root,
      blocks: selectSpeechPlannerAudioBlocks(createBlockRecords()),
      seed: 'fixed-seed',
      synthesize,
    });

    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const key = readFileSync(join(root, 'key.json'), 'utf8');
    expect(html).not.toContain('gemini-3.5-flash-lite');
    expect(html).not.toContain('speech-performance-v2-inworld-tts2');
    expect(html).toContain('Naturalness');
    expect(html).toContain('Clarity for an ESL learner');
    expect(html).toContain('Unwanted pauses');
    expect(html).toContain('Spoken control text');
    expect(html).toContain('Pairwise preference');
    expect(html).toContain('Ranked choice');
    expect(key).toContain('gemini-3.5-flash-lite');
    expect(key).toContain('speech-performance-v2-inworld-tts2');
    expect(synthesize).toHaveBeenCalledTimes(4);
  });
});
