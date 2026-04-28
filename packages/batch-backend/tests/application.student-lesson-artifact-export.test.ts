import { describe, expect, it } from 'vitest';

import {
  buildStudentLessonArtifactExportPlan,
  renderLessonIndexText,
  renderLessonSummaryText,
} from '../src/application/student-lesson-artifact-export.js';
import type { HomeworkMemoryRecord } from '../src/domain/homework-memory-model.js';
import type { LessonMemoryRecord } from '../src/domain/lesson-memory-model.js';
import type { RecordingWithTranscript } from '../src/domain/recording-repository.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';

function createRecording(
  overrides: Partial<RecordingWithTranscript> = {},
): RecordingWithTranscript {
  return {
    id: 'recording-1',
    source: 'upload',
    studentId: 'student-1',
    sourcePath: '/lessons/lesson-1.m4a',
    storageUri: 'local://recordings/recording-1.m4a',
    sha256: null,
    bytes: 128,
    durationSec: 1800,
    channels: 1,
    status: 'transcribed',
    transcriptId: 'transcript-1',
    error: null,
    createdAt: new Date('2026-04-01T09:00:00.000Z'),
    updatedAt: new Date('2026-04-01T09:00:00.000Z'),
    ...overrides,
  };
}

function createTranscript(overrides: Partial<TranscriptRecord> = {}): TranscriptRecord {
  return {
    id: 'transcript-1',
    recordingId: 'recording-1',
    storageUri: 'local://transcripts/transcript-1.txt',
    rawResponseUri: null,
    mode: 'timeline',
    model: 'nova-3',
    language: 'en',
    sttProvider: 'deepgram',
    fallbackUsed: false,
    summaryJson: null,
    createdAt: new Date('2026-04-01T09:05:00.000Z'),
    updatedAt: new Date('2026-04-01T09:10:00.000Z'),
    ...overrides,
  };
}

