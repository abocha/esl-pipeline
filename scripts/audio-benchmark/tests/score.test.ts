import { describe, expect, test } from 'vitest';

import {
  alignTokenStreams,
  chooseGlobalSpeakerMapping,
  createBlindedReviewPackage,
  createBlindLabelMapping,
  normalizeScoringText,
  partitionComparisonProviders,
  validateAndCanonicalizeProviderWindowView,
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

  test('reports zero ambiguity margin for a one-label tie', () => {
    const result = chooseGlobalSpeakerMapping({
      labels: ['provider-a'],
      windows: [
        {
          referenceTutorTokens: ['same'],
          referenceStudentTokens: ['same'],
          providerItems: [{ label: 'provider-a', tokens: ['same'] }],
        },
      ],
    });

    expect(result.bestObjective).toBe(1);
    expect(result.secondBestObjective).toBe(1);
    expect(result.margin).toBe(0);
  });

  test('reports zero ambiguity margin for a multi-label tie with deterministic tie-breaking', () => {
    const result = chooseGlobalSpeakerMapping({
      labels: ['provider-a', 'provider-b'],
      windows: [],
    });

    expect(result.mapping).toEqual({ 'provider-a': 'tutor', 'provider-b': 'tutor' });
    expect(result.bestObjective).toBe(0);
    expect(result.secondBestObjective).toBe(0);
    expect(result.margin).toBe(0);
  });

  test('creates six opaque deterministic blind labels from one persisted seed', () => {
    const first = createBlindLabelMapping(
      [
        'soniox-v5-async:mixed_diarized',
        'elevenlabs-scribe-v2:mixed_diarized',
        'speechmatics-melia-1-batch:mixed_diarized',
        'mistral-voxtral-mini-transcribe-2:mixed_diarized',
        'deepgram-nova-3:mixed_diarized',
        'deepgram-nova-3:trusted_split_control',
      ],
      'seed-2026-08-elimination-01',
    );
    const second = createBlindLabelMapping(
      [
        'soniox-v5-async:mixed_diarized',
        'elevenlabs-scribe-v2:mixed_diarized',
        'speechmatics-melia-1-batch:mixed_diarized',
        'mistral-voxtral-mini-transcribe-2:mixed_diarized',
        'deepgram-nova-3:mixed_diarized',
        'deepgram-nova-3:trusted_split_control',
      ],
      'seed-2026-08-elimination-01',
    );

    expect(first).toEqual(second);
    expect(Object.keys(first.providerToBlindLabel)).toHaveLength(6);
    expect(new Set(Object.values(first.providerToBlindLabel)).size).toBe(6);
    expect(
      Object.values(first.providerToBlindLabel).every((label) => /^P[1-6]$/u.test(label)),
    ).toBe(true);
    expect(first.providerToBlindLabel['deepgram-nova-3:trusted_split_control']).toMatch(
      /^P[1-6]$/u,
    );
  });

  test('builds a blind package without control/provider/operational clues', () => {
    const mapping = createBlindLabelMapping(
      ['candidate:a', 'candidate:b', 'control:split'],
      'seed',
    );
    const review = createBlindedReviewPackage({
      campaignId: 'campaign-1',
      caseId: 'case-1',
      mapping,
      windows: [
        {
          windowId: 'A',
          startMs: 0,
          endMs: 1000,
          reference: { chronologicalText: 'reference', studentText: 's', tutorText: 't' },
          candidates: [
            {
              configurationKey: 'candidate:a',
              chronologicalText: 'a',
              studentText: 'as',
              tutorText: 'at',
            },
            {
              configurationKey: 'candidate:b',
              chronologicalText: 'b',
              studentText: 'bs',
              tutorText: 'bt',
            },
            {
              configurationKey: 'control:split',
              chronologicalText: 'c',
              studentText: 'cs',
              tutorText: 'ct',
            },
          ],
        },
      ],
    });

    const serialized = JSON.stringify(review);
    expect(review.candidateLabels).toEqual(['P1', 'P2', 'P3']);
    expect(serialized).not.toMatch(/controlOnly|providerId|model|cost|latency|control/iu);
    expect(review.windows[0]?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blindLabel: expect.stringMatching(/^P[1-3]$/u) }),
      ]),
    );
    expect(mapping.blindLabelToProvider).toHaveProperty('P1');
  });

  test('keeps the trusted split control out of the eligible candidate table', () => {
    const result = partitionComparisonProviders([
      { displayName: 'candidate', controlOnly: false, aggregate: { student: { wer: 0.8 } } },
      { displayName: 'control', controlOnly: true, aggregate: { student: { wer: 0.1 } } },
    ]);

    expect(result.eligible.map((provider) => provider.displayName)).toEqual(['candidate']);
    expect(result.control.map((provider) => provider.displayName)).toEqual(['control']);
    expect(result.eligible[0]?.displayName).not.toBe('control');
  });

  test('rejects a provider view with wrong campaign or case', () => {
    const fixture = makeProviderViewFixture();
    expect(() =>
      validateAndCanonicalizeProviderWindowView({
        ...fixture,
        view: { ...fixture.view, campaignId: 'wrong' },
      }),
    ).toThrow(/campaignId/iu);
    expect(() =>
      validateAndCanonicalizeProviderWindowView({
        ...fixture,
        view: { ...fixture.view, caseId: 'wrong' },
      }),
    ).toThrow(/caseId/iu);
  });

  test.each([
    ['altered window bound', alterFirstWindowEnd, /bounds/u],
    ['duplicate window ID', duplicateWindowId, /window.*unique|duplicate/u],
    [
      'missing window',
      (view: ProviderViewFixture['view']) => ({ ...view, windows: view.windows.slice(0, 5) }),
      /exactly six|window/u,
    ],
    ['extra window', addExtraWindow, /exactly six|window/u],
    [
      'wrong frozen-window hash',
      (view: ProviderViewFixture['view']) => ({
        ...view,
        sourceFrozenWindowsSha256: 'f'.repeat(64),
      }),
      /frozen.*hash|frozen/u,
    ],
    [
      'wrong native-artifact hash',
      (view: ProviderViewFixture['view']) => ({
        ...view,
        sourceNativeSegmentsSha256: 'f'.repeat(64),
      }),
      /native.*hash|native/u,
    ],
    ['invalid native reference', invalidateFirstReference, /native.*reference|index/u],
  ] as const)('%s is rejected before scoring', (_name, mutate, expected) => {
    const fixture = makeProviderViewFixture();
    expect(() =>
      validateAndCanonicalizeProviderWindowView({ ...fixture, view: mutate(fixture.view) }),
    ).toThrow(expected);
  });

  test.each([
    ['missing channel lineage', { ...makeNativeSegment(0), channelIndex: undefined }],
    ['lineage outside the trusted set', { ...makeNativeSegment(0), channelIndex: 2 }],
  ] as const)('rejects split control with %s', (_name, segment) => {
    const base = makeProviderViewFixture();
    const fixture = {
      ...base,
      view: { ...base.view, runMode: 'trusted_split_control' },
      expectedRunMode: 'trusted_split_control',
      native: { ...base.native, segments: [segment, ...fixtureSegments().slice(1)] },
    } satisfies ProviderViewFixture;
    expect(() => validateAndCanonicalizeProviderWindowView(fixture)).toThrow(
      /channel lineage|channelIndex/iu,
    );
  });
});

