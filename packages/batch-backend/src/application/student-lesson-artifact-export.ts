import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listHomeworkMemoryEntries } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listLessonMemoryEntries } from '../domain/lesson-memory-repository.js';
import type { RecordingWithTranscript } from '../domain/recording-repository.js';
import { listRecordings } from '../domain/recording-repository.js';
import type { StudentRecord } from '../domain/student-model.js';
import { getStudentById } from '../domain/student-repository.js';
import type { TranscriptRecord } from '../domain/transcript-model.js';
import { listLatestTranscriptsByRecordingIdsForWorkspace } from '../domain/transcript-repository.js';
import {
  createTranscriptionStorageForUri,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';

const DEFAULT_PAGE_SIZE = 200;

export interface StudentLessonArtifactBundle {
  folderName: string;
  sortKey: string;
  transcript: TranscriptRecord;
  transcriptText: string;
  recording: RecordingWithTranscript | null;
  lessonMemory: LessonMemoryRecord | null;
  homeworkMemories: HomeworkMemoryRecord[];
}

export interface StudentLessonArtifactExportPlan {
  student: StudentRecord;
  lessons: StudentLessonArtifactBundle[];
  unmatchedHomeworkMemories: HomeworkMemoryRecord[];
}

interface StudentLessonArtifactExportDependencies {
  students: {
    getById: typeof getStudentById;
  };
  recordings: {
    list: typeof listRecordings;
  };
  transcripts: {
    listLatestByRecordingIds: typeof listLatestTranscriptsByRecordingIdsForWorkspace;
  };
  lessonMemory: {
    list: typeof listLessonMemoryEntries;
  };
  homeworkMemory: {
    list: typeof listHomeworkMemoryEntries;
  };
  transcriptStorage: {
    createForUri: (uri: string) => TranscriptionStorage;
  };
}

function defaultDependencies(): StudentLessonArtifactExportDependencies {
  return {
    students: {
      getById: getStudentById,
    },
    recordings: {
      list: listRecordings,
    },
    transcripts: {
      listLatestByRecordingIds: listLatestTranscriptsByRecordingIdsForWorkspace,
    },
    lessonMemory: {
      list: listLessonMemoryEntries,
    },
    homeworkMemory: {
      list: listHomeworkMemoryEntries,
    },
    transcriptStorage: {
      createForUri: (uri: string) => createTranscriptionStorageForUri(uri),
    },
  };
}

function compareDatesDesc(left: Date, right: Date): number {
  return right.getTime() - left.getTime();
}

function compareDatesAsc(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function formatTimestampForFile(value: Date): string {
  return value.toISOString().replaceAll(':', '-').replaceAll('.000', '');
}

function formatTimestampForDisplay(value: Date): string {
  return value.toISOString();
}

function formatDateForIndex(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function folderNameForTranscript(transcript: TranscriptRecord): string {
  return `${formatTimestampForFile(transcript.createdAt)}_${transcript.id}`;
}

function firstSentence(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) {
    return 'No summary available.';
  }
  const normalized = text.replaceAll(/\s+/g, ' ');
  const boundary = normalized.match(/[.!?](\s|$)/);
  if (!boundary || boundary.index === undefined) {
    return normalized;
  }
  return normalized.slice(0, boundary.index + 1).trim();
}

function resolveLessonIndexTopic(bundle: StudentLessonArtifactBundle): string | null {
  const latestHomework = bundle.homeworkMemories[bundle.homeworkMemories.length - 1];
  if (latestHomework?.topic?.trim()) {
    return latestHomework.topic.trim();
  }

  const lessonTopic = bundle.lessonMemory?.topicsDiscussed[0]?.topic?.trim();
  return lessonTopic && lessonTopic.length > 0 ? lessonTopic : null;
}

function renderLessonIndexBlock(bundle: StudentLessonArtifactBundle): string[] {
  const latestHomework = bundle.homeworkMemories[bundle.homeworkMemories.length - 1];
  const topic = resolveLessonIndexTopic(bundle);
  const lines = [
    `Folder: ${bundle.folderName}`,
    'Transcript: yes',
    `Lesson memory: ${bundle.lessonMemory ? 'yes' : 'no'}`,
    `Homework memory: ${bundle.homeworkMemories.length}`,
  ];

  if (topic) {
    lines.push(`Topic: ${topic}`);
  }

  if (bundle.lessonMemory?.lessonSummary) {
    lines.push(`Lesson summary: ${firstSentence(bundle.lessonMemory.lessonSummary)}`);
  }

  if (latestHomework?.homeworkSummary) {
    lines.push(`Homework summary: ${firstSentence(latestHomework.homeworkSummary)}`);
  }

  return lines;
}

function formatKeyValueBlock(entries: Array<[string, string | number | boolean | null]>): string {
  return entries
    .map(([label, value]) => `${label}: ${value === null ? 'none' : String(value)}`)
    .join('\n');
}

function formatBulletList(
  title: string,
  items: string[],
  options?: {
    emptyText?: string;
  },
): string {
  const lines = [title];
  if (items.length === 0) {
    lines.push(`- ${options?.emptyText ?? 'None'}`);
    return lines.join('\n');
  }
  return lines.concat(items.map((item) => `- ${item}`)).join('\n');
}

function formatTranscriptPreview(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return 'Transcript text is empty.';
  }
  const preview = normalized.split('\n').slice(0, 3).join(' ').replaceAll(/\s+/g, ' ');
  return preview.length > 220 ? `${preview.slice(0, 217)}...` : preview;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function groupHomeworkMemoriesByTranscript(
  transcripts: TranscriptRecord[],
  homeworkMemories: HomeworkMemoryRecord[],
): {
  homeworkByTranscriptId: Map<string, HomeworkMemoryRecord[]>;
  unmatchedHomeworkMemories: HomeworkMemoryRecord[];
} {
  const transcriptIds = new Set(transcripts.map((item) => item.id));
  const transcriptIdsByRecordingId = new Map<string, string[]>();
  for (const transcript of transcripts) {
    const existing = transcriptIdsByRecordingId.get(transcript.recordingId) ?? [];
    existing.push(transcript.id);
    transcriptIdsByRecordingId.set(transcript.recordingId, existing);
  }

  const homeworkByTranscriptId = new Map<string, HomeworkMemoryRecord[]>();
  const unmatchedHomeworkMemories: HomeworkMemoryRecord[] = [];

  for (const memory of homeworkMemories) {
    const targetTranscriptIds: string[] = [];
    if (memory.transcriptId && transcriptIds.has(memory.transcriptId)) {
      targetTranscriptIds.push(memory.transcriptId);
    } else if (memory.recordingId) {
      targetTranscriptIds.push(...(transcriptIdsByRecordingId.get(memory.recordingId) ?? []));
    }

    const uniqueTargets = [...new Set(targetTranscriptIds)];
    if (uniqueTargets.length === 0) {
      unmatchedHomeworkMemories.push(memory);
      continue;
    }

    for (const transcriptId of uniqueTargets) {
      const existing = homeworkByTranscriptId.get(transcriptId) ?? [];
      existing.push(memory);
      homeworkByTranscriptId.set(transcriptId, existing);
    }
  }

  for (const [transcriptId, items] of homeworkByTranscriptId) {
    homeworkByTranscriptId.set(
      transcriptId,
      dedupeById(items).sort((left, right) => compareDatesAsc(left.publishedAt, right.publishedAt)),
    );
  }

  return {
    homeworkByTranscriptId,
    unmatchedHomeworkMemories: dedupeById(unmatchedHomeworkMemories).sort((left, right) =>
      compareDatesAsc(left.publishedAt, right.publishedAt),
    ),
  };
}

export function buildStudentLessonArtifactExportPlan(args: {
  student: StudentRecord;
  recordings: RecordingWithTranscript[];
  transcripts: TranscriptRecord[];
  transcriptTexts: Map<string, string>;
  lessonMemories: LessonMemoryRecord[];
  homeworkMemories: HomeworkMemoryRecord[];
}): StudentLessonArtifactExportPlan {
  const recordingsById = new Map(args.recordings.map((item) => [item.id, item] as const));
  const lessonMemoryByTranscriptId = new Map<string, LessonMemoryRecord>();
  for (const item of [...args.lessonMemories].sort((left, right) =>
    compareDatesDesc(left.generatedAt, right.generatedAt),
  )) {
    if (!lessonMemoryByTranscriptId.has(item.transcriptId)) {
      lessonMemoryByTranscriptId.set(item.transcriptId, item);
    }
  }

  const { homeworkByTranscriptId, unmatchedHomeworkMemories } = groupHomeworkMemoriesByTranscript(
    args.transcripts,
    args.homeworkMemories,
  );

  const lessons = [...args.transcripts]
    .sort((left, right) => compareDatesAsc(left.createdAt, right.createdAt))
    .map((transcript) => ({
      folderName: folderNameForTranscript(transcript),
      sortKey: transcript.createdAt.toISOString(),
      transcript,
      transcriptText: args.transcriptTexts.get(transcript.id) ?? '',
      recording: recordingsById.get(transcript.recordingId) ?? null,
      lessonMemory: lessonMemoryByTranscriptId.get(transcript.id) ?? null,
      homeworkMemories: homeworkByTranscriptId.get(transcript.id) ?? [],
    }));

  return {
    student: args.student,
    lessons,
    unmatchedHomeworkMemories,
  };
}

export function renderLessonSummaryText(args: {
  studentName: string;
  lesson: StudentLessonArtifactBundle;
}): string {
  const { lesson, studentName } = args;
  const lines = [
    formatKeyValueBlock([
      ['Student', studentName],
      ['Student ID', lesson.recording?.studentId ?? lesson.lessonMemory?.studentId ?? 'unknown'],
      ['Lesson Folder', lesson.folderName],
      ['Recording ID', lesson.recording?.id ?? lesson.transcript.recordingId],
      ['Transcript ID', lesson.transcript.id],
      ['Lesson Date', formatTimestampForDisplay(lesson.transcript.createdAt)],
    ]),
    '',
    'Transcript',
    '- Present',
    `- Preview: ${formatTranscriptPreview(lesson.transcriptText)}`,
    '',
    'Lesson Memory',
    lesson.lessonMemory ? '- Present' : '- Missing',
  ];

  if (lesson.lessonMemory) {
    lines.push(`- Summary: ${lesson.lessonMemory.lessonSummary ?? 'No summary available.'}`);
    if (lesson.lessonMemory.grammarReviewed.length > 0) {
      lines.push(
        `- Grammar reviewed: ${lesson.lessonMemory.grammarReviewed.map((item) => item.name).join(', ')}`,
      );
    }
    if (lesson.lessonMemory.vocabularyFocus.length > 0) {
      lines.push(
        `- Vocabulary focus: ${lesson.lessonMemory.vocabularyFocus.map((item) => item.text).join(', ')}`,
      );
    }
  }

  lines.push('', 'Homework Memory', lesson.homeworkMemories.length > 0 ? '- Present' : '- Missing');
  if (lesson.homeworkMemories.length > 0) {
    const latestHomework = lesson.homeworkMemories[lesson.homeworkMemories.length - 1];
    if (latestHomework) {
      lines.push(`- Count: ${lesson.homeworkMemories.length}`);
      lines.push(`- Summary: ${latestHomework.homeworkSummary ?? 'No summary available.'}`);
      if (latestHomework.topic) {
        lines.push(`- Topic: ${latestHomework.topic}`);
      }
      if (latestHomework.grammarTargets.length > 0) {
        lines.push(
          `- Main targets: ${latestHomework.grammarTargets.map((item) => item.name).join(', ')}`,
        );
      }
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function renderLessonIndexText(plan: StudentLessonArtifactExportPlan): string {
  const lines = [
    formatKeyValueBlock([
      ['Student', plan.student.student],
      ['Student ID', plan.student.id],
      ['Lesson Count', plan.lessons.length],
      ['Unmatched Homework Memories', plan.unmatchedHomeworkMemories.length],
    ]),
    '',
    'Lessons',
  ];

  if (plan.lessons.length === 0) {
    lines.push('- None');
  } else {
    for (const [index, lesson] of plan.lessons.entries()) {
      lines.push(`[${index + 1}] ${formatDateForIndex(lesson.transcript.createdAt)}`);
      lines.push(...renderLessonIndexBlock(lesson));
      lines.push('');
    }
  }

  if (plan.unmatchedHomeworkMemories.length > 0) {
    lines.push('', 'Unmatched Homework Memories');
    for (const memory of plan.unmatchedHomeworkMemories) {
      lines.push(
        `- ${memory.id} | publishedAt=${formatTimestampForDisplay(memory.publishedAt)} | assignment=${memory.assignmentLineageKey} | topic=${memory.topic ?? 'none'}`,
      );
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function renderReadmeText(plan: StudentLessonArtifactExportPlan): string {
  const lines = [
    formatKeyValueBlock([
      ['Student', plan.student.student],
      ['Student ID', plan.student.id],
      ['Exported At', formatTimestampForDisplay(new Date())],
      ['Lesson Folders', plan.lessons.length],
      ['Unmatched Homework Memories', plan.unmatchedHomeworkMemories.length],
    ]),
    '',
    'Contents',
    '- Each lesson folder contains a readable summary plus the transcript, lesson memory, and homework memory text files when available.',
    '- LESSON_INDEX.txt provides a quick skim-friendly overview across the export.',
  ];

  if (plan.unmatchedHomeworkMemories.length > 0) {
    lines.push(
      '- The unmatched-homework-memory folder contains homework memory files that could not be tied back to a specific transcript or recording.',
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export function renderLessonMemoryText(memory: LessonMemoryRecord): string {
  const sections = [
    formatKeyValueBlock([
      ['Lesson Memory ID', memory.id],
      ['Student ID', memory.studentId],
      ['Transcript ID', memory.transcriptId],
      ['Recording ID', memory.recordingId],
      ['Generated At', formatTimestampForDisplay(memory.generatedAt)],
      ['Provider', memory.provider],
      ['Model', memory.model],
      ['Status', memory.status],
      ['Schema Version', memory.schemaVersion],
    ]),
    '',
    formatBulletList('Lesson Summary', [memory.lessonSummary ?? 'No summary available.']),
    '',
    formatBulletList(
      'Topics Discussed',
      memory.topicsDiscussed.map((item) => `${item.topic}: ${item.note}`),
    ),
    '',
    formatBulletList(
      'Grammar Reviewed',
      memory.grammarReviewed.map((item) => `${item.name}: ${item.note}`),
    ),
    '',
    formatBulletList(
      'Grammar Watchlist',
      memory.grammarWatchlist.map((item) => `${item.name}: ${item.note}`),
    ),
    '',
    formatBulletList(
      'Vocabulary Focus',
      memory.vocabularyFocus.map((item) => `${item.text}: ${item.note}`),
    ),
    '',
    formatBulletList(
      'Progress Signals',
      memory.progressSignals.map((item) => `${item.label}: ${item.note}`),
    ),
    '',
    formatBulletList(
      'Follow Up Recommendations',
      memory.followUpRecommendations.map((item) => `${item.label}: ${item.note}`),
    ),
  ];

  return `${sections.join('\n').trim()}\n`;
}

export function renderHomeworkMemoryText(memory: HomeworkMemoryRecord): string {
  const sections = [
    formatKeyValueBlock([
      ['Homework Memory ID', memory.id],
      ['Student ID', memory.studentId],
      ['Assignment Lineage Key', memory.assignmentLineageKey],
      ['Job ID', memory.jobId],
      ['Transcript ID', memory.transcriptId ?? 'none'],
      ['Recording ID', memory.recordingId ?? 'none'],
      ['Published At', formatTimestampForDisplay(memory.publishedAt)],
      ['Generated At', formatTimestampForDisplay(memory.generatedAt)],
      ['Provider', memory.provider],
      ['Model', memory.model],
      ['Status', memory.status],
      ['Schema Version', memory.schemaVersion],
    ]),
    '',
    formatBulletList('Homework Summary', [memory.homeworkSummary ?? 'No summary available.']),
    '',
    formatBulletList('Topic', [memory.topic ?? 'No topic available.']),
    '',
    formatBulletList(
      'Grammar Targets',
      memory.grammarTargets.map((item) => `${item.name} (${item.targetKind}): ${item.note}`),
    ),
    '',
    formatBulletList(
      'Vocabulary Targets',
      memory.vocabularyTargets.map((item) => `${item.text} (${item.targetKind}): ${item.note}`),
    ),
    '',
    formatBulletList(
      'Task List',
      memory.taskList.map(
        (item) =>
          `${item.section} [${item.taskType}]${item.review ? ' [review]' : ''}: ${item.task}`,
      ),
    ),
    '',
    formatBulletList(
      'Teacher Follow Up Cues',
      memory.teacherFollowUpCues.map((item) => `${item.cueType}: ${item.note}`),
    ),
  ];

  return `${sections.join('\n').trim()}\n`;
}

async function listAllRecordingsForStudent(
  studentId: string,
  workspaceId: string,
  deps: StudentLessonArtifactExportDependencies,
): Promise<RecordingWithTranscript[]> {
  const items: RecordingWithTranscript[] = [];
  let offset = 0;

  while (true) {
    const page = await deps.recordings.list({
      workspaceId,
      studentId,
      limit: DEFAULT_PAGE_SIZE,
      offset,
      order: 'asc',
    });
    items.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) {
      return items;
    }
    offset += DEFAULT_PAGE_SIZE;
  }
}

async function listAllLessonMemoryForStudent(
  studentId: string,
  deps: StudentLessonArtifactExportDependencies,
): Promise<LessonMemoryRecord[]> {
  const items: LessonMemoryRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await deps.lessonMemory.list({
      studentId,
      statuses: ['ready'],
      limit: DEFAULT_PAGE_SIZE,
      offset,
      order: 'desc',
    });
    items.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) {
      return items;
    }
    offset += DEFAULT_PAGE_SIZE;
  }
}

async function listAllHomeworkMemoryForStudent(
  studentId: string,
  deps: StudentLessonArtifactExportDependencies,
): Promise<HomeworkMemoryRecord[]> {
  const items: HomeworkMemoryRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await deps.homeworkMemory.list({
      studentId,
      statuses: ['ready'],
      limit: DEFAULT_PAGE_SIZE,
      offset,
      order: 'desc',
    });
    items.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) {
      return items;
    }
    offset += DEFAULT_PAGE_SIZE;
  }
}

export async function loadStudentLessonArtifactExportPlan(args: {
  studentId: string;
  overrides?: Partial<StudentLessonArtifactExportDependencies>;
}): Promise<StudentLessonArtifactExportPlan | null> {
  const deps = {
    ...defaultDependencies(),
    ...args.overrides,
    students: {
      ...defaultDependencies().students,
      ...args.overrides?.students,
    },
    recordings: {
      ...defaultDependencies().recordings,
      ...args.overrides?.recordings,
    },
    transcripts: {
      ...defaultDependencies().transcripts,
      ...args.overrides?.transcripts,
    },
    lessonMemory: {
      ...defaultDependencies().lessonMemory,
      ...args.overrides?.lessonMemory,
    },
    homeworkMemory: {
      ...defaultDependencies().homeworkMemory,
      ...args.overrides?.homeworkMemory,
    },
    transcriptStorage: {
      ...defaultDependencies().transcriptStorage,
      ...args.overrides?.transcriptStorage,
    },
  };

  const student = await deps.students.getById(args.studentId);
  if (!student) {
    return null;
  }
  if (!student.workspaceId) {
    throw new Error(`Student ${student.id} has no workspace authority`);
  }

  const recordings = await listAllRecordingsForStudent(args.studentId, student.workspaceId, deps);
  const recordingIds = recordings.map((item) => item.id);
  const transcripts =
    recordingIds.length > 0
      ? await deps.transcripts.listLatestByRecordingIds(recordingIds, student.workspaceId)
      : [];
  const transcriptTexts = new Map<string, string>();
  for (const transcript of transcripts) {
    const storage = deps.transcriptStorage.createForUri(transcript.storageUri);
    transcriptTexts.set(transcript.id, await storage.getText(transcript.storageUri));
  }

  const [lessonMemories, homeworkMemories] = await Promise.all([
    listAllLessonMemoryForStudent(args.studentId, deps),
    listAllHomeworkMemoryForStudent(args.studentId, deps),
  ]);

  return buildStudentLessonArtifactExportPlan({
    student,
    recordings,
    transcripts,
    transcriptTexts,
    lessonMemories,
    homeworkMemories,
  });
}
