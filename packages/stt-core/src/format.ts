import type { TranscriptMode, TranscriptSegment } from './types.js';

export type SpeakerLabelTopology = 'mixed_recording' | 'trusted_split_channels';

export function formatSpeakerLabel(
  index: number,
  topology: SpeakerLabelTopology = 'trusted_split_channels',
): string {
  if (topology === 'mixed_recording') return `Speaker ${index + 1}`;
  if (index === 0) return 'Teacher';
  if (index === 1) return 'Student';
  return `Speaker ${index + 1}`;
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function normalizeTranscriptText(text: string): string {
  return text.replaceAll(/(?<![\p{L}\p{N}_])ajá(?![\p{L}\p{N}_])/giu, 'Ага');
}

export function normalizeSegmentEnds<T extends { start?: number; end?: number }>(
  segments: T[],
): T[] {
  return segments.map((segment, index) => {
    if (typeof segment.end === 'number') {
      return segment;
    }
    const nextStart = segments[index + 1]?.start;
    if (typeof segment.start !== 'number' || typeof nextStart !== 'number') {
      return segment;
    }
    return {
      ...segment,
      end: nextStart,
    };
  });
}

function getGapSeconds(previousEnd?: number, nextStart?: number): number {
  const previous = typeof previousEnd === 'number' ? previousEnd : Number.NaN;
  const next = typeof nextStart === 'number' ? nextStart : Number.NaN;
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    return 0;
  }
  return next - previous;
}

export function mergeSegments(
  segments: TranscriptSegment[],
  options?: {
    utteranceGapSec?: number;
  },
): TranscriptSegment[] {
  if (segments.length === 0) return segments;
  const utteranceGapSec = options?.utteranceGapSec ?? 1.5;
  const merged: TranscriptSegment[] = [];

  for (const segment of segments) {
    const text = normalizeTranscriptText(segment.text).trim();
    if (!text) continue;

    const current: TranscriptSegment = {
      text,
      speaker: segment.speaker,
      start: segment.start,
      end: segment.end,
    };

    const previous = merged.at(-1);
    if (!previous) {
      merged.push(current);
      continue;
    }

    const canMerge =
      (previous.speaker ?? 0) === (current.speaker ?? 0) &&
      getGapSeconds(previous.end, current.start) <= utteranceGapSec;

    if (!canMerge) {
      merged.push(current);
      continue;
    }

    previous.text = `${previous.text} ${current.text}`.trim();
    if (typeof current.end === 'number') {
      previous.end = current.end;
    }
  }

  return normalizeSegmentEnds(merged).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

export function formatTranscriptFromSegments(
  transcript: string,
  segments: TranscriptSegment[],
  mode: TranscriptMode,
  topology: SpeakerLabelTopology = 'trusted_split_channels',
): string {
  if (segments.length === 0) {
    return transcript;
  }

  if (mode === 'stack') {
    const grouped = new Map<number, string[]>();
    for (const segment of segments) {
      const speaker = segment.speaker ?? 0;
      const list = grouped.get(speaker) ?? [];
      list.push(normalizeTranscriptText(segment.text));
      grouped.set(speaker, list);
    }

    return [...grouped.entries()]
      .map(([speaker, lines]) => `${formatSpeakerLabel(speaker, topology)}:\n${lines.join('\n')}`)
      .join('\n\n');
  }

  return segments
    .map((segment) => {
      const start = formatTimestamp(segment.start ?? 0);
      const speaker = formatSpeakerLabel(segment.speaker ?? 0, topology);
      return `[${speaker} ${start}] ${normalizeTranscriptText(segment.text)}`;
    })
    .join('\n');
}