type ProviderViewFixture = Parameters<typeof validateAndCanonicalizeProviderWindowView>[0];

function makeNativeSegment(index: number): ProviderViewFixture['native']['segments'][number] {
  return {
    index,
    kind: 'word',
    startMs: index * 1000 + 100,
    endMs: index * 1000 + 200,
    text: `word-${index}`,
    speakerLabel: `speaker-${index % 2}`,
    channelIndex: index % 2,
  };
}

function fixtureSegments(): ProviderViewFixture['native']['segments'] {
  return Array.from({ length: 6 }, (_, index) => makeNativeSegment(index));
}

function makeProviderViewFixture(
  overrides: Partial<ProviderViewFixture> = {},
): ProviderViewFixture {
  const frozenWindows = Array.from({ length: 6 }, (_, index) => ({
    windowId: String.fromCharCode(65 + index),
    startMs: index * 1000,
    endMs: index * 1000 + 500,
  }));
  const segments = overrides.native?.segments ?? fixtureSegments();
  const view = {
    schemaVersion: '1.0',
    kind: 'provider_window_views',
    campaignId: 'campaign-1',
    caseId: 'case-1',
    providerId: 'deepgram-nova-3',
    runId: 'run-1',
    runMode: overrides.view?.runMode ?? 'mixed_diarized',
    sourceFrozenWindowsPath: 'frozen-windows.json',
    sourceFrozenWindowsSha256: 'a'.repeat(64),
    sourceNativeSegmentsPath: 'native-segments.json',
    sourceNativeSegmentsSha256: 'b'.repeat(64),
    sourceRawResponsePath: 'raw/001.response',
    windows: frozenWindows.map((window, index) => ({
      ...window,
      chronologicalText: `word-${index}`,
      nativeReferences: [
        {
          ...segments[index],
          nativeIndex: index,
          nativeSpeakerLabel: segments[index]?.speakerLabel,
        },
      ],
    })),
  };
  return {
    view: { ...view, ...overrides.view },
    expectedCampaignId: 'campaign-1',
    expectedCaseId: 'case-1',
    expectedProviderId: 'deepgram-nova-3',
    expectedRunId: 'run-1',
    expectedRunMode: overrides.view?.runMode ?? 'mixed_diarized',
    expectedFrozenWindowsPath: 'frozen-windows.json',
    expectedNativeSegmentsPath: 'native-segments.json',
    expectedRawResponsePath: 'raw/001.response',
    frozenWindows,
    frozenWindowsSha256: 'a'.repeat(64),
    nativeArtifactSha256: 'b'.repeat(64),
    native: { providerId: 'deepgram-nova-3', segments },
  };
}

function alterFirstWindowEnd(view: ProviderViewFixture['view']): ProviderViewFixture['view'] {
  const windows = [...view.windows];
  windows[0] = { ...windows[0], endMs: 999 };
  return { ...view, windows };
}

function duplicateWindowId(view: ProviderViewFixture['view']): ProviderViewFixture['view'] {
  const windows = [...view.windows];
  windows[1] = { ...windows[1], windowId: 'A' };
  return { ...view, windows };
}

function addExtraWindow(view: ProviderViewFixture['view']): ProviderViewFixture['view'] {
  return { ...view, windows: [...view.windows, { ...view.windows[0], windowId: 'G' }] };
}

function invalidateFirstReference(view: ProviderViewFixture['view']): ProviderViewFixture['view'] {
  const windows = [...view.windows];
  windows[0] = {
    ...windows[0],
    nativeReferences: [{ ...windows[0]?.nativeReferences[0], nativeIndex: 999 }],
  };
  return { ...view, windows };
}
