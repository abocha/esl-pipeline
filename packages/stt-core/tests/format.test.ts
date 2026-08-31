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

  it('normalizes common Deepgram multilingual transcript quirks', () => {
    expect(normalizeTranscriptText('Ajá, I see. ajá.')).toBe('Ага, I see. Ага.');
  });
});
