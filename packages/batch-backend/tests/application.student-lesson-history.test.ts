import { describe, expect, it } from 'vitest';

import {
  buildHeuristicTranscriptAnalysis,
  extractStudentOnlyTranscript,
  mergeTranscriptAnalysis,
  normalizeTranscriptAnalysis,
  resolveStudentTrackTranscriptUri,
} from '../src/application/student-lesson-history.js';

describe('student-lesson-history helpers', () => {
  it('extracts student-only lines from timeline and stack transcript formats', () => {
    const transcript = `
[Teacher 00:00.000-00:01.000] Hello there
[Student 00:01.100-00:02.000] I am agree with this
Student: I very like this topic
Teacher: Great
`.trim();

    const studentOnly = extractStudentOnlyTranscript(transcript);
    expect(studentOnly).toContain('I am agree with this');
    expect(studentOnly).toContain('I very like this topic');
    expect(studentOnly).not.toContain('Hello there');
  });

  it('keeps multiline student turns from stack-mode transcripts', () => {
    const transcript = `
Teacher:
Hello there

Student:
I agree with this point.
Because I saw the same in class yesterday.

Teacher:
Great explanation.
`.trim();

    const studentOnly = extractStudentOnlyTranscript(transcript);
    expect(studentOnly).toContain('I agree with this point.');
    expect(studentOnly).toContain('Because I saw the same in class yesterday.');
    expect(studentOnly).not.toContain('Hello there');
    expect(studentOnly).not.toContain('Great explanation.');
  });

  it('builds heuristic analysis with vocabulary and grammar hints', () => {
    const analysis = buildHeuristicTranscriptAnalysis({
      text: 'I am agree. She go to school. I very like reading books about planets.',
      provider: 'heuristic',
      model: null,
    });

    expect(analysis.source).toBe('heuristic');
    expect(analysis.lessonSummary.length).toBeGreaterThan(0);
    expect(analysis.vocabularyFocus.length).toBeGreaterThan(0);
    expect(analysis.grammarWatchlist.join(' ')).toMatch(
      /I am agree|he\/she goes|Adverb placement/i,
    );
  });

  it('normalizes and merges transcript analysis payloads', () => {
    const normalized = normalizeTranscriptAnalysis({
      version: 1,
      generatedAt: '2026-01-10T00:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o-mini',
      lessonSummary: 'Student improved confidence.',
      vocabularyFocus: ['confidence'],
      grammarWatchlist: ['Third-person present tense agreement ("he/she goes")'],
      source: 'batch_llm',
    });
    expect(normalized).not.toBeNull();

    const merged = mergeTranscriptAnalysis({ provider: 'deepgram' }, normalized!);
    expect(merged.provider).toBe('deepgram');
    expect(merged.analysis).toBeDefined();
  });

  it('resolves student track URI from speaker track summary metadata', () => {
    const uri = resolveStudentTrackTranscriptUri({
      speakerTracks: {
        transcripts: [
          { speaker: 0, label: 'Teacher', uri: 'local://transcripts/teacher.txt' },
          { speaker: 1, label: 'Student', uri: 'local://transcripts/student.txt' },
        ],
      },
    });
    expect(uri).toBe('local://transcripts/student.txt');
  });

  it('falls back to speaker index when labels are missing', () => {
    const uri = resolveStudentTrackTranscriptUri({
      speakerTracks: {
        transcripts: [
          { speaker: 0, uri: 'local://transcripts/speaker0.txt' },
          { speaker: 1, uri: 'local://transcripts/speaker1.txt' },
        ],
      },
    });
    expect(uri).toBe('local://transcripts/speaker1.txt');
  });
});
