import { describe, expect, it } from 'vitest';

import { stitchPromptPayload } from '../src/application/prompt-assembly.js';

describe('application/prompt-assembly', () => {
  it('assembles explicit memory-aware prompt blocks in canonical order', () => {
    const result = stitchPromptPayload({
      template: 'HEADER\nFOOTER\n',
      profile: 'PROFILE CONTENT',
      studentMemorySnapshot: 'Snapshot summary',
      recentLessonMemory: 'Lesson entry',
      recentHomeworkMemory: 'Homework entry',
      unresolvedIssues: 'Issue entry',
      notes: 'Teacher note',
      transcript: 'Transcript text',
    });

    expect(result).not.toContain('[VOICE_CAPABILITIES]');
    expect(result).toContain('[FOUNDATIONAL_PROFILE]\nPROFILE CONTENT');
    expect(result).toContain('[STUDENT_MEMORY_SNAPSHOT]\nSnapshot summary');
    expect(result).toContain('[RECENT_LESSON_MEMORY]\nLesson entry');
    expect(result).toContain('[RECENT_HOMEWORK_MEMORY]\nHomework entry');
    expect(result).toContain('[UNRESOLVED_ISSUES]\nIssue entry');
    expect(result).toContain('[TEACHER_NOTES]\nTeacher note');
    expect(result).toContain('[LATEST_TRANSCRIPT]\nTranscript text');
    expect(result).not.toContain('[LESSON_HISTORY]');
    expect(result.indexOf('HEADER\nFOOTER')).toBeLessThan(result.indexOf('[FOUNDATIONAL_PROFILE]'));

    const expectedOrder = [
      '[FOUNDATIONAL_PROFILE]',
      '[STUDENT_MEMORY_SNAPSHOT]',
      '[RECENT_LESSON_MEMORY]',
      '[RECENT_HOMEWORK_MEMORY]',
      '[UNRESOLVED_ISSUES]',
      '[TEACHER_NOTES]',
      '[LATEST_TRANSCRIPT]',
    ];
    const positions = expectedOrder.map((marker) => result.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it('uses explicit absence markers for teacher notes when omitted', () => {
    const result = stitchPromptPayload({
      template: 'HEADER\nFOOTER\n',
      profile: 'PROFILE CONTENT',
      studentMemorySnapshot: 'No long-term student-memory snapshot available yet.',
      recentLessonMemory: 'No recent lesson-memory entries available for retrieval.',
      recentHomeworkMemory: 'No recent homework-memory entries available for retrieval.',
      unresolvedIssues:
        'No unresolved issues available because no student-memory snapshot is available yet.',
      transcript: 'Transcript text',
    });

    expect(result).toContain('[TEACHER_NOTES]\nNo teacher notes provided for this lesson.');
  });

  it('falls back to an explicit stable absence marker when a block body is blank', () => {
    const result = stitchPromptPayload({
      template: 'HEADER\nFOOTER\n',
      profile: 'PROFILE CONTENT',
      studentMemorySnapshot: '',
      recentLessonMemory: '  ',
      recentHomeworkMemory: '',
      unresolvedIssues: '',
      notes: '',
      transcript: 'Transcript text',
    });

    expect(result).toContain('[STUDENT_MEMORY_SNAPSHOT]\nNot available.');
    expect(result).toContain('[RECENT_LESSON_MEMORY]\nNot available.');
    expect(result).toContain('[RECENT_HOMEWORK_MEMORY]\nNot available.');
    expect(result).toContain('[UNRESOLVED_ISSUES]\nNot available.');
  });
});
