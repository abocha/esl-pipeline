import { describe, expect, it } from 'vitest';

import {
  formatSpeakerLabel,
  formatTranscriptFromSegments,
  mergeSegments,
  normalizeTranscriptText,
} from '../src/index.js';

describe('stt-core format helpers', () => {
  it('maps speaker labels deterministically', () => {
    expect(formatSpeakerLabel(0)).toBe('Teacher');
    expect(formatSpeakerLabel(1)).toBe('Student');
    expect(formatSpeakerLabel(2)).toBe('Speaker 3');
  });

  it('formats timeline transcripts', () => {
    const text = formatTranscriptFromSegments(
      '',
      [
        { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
        { text: 'Hi', speaker: 1, start: 1, end: 1.4 },
      ],
      'timeline',
    );

    expect(text).toContain('[Teacher 00:00] Hello');
    expect(text).toContain('[Student 00:01] Hi');
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
