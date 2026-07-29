import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildSpeechPlannerEvalMatrix,
  loadOfflineSpeechPlannerOutputs,
  loadSpeechPlannerEvalControls,
  loadSpeechPlannerEvalFixtures,
  loadSpeechPlannerPriceSnapshot,
} from '../src/application/speech-planner-eval-fixtures.js';

describe('speech planner evaluation fixtures', () => {
  it('expands the fixed public baseline to 120 stable unique attempts', () => {
    const fixtures = loadSpeechPlannerEvalFixtures();
    const controls = loadSpeechPlannerEvalControls();
    const matrix = buildSpeechPlannerEvalMatrix({ fixtures, repetitions: 3 });

    expect(fixtures).toHaveLength(10);
    expect(fixtures.every((fixture) => fixture.prepared.selection.model === 'inworld-tts-2')).toBe(
      true,
    );
    expect(controls).toEqual([
      expect.objectContaining({
        id: 'tts-1-5-identity-rendering',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        prepared: expect.objectContaining({
          selection: { provider: 'inworld', model: 'inworld-tts-1.5-max' },
        }),
      }),
    ]);
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(10);
    expect(matrix).toHaveLength(120);
    expect(new Set(matrix.map((entry) => entry.attemptId)).size).toBe(120);
    expect(new Set(matrix.map((entry) => entry.model))).toEqual(
      new Set(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']),
    );
    expect(new Set(matrix.map((entry) => entry.promptPolicyVersion))).toEqual(
      new Set(['speech-performance-v1-restrained-natural', 'speech-performance-v2-inworld-tts2']),
    );
    expect(matrix.filter((entry) => entry.compatibilitySmoke)).toHaveLength(1);
    expect(matrix[0]?.attemptId).toMatch(/^[a-z0-9-]+-[a-f0-9]{12}$/);
  });

  it('covers the approved synthetic corpus categories without private identifiers', () => {
    const fixtures = loadSpeechPlannerEvalFixtures();
    const tags = new Set(fixtures.flatMap((fixture) => fixture.tags));

    expect(tags).toEqual(
      expect.objectContaining({
        has: expect.any(Function),
      }),
    );
    for (const required of [
      'neutral-dialogue',
      'warm',
      'concerned',
      'excited',
      'reflective',
      'serious',
      'explicit-slow',
      'explicit-brisk',
      'punctuation-pressure',
      'natural-nonverbal',
      'inappropriate-nonverbal',
      'compatible-direction',
      'contradiction-trap',
      'emphasis',
      'tts2-control-safety',
    ]) {
      expect(tags.has(required), `missing ${required}`).toBe(true);
    }
    expect(JSON.stringify(fixtures)).not.toMatch(/student[_ -]?id|learner[_ -]?id|issue-154/i);
  });

  it('loads dated prices and raw offline classifications without constructing providers', () => {
    const snapshot = loadSpeechPlannerPriceSnapshot();
    const outputs = loadOfflineSpeechPlannerOutputs();

    expect(snapshot.version).toBe('gemini-standard-text-2026-07-28');
    expect(snapshot.perMillionTokens).toEqual({
      'gemini-3.1-flash-lite': { input: 0.25, outputIncludingThinking: 1.5 },
      'gemini-3.5-flash-lite': { input: 0.3, outputIncludingThinking: 2.5 },
    });
    expect(new Set(outputs.map((fixture) => fixture.expectedClassification))).toEqual(
      new Set(['valid', 'invalid', 'fallback_triggering', 'unsafe_cue', 'provider_error']),
    );
    expect(outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'live-warm-laugh-cue-too-long',
          fixtureId: 'warm-laugh',
          expectedClassification: 'unsafe_cue',
        }),
        {
          id: 'transient-unavailable',
          fixtureId: 'neutral-dialogue',
          expectedClassification: 'provider_error',
          normalizedErrorCategory: 'UNAVAILABLE',
          retryAttempted: false,
          contentHash: 'e8b5657db5b50ea68c68e70cbf3a15a7232bdaf86d5c673422528e083013eb31',
        },
      ]),
    );
    expect(outputs.every((fixture) => /^[a-f0-9]{64}$/.test(fixture.contentHash))).toBe(true);
  });

  it('rejects unknown offline classification labels', () => {
    const rawText = '{"segments":[]}';
    const path = join(tmpdir(), `speech-planner-output-${process.pid}-${Date.now()}.json`);
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: 'misspelled-classification',
          fixtureId: 'neutral-dialogue',
          rawText,
          expectedClassification: 'validd',
          contentHash: createHash('sha256').update(rawText).digest('hex'),
        },
      ]),
    );

    try {
      expect(() => loadOfflineSpeechPlannerOutputs(path)).toThrow('Unknown offline classification');
    } finally {
      rmSync(path, { force: true });
    }
  });
});
