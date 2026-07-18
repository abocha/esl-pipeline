import { z } from 'zod';

import type {
  AssignmentConfirmedSnapshot,
  AssignmentConfirmedStep,
  GenerationProvider,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

const nullableHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable();

export const AssignmentConfirmedSnapshotSchema = z
  .object({
    student: z.object({ studentId: z.string().uuid() }).strict(),
    source: z
      .object({
        lessonId: z.string().uuid().nullable(),
        recordingId: z.string().uuid(),
        transcriptId: z.string().uuid(),
        transcriptWorkingVersion: z.number().int().positive(),
        transcriptStorageUri: z.string().min(1),
        transcriptHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .nullable(),
    context: z
      .object({
        teacherNotes: z.string().nullable(),
        profileId: z.string().nullable(),
        profileRevisionId: z.string().uuid().nullable(),
        profileRevisionHash: nullableHash,
      })
      .strict()
      .nullable(),
    create: z
      .object({
        promptPackageId: z.string().uuid(),
        draftId: z.string().uuid(),
        draftWorkingVersion: z.number().int().positive(),
        draftStorageUri: z.string().min(1),
        draftHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .nullable(),
  })
  .strict();

export interface AssignmentSessionRecord {
  id: string;
  userId: string;
  studentId: string;
  lessonId: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  revision: number;
  confirmedStep: AssignmentConfirmedStep;
  confirmed: AssignmentConfirmedSnapshot;
  creationRequestId: string | null;
  publishTarget: PublishTarget | null;
  selectedTtsProvider: TtsProviderId | null;
  selectedTtsStrategy: TtsStrategy | null;
  selectedTtsModel: string | null;
  selectedPreset: string | null;
  selectedGenerationProvider: GenerationProvider | null;
  selectedGenerationModel: string | null;
  teacherNotes: string | null;
  selectedProfileId: string | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  shareJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
