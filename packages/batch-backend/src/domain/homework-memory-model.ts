import { z } from 'zod';

import type { PublishTarget } from '@esl-pipeline/contracts';

export type HomeworkMemoryEntryStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type HomeworkMemorySourceKind = 'published_assignment';
export type HomeworkMemoryInputType = 'generate' | 'authentic';
export type HomeworkMemoryStudyTextType = 'monologue' | 'dialogue';
export type HomeworkMemoryPronunciationMode =
  | 'shadow_sentence'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'connected_speech'
  | 'minimal_pair'
  | 'other';
export type HomeworkMemoryTaskType =
  | 'roadmap'
  | 'input'
  | 'grammar'
  | 'vocabulary'
  | 'controlled_practice'
  | 'comprehension'
  | 'pronunciation'
  | 'mission'
  | 'teacher_follow_up'
  | 'other';
export type HomeworkMemoryTargetKind = 'new' | 'review' | 'mixed';
export type HomeworkMemoryFollowUpCueType = 'warm_up' | 'error_focus' | 'monitoring' | 'other';

export interface HomeworkMemoryNamedTarget {
  name: string;
  note: string;
  targetKind: HomeworkMemoryTargetKind;
}

export interface HomeworkMemoryVocabularyTarget {
  text: string;
  note: string;
  targetKind: HomeworkMemoryTargetKind;
}

export interface HomeworkMemoryLabeledNote {
  label: string;
  note: string;
}

export interface HomeworkMemoryTaskEntry {
  section: string;
  task: string;
  taskType: HomeworkMemoryTaskType;
  review: boolean;
}

export interface HomeworkMemoryPronunciationFocusEntry {
  mode: HomeworkMemoryPronunciationMode;
  target: string;
  action: string;
}

export interface HomeworkMemoryTeacherFollowUpCue {
  cueType: HomeworkMemoryFollowUpCueType;
  note: string;
}

export interface HomeworkMemoryPublishTarget {
  target: PublishTarget;
  url?: string | null;
  jobId?: string | null;
  publishedAt?: string | null;
}

export type HomeworkMemoryGenerationNotes = Record<string, unknown>;

export interface HomeworkMemoryRecord {
  id: string;
  studentId: string;
  jobId: string;
  assignmentLineageKey: string;
  promptPackageId?: string | null;
  draftId?: string | null;
  lessonId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  schemaVersion: string;
  generatedAt: Date;
  provider: string;
  model: string;
  status: HomeworkMemoryEntryStatus;
  sourceKind: HomeworkMemorySourceKind;
  contentHash?: string | null;
  generationNotes?: HomeworkMemoryGenerationNotes | null;
  homeworkSummary?: string | null;
  topic?: string | null;
  grammarTargets: HomeworkMemoryNamedTarget[];
  vocabularyTargets: HomeworkMemoryVocabularyTarget[];
  reviewTargets: HomeworkMemoryLabeledNote[];
  taskList: HomeworkMemoryTaskEntry[];
  pronunciationFocus: HomeworkMemoryPronunciationFocusEntry[];
  studyTextType?: HomeworkMemoryStudyTextType | null;
  inputType?: HomeworkMemoryInputType | null;
  communicativeOutcome?: string | null;
  teacherFollowUpCues: HomeworkMemoryTeacherFollowUpCue[];
  publishedAt: Date;
  publishTargets: HomeworkMemoryPublishTarget[];
  supersededById?: string | null;
  supersededAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const HomeworkMemoryEntryStatusSchema = z.enum(['pending', 'ready', 'failed', 'superseded']);
export const HomeworkMemorySourceKindSchema = z.enum(['published_assignment']);
export const HomeworkMemoryInputTypeSchema = z.enum(['generate', 'authentic']);
export const HomeworkMemoryStudyTextTypeSchema = z.enum(['monologue', 'dialogue']);
export const HomeworkMemoryPronunciationModeSchema = z.enum([
  'shadow_sentence',
  'intonation',
  'rhythm_chunking',
  'sentence_stress',
  'connected_speech',
  'minimal_pair',
  'other',
]);
export const HomeworkMemoryTaskTypeSchema = z.enum([
  'roadmap',
  'input',
  'grammar',
  'vocabulary',
  'controlled_practice',
  'comprehension',
  'pronunciation',
  'mission',
  'teacher_follow_up',
  'other',
]);
export const HomeworkMemoryTargetKindSchema = z.enum(['new', 'review', 'mixed']);
export const HomeworkMemoryFollowUpCueTypeSchema = z.enum([
  'warm_up',
  'error_focus',
  'monitoring',
  'other',
]);
