import { describe, expect, test } from 'vitest';

import { deriveComparableSegments } from '../normalize';

describe('benchmark output layers', () => {
  test('reconstructs Soniox token text verbatim within speaker and language boundaries', () => {
    const result = deriveComparableSegments(
      [
        {
          index: 0,
          kind: 'token',
          startMs: 0,
          endMs: 100,
          text: 'Hell',
          speakerLabel: '1',
          language: 'en',
        },
        {
          index: 1,
          kind: 'token',
          startMs: 100,
          endMs: 200,
          text: 'o,',
          speakerLabel: '1',
          language: 'en',
        },
        {
          index: 2,
          kind: 'token',
          startMs: 200,
          endMs: 300,
          text: ' this',
          speakerLabel: '1',
          language: 'en',
        },
        {
          index: 3,
          kind: 'token',
          startMs: 300,
          endMs: 400,
          text: '!',
          speakerLabel: '1',
          language: 'en',
        },
        {
          index: 4,
          kind: 'token',
          startMs: 400,
          endMs: 500,
          text: 'При',
          speakerLabel: '1',
          language: 'ru',
        },
        {
          index: 5,
          kind: 'token',
          startMs: 500,
          endMs: 600,
          text: 'вет',
          speakerLabel: '1',
          language: 'ru',
        },
        {
          index: 6,
          kind: 'token',
          startMs: 600,
          endMs: 700,
          text: 'Нет',
          speakerLabel: '2',
          language: 'ru',
        },
        {
          index: 7,
          kind: 'token',
          startMs: 700,
          endMs: 800,
          text: ' yes',
          speakerLabel: '2',
          language: 'en',
        },
      ],
      'soniox-v5-async',
    );

    expect(result.map((segment) => segment.text)).toEqual([
      'Hello, this!',
      'Привет',
      'Нет',
      ' yes',
    ]);
    expect(result.map((segment) => segment.speakerKey)).toEqual(['S1', 'S1', 'S2', 'S2']);
  });

  test('keeps provider lexical content and assigns anonymous stable speaker keys', () => {
    const result = deriveComparableSegments([
      {
        index: 0,
        kind: 'word',
        startMs: 0,
        endMs: 300,
        text: 'ajá',
        speakerLabel: 'provider-speaker-7',
      },
      {
        index: 1,
        kind: 'word',
        startMs: 301,
        endMs: 600,
        text: 'hello',
        speakerLabel: 'provider-speaker-7',
      },
      {
        index: 2,
        kind: 'word',
        startMs: 700,
        endMs: 900,
        text: 'да',
        speakerLabel: 'provider-speaker-2',
      },
    ]);

    expect(result.map((segment) => segment.text)).toEqual(['ajá hello', 'да']);
    expect(result.map((segment) => segment.speakerKey)).toEqual(['S1', 'S2']);
    expect(result[0]?.nativeSpeakerLabel).toBe('provider-speaker-7');
    expect(result[1]?.nativeSpeakerLabel).toBe('provider-speaker-2');
    expect(result[0]?.text).not.toContain('Ага');
  });

  test('does not invent speaker roles from provider labels or order', () => {
    const result = deriveComparableSegments([
      {
        index: 0,
        kind: 'word',
        startMs: 0,
        endMs: 100,
        text: 'first',
        speakerLabel: 'teacher-ish',
      },
    ]);

    expect(result[0]).not.toHaveProperty('role');
    expect(result[0]?.nativeSpeakerLabel).toBe('teacher-ish');
    expect(result[0]?.speakerKey).toBe('S1');
  });

  test('keeps channel lineage distinct when provider speaker labels collide', () => {
    const result = deriveComparableSegments([
      {
        index: 0,
        kind: 'word',
        startMs: 0,
        endMs: 100,
        text: 'left',
        speakerLabel: '0',
        channelIndex: 0,
      },
      {
        index: 1,
        kind: 'word',
        startMs: 0,
        endMs: 100,
        text: 'right',
        speakerLabel: '0',
        channelIndex: 1,
      },
    ]);

    expect(result.map((segment) => segment.speakerKey)).toEqual(['S1', 'S2']);
    expect(result.map((segment) => segment.channelIndex)).toEqual([0, 1]);
    expect(result.map((segment) => segment.nativeSpeakerLabel)).toEqual(['0', '0']);
  });

  test('uses channel lineage without manufacturing a native speaker label', () => {
    const result = deriveComparableSegments([
      {
        index: 0,
        kind: 'word',
        startMs: 0,
        endMs: 100,
        text: 'left',
        channelIndex: 0,
      },
      {
        index: 1,
        kind: 'word',
        startMs: 0,
        endMs: 100,
        text: 'right',
        channelIndex: 1,
      },
    ]);

    expect(result.map((segment) => segment.speakerKey)).toEqual(['S1', 'S2']);
    expect(result.map((segment) => segment.nativeSpeakerLabel)).toEqual([undefined, undefined]);
  });
});
