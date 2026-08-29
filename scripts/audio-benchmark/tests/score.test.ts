import { describe, expect, test } from 'vitest';

import {
  alignTokenStreams,
  chooseGlobalSpeakerMapping,
  createBlindLabelMapping,
  normalizeScoringText,
} from '../score';

describe('unified benchmark scoring primitives', () => {
  test('normalizes Unicode text uniformly without transliteration or grammar repair', () => {
    expect(normalizeScoringText('Ａ learner’s, ошибка!')).toEqual(['a', 'learner', 's', 'ошибка']);
  });

  test('returns deterministic substitution deletion and insertion accounting', () => {
    expect(alignTokenStreams(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toMatchObject({
      substitutions: 1,
      deletions: 0,
      insertions: 1,
      totalEdits: 2,
    });
  });

  test('chooses one global many-to-one speaker mapping across windows', () => {
    const result = chooseGlobalSpeakerMapping({
      labels: ['provider-a', 'provider-b', 'provider-c'],
      windows: [
        {
          referenceTutorTokens: ['lesson', 'plan'],
          referenceStudentTokens: ['student', 'answer'],
          providerItems: [
            { label: 'provider-a', tokens: ['student', 'answer'] },
            { label: 'provider-b', tokens: ['lesson'] },
            { label: 'provider-c', tokens: ['plan'] },
          ],
        },
        {
          referenceTutorTokens: ['feedback'],
          referenceStudentTokens: ['repair'],
          providerItems: [
            { label: 'provider-a', tokens: ['repair'] },
            { label: 'provider-b', tokens: ['feedback'] },
          ],
        },
      ],
    });

    expect(result.mapping).toEqual({
      'provider-a': 'student',
      'provider-b': 'tutor',
      'provider-c': 'tutor',
    });
    expect(result.bestObjective).toBe(0);
    expect(result.secondBestObjective).toBeGreaterThan(0);
    expect(result.margin).toBe(result.secondBestObjective);
  });

  test('creates a deterministic blind mapping from a persisted seed', () => {
    const first = createBlindLabelMapping(
      ['soniox-v5-async', 'mistral-voxtral-mini-transcribe-2', 'deepgram-nova-3'],
      'deepgram-nova-3:trusted_split_control',
      'seed-2026-08-elimination-01',
    );
    const second = createBlindLabelMapping(
      ['soniox-v5-async', 'mistral-voxtral-mini-transcribe-2', 'deepgram-nova-3'],
      'deepgram-nova-3:trusted_split_control',
      'seed-2026-08-elimination-01',
    );

    expect(first).toEqual(second);
    expect(Object.keys(first.providerToBlindLabel)).toHaveLength(4);
    expect(new Set(Object.values(first.providerToBlindLabel)).size).toBe(4);
    expect(first.providerToBlindLabel['deepgram-nova-3:trusted_split_control']).toBe('C1');
  });
});
