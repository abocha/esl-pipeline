import { z } from 'zod';

export type MemoryConfidence = 'low' | 'medium' | 'high';
export type StudentFactAuthority = 'teacher_confirmed' | 'student_stated' | 'model_inferred';
export type LessonMemoryEntryStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type LessonMemorySourceKind = 'lesson_transcript';

export interface FactEvidence {
  quote: string;
  speakerRole?: 'student' | 'teacher' | null;
  evidenceNote?: string | null;
  transcriptSpan?: string | null;
}

export interface MistakeEvidence {
  observedForm: string;
  suggestedTarget?: string | null;
  evidenceQuote?: string | null;
  evidenceNote?: string | null;
  confidenceNote?: string | null;
}

export interface PronunciationEvidence {
  observedIssue: string;
  focusWords: string[];
  evidenceQuote?: string | null;
  evidenceNote?: string | null;
  confidenceNote?: string | null;
}

export interface StudentFact {
  fact: string;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  evidence: FactEvidence[];
  reviewNeeded: boolean;
}

export interface NamedNote {
  name: string;
  note: string;
}

export interface LabeledNote {
  label: string;
  note: string;
}

export interface TextNote {
  text: string;
  note: string;
}

export interface TopicNote {
  topic: string;
  note: string;
}

export interface MistakePattern {
  label: string;
  explanation: string;
  reviewRecommended: boolean;
  confidence: MemoryConfidence;
  evidence: MistakeEvidence[];
}

export interface PronunciationFocusEntry {
  label: string;
  note: string;
  confidence: MemoryConfidence;
  evidence: PronunciationEvidence[];
}

export type LessonMemoryGenerationNotes = Record<string, unknown>;

export interface LessonMemoryRecord {
  id: string;
  studentId: string;
  transcriptId: string;
  recordingId: string;
  schemaVersion: string;
  generatedAt: Date;
  provider: string;
  model: string;
  status: LessonMemoryEntryStatus;
  sourceKind: LessonMemorySourceKind;
  generationNotes?: LessonMemoryGenerationNotes | null;
  lessonSummary?: string | null;
  topicsDiscussed: TopicNote[];
  mistakePatterns: MistakePattern[];
  grammarReviewed: NamedNote[];
  grammarWatchlist: NamedNote[];
  vocabularyFocus: TextNote[];
  pronunciationFocus: PronunciationFocusEntry[];
  studentFacts: StudentFact[];
  progressSignals: LabeledNote[];
  followUpRecommendations: LabeledNote[];
  supersededById?: string | null;
  supersededAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const MemoryConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const StudentFactAuthoritySchema = z.enum([
  'teacher_confirmed',
  'student_stated',
  'model_inferred',
]);
export const LessonMemoryEntryStatusSchema = z.enum(['pending', 'ready', 'failed', 'superseded']);
export const LessonMemorySourceKindSchema = z.enum(['lesson_transcript']);