function createLessonMemory(overrides: Partial<LessonMemoryRecord> = {}): LessonMemoryRecord {
  return {
    id: 'lesson-memory-1',
    studentId: 'student-1',
    transcriptId: 'transcript-1',
    recordingId: 'recording-1',
    schemaVersion: 'lesson-memory.v1',
    generatedAt: new Date('2026-04-01T10:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.4-mini',
    status: 'ready',
    sourceKind: 'lesson_transcript',
    generationNotes: null,
    lessonSummary: 'Student discussed weekend plans and recent workload.',
    topicsDiscussed: [{ topic: 'weekend plans', note: 'Talked about visiting family.' }],
    mistakePatterns: [],
    grammarReviewed: [{ name: 'present perfect', note: 'Compared with past simple.' }],
    grammarWatchlist: [],
    vocabularyFocus: [{ text: 'deadline', note: 'Needs more active recall.' }],
    pronunciationFocus: [],
    studentFacts: [],
    progressSignals: [{ label: 'fluency', note: 'Longer turns with fewer pauses.' }],
    followUpRecommendations: [{ label: 'next lesson', note: 'Review present perfect briefly.' }],
    supersededById: null,
    supersededAt: null,
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    ...overrides,
  };
}

function createHomeworkMemory(overrides: Partial<HomeworkMemoryRecord> = {}): HomeworkMemoryRecord {
  return {
    id: 'homework-memory-1',
    studentId: 'student-1',
    jobId: 'job-1',
    assignmentLineageKey: 'assignment-1',
    promptPackageId: 'prompt-package-1',
    draftId: 'draft-1',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    schemaVersion: 'homework-memory.v1',
    generatedAt: new Date('2026-04-01T11:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.4-mini',
    status: 'ready',
    sourceKind: 'published_assignment',
    contentHash: 'hash-1',
    generationNotes: null,
    homeworkSummary: 'Homework focused on polite scheduling language.',
    topic: 'making arrangements',
    grammarTargets: [{ name: 'polite requests', note: 'Use could/would', targetKind: 'new' }],
    vocabularyTargets: [
      { text: 'reschedule', note: 'Practice in short replies.', targetKind: 'review' },
    ],
    reviewTargets: [],
    taskList: [
      {
        section: 'mission',
        task: 'Write a short rescheduling message.',
        taskType: 'mission',
        review: false,
      },
    ],
    pronunciationFocus: [],
    studyTextType: 'dialogue',
    inputType: 'generate',
    communicativeOutcome: 'Arrange a new meeting time clearly.',
    teacherFollowUpCues: [{ cueType: 'warm_up', note: 'Start with a quick scheduling roleplay.' }],
    publishedAt: new Date('2026-04-01T11:00:00.000Z'),
    publishTargets: [],
    supersededById: null,
    supersededAt: null,
    createdAt: new Date('2026-04-01T11:00:00.000Z'),
    updatedAt: new Date('2026-04-01T11:00:00.000Z'),
    ...overrides,
  };
}

describe('application/student-lesson-artifact-export', () => {
  it('groups transcripts with their lesson and homework memories', () => {
    const plan = buildStudentLessonArtifactExportPlan({
      student: {
        id: 'student-1',
        student: 'Alice Example',
        dbId: null,
        pageParentId: null,
        colorPreset: null,
        voices: {},
        manifestPreset: null,
        accentPreference: null,
        profileId: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      recordings: [createRecording()],
      transcripts: [
        createTranscript(),
        createTranscript({
          id: 'transcript-2',
          recordingId: 'recording-2',
          createdAt: new Date('2026-04-02T09:05:00.000Z'),
          updatedAt: new Date('2026-04-02T09:10:00.000Z'),
        }),
      ],
      transcriptTexts: new Map([
        ['transcript-1', 'Teacher: Hello\nStudent: Hi'],
        ['transcript-2', 'Teacher: How was homework?\nStudent: Good'],
      ]),
      lessonMemories: [
        createLessonMemory(),
        createLessonMemory({
          id: 'lesson-memory-2',
          transcriptId: 'transcript-2',
          recordingId: 'recording-2',
          lessonSummary: 'Student reflected on homework progress.',
        }),
      ],
      homeworkMemories: [
        createHomeworkMemory(),
        createHomeworkMemory({
          id: 'homework-memory-unmatched',
          assignmentLineageKey: 'assignment-unmatched',
          transcriptId: null,
          recordingId: null,
          topic: 'orphaned assignment',
        }),
      ],
    });

    expect(plan.lessons).toHaveLength(2);
    const firstLesson = plan.lessons[0];
    expect(firstLesson).toBeDefined();
    expect(firstLesson).toMatchObject({
      transcript: { id: 'transcript-1' },
      lessonMemory: { id: 'lesson-memory-1' },
    });
    expect(firstLesson?.homeworkMemories.map((item) => item.id)).toEqual(['homework-memory-1']);
    expect(plan.unmatchedHomeworkMemories.map((item) => item.id)).toEqual([
      'homework-memory-unmatched',
    ]);
  });

  it('renders a readable lesson summary with presence markers', () => {
    const summary = renderLessonSummaryText({
      studentName: 'Alice Example',
      lesson: {
        folderName: '2026-04-01T09-05-00Z_transcript-1',
        sortKey: '2026-04-01T09:05:00.000Z',
        transcript: createTranscript(),
        transcriptText: 'Teacher: Hello\nStudent: Hi',
        recording: createRecording(),
        lessonMemory: createLessonMemory(),
        homeworkMemories: [createHomeworkMemory()],
      },
    });

    expect(summary).toContain('Student: Alice Example');
    expect(summary).toContain('Transcript');
    expect(summary).toContain('- Present');
    expect(summary).toContain('Lesson Memory');
    expect(summary).toContain('Homework Memory');
    expect(summary).toContain('Student discussed weekend plans and recent workload.');
    expect(summary).toContain('Homework focused on polite scheduling language.');
  });

  it('renders a top-level lesson index with unmatched homework notes', () => {
    const plan = buildStudentLessonArtifactExportPlan({
      student: {
        id: 'student-1',
        student: 'Alice Example',
        dbId: null,
        pageParentId: null,
        colorPreset: null,
        voices: {},
        manifestPreset: null,
        accentPreference: null,
        profileId: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      recordings: [createRecording()],
      transcripts: [createTranscript()],
      transcriptTexts: new Map([['transcript-1', 'Teacher: Hello\nStudent: Hi']]),
      lessonMemories: [createLessonMemory()],
      homeworkMemories: [
        createHomeworkMemory(),
        createHomeworkMemory({
          id: 'homework-memory-unmatched',
          assignmentLineageKey: 'assignment-unmatched',
          transcriptId: null,
          recordingId: null,
          topic: 'orphaned assignment',
        }),
      ],
    });

    const index = renderLessonIndexText(plan);

    expect(index).toContain('Student: Alice Example');
    expect(index).toContain('Lesson Count: 1');
    expect(index).toContain('Unmatched Homework Memories: 1');
    expect(index).toContain('[1] 2026-04-01');
    expect(index).toContain('Folder: 2026-04-01T09-05-00Z_transcript-1');
    expect(index).toContain('Transcript: yes');
    expect(index).toContain('Lesson memory: yes');
    expect(index).toContain('Homework memory: 1');
    expect(index).toContain('Topic: making arrangements');
    expect(index).toContain('Lesson summary: Student discussed weekend plans and recent workload.');
    expect(index).toContain('Homework summary: Homework focused on polite scheduling language.');
  });
});
