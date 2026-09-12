import { describe, expect, it } from 'vitest';

import {
  formatSpeakerLabel,
  formatTranscriptFromSegments,
  mergeSegments,
  normalizeTranscriptText,
} from '../src/index.js';

describe('stt-core format helpers', () => {
  it('uses anonymous labels for mixed diarization and channel roles for trusted audio', () => {
    expect(formatSpeakerLabel(0, 'mixed_recording')).toBe('Speaker 1');
    expect(formatSpeakerLabel(1, 'mixed_recording')).toBe('Speaker 2');
    expect(formatSpeakerLabel(0, 'trusted_split_channels')).toBe('Teacher');
    expect(formatSpeakerLabel(1, 'trusted_split_channels')).toBe('Student');
  });

  it('formats timeline transcripts', () => {
    const text = formatTranscriptFromSegments(
      '',
      [
        { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
        { text: 'Hi', speaker: 1, start: 1, end: 1.4 },
      ],
      'timeline',
      'mixed_recording',
    );

    expect(text).toContain('[Speaker 1 00:00] Hello');
    expect(text).toContain('[Speaker 2 00:01] Hi');
    expect(text).not.toContain('00:00.000-00:00.500');
  });

  it('formats attributed and unattributed non-speech events without inventing metadata', () => {
    expect(
      formatTranscriptFromSegments(
        '',
        [
          { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
          { text: '[cough]', kind: 'non_speech', speaker: 1, start: 1.2, end: 1.4 },
          { text: '[laughter]', kind: 'non_speech' },
          { text: 'Hi', speaker: 1, start: 2, end: 2.4 },
        ],
        'timeline',
        'mixed_recording',
      ),
    ).toBe('[Speaker 1 00:00] Hello\n[Speaker 2 00:01] [cough]\n[laughter]\n[Speaker 2 00:02] Hi');
  });

  it('merges adjacent same-speaker segments under gap threshold', () => {
    const merged = mergeSegments([
      { text: 'Hello', speaker: 0, start: 0, end: 0.4 },
      { text: 'there', speaker: 0, start: 0.6, end: 0.9 },
      { text: 'Hi', speaker: 1, start: 2, end: 2.4 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.text).toBe('Hello there');
    expect(merged[1]?.speaker).toBe(1);
  });

  it('preserves default merge timing assignment semantics', () => {
    expect(
      mergeSegments([
        { text: 'later', speaker: 0, start: 10, end: 11 },
        { text: 'earlier', speaker: 0, start: 0, end: 1 },
      ]),
    ).toEqual([{ text: 'later earlier', speaker: 0, start: 10, end: 1 }]);
  });

  it('keeps the temporal envelope when merging out-of-order overlapping intervals', () => {
    expect(
      mergeSegments(
        [
          { text: 'later', speaker: 0, start: 10, end: 12 },
          { text: 'earlier', speaker: 0, start: 9, end: 11 },
          { text: 'overlap', speaker: 0, start: 11.5, end: 13 },
        ],
        { preserveSegmentTimings: true },
      ),
    ).toEqual([{ text: 'later earlier overlap', speaker: 0, start: 9, end: 13 }]);
  });

  it('preserves non-speech events and their missing timing through merging', () => {
    expect(
      mergeSegments([
        { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
        { text: '[cough]', kind: 'non_speech', speaker: 0, start: 0.6 },
        { text: 'there', speaker: 0, start: 0.7, end: 1 },
      ]),
    ).toEqual([
      { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
      { text: '[cough]', kind: 'non_speech', speaker: 0, start: 0.6 },
      { text: 'there', speaker: 0, start: 0.7, end: 1 },
    ]);
  });

  it('does not merge far-apart backward disjoint intervals', () => {
    expect(
      mergeSegments(
        [
          { text: 'later', speaker: 0, start: 10, end: 11 },
          { text: 'earlier', speaker: 0, start: 0, end: 1 },
        ],
        { preserveSegmentTimings: true },
      ),
    ).toEqual([
      { text: 'earlier', speaker: 0, start: 0, end: 1 },
      { text: 'later', speaker: 0, start: 10, end: 11 },
    ]);
  });

  it('merges coincident point timings and nearby backward intervals', () => {
    expect(
      mergeSegments(
        [
          { text: 'point one', speaker: 0, start: 5, end: 5 },
          { text: 'point two', speaker: 0, start: 5, end: 5 },
        ],
        { preserveSegmentTimings: true },
      ),
    ).toEqual([{ text: 'point one point two', speaker: 0, start: 5, end: 5 }]);

    expect(
      mergeSegments(
        [
          { text: 'later', speaker: 0, start: 10, end: 11 },
          { text: 'nearby earlier', speaker: 0, start: 9, end: 9.5 },
        ],
        { preserveSegmentTimings: true },
      ),
    ).toEqual([{ text: 'later nearby earlier', speaker: 0, start: 9, end: 11 }]);
  });

  it('normalizes common Deepgram multilingual transcript quirks', () => {
    expect(normalizeTranscriptText('Ajá, I see. ajá.')).toBe('Ага, I see. Ага.');
  });
});
