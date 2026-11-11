/** Active-profile authority is separate from the revision selected in an editor. */
export interface ProfileWritePrecondition {
  expectedActiveRevisionId: string | null;
}

export interface ProfileRevisionBaseDto {
  baseActiveRevisionId: string | null;
  baseActiveRevisionKnown: boolean;
}

export type StudentProfileRevisionSource =
  | 'create'
  | 'update'
  | 'restore'
  | 'starter_profile_form'
  | 'candidate_promotion'
  | 'legacy_normalization'
  | 'lesson_population'
  | 'profile_revision_refresh'
  | 'automatic_maintenance'
  | 'maintenance_undo';

export type ProfileMaintenanceField =
  | 'communicationContexts'
  | 'interestsAndUsefulThemes'
  | 'studyPreferences'
  | 'stableStrengths';

export interface ProfileMaintenanceEvidenceDto {
  lessonMemoryId: string;
  lessonId: string | null;
  lessonStartedAt: string | null;
  facts: Array<{
    fact: string;
    evidence: Array<{
      quote: string;
      speakerRole: 'student' | 'teacher' | null;
      sourceId: string | null;
    }>;
  }>;
}

export interface ProfileMaintenanceChangeDto {
  id: string;
  field: ProfileMaintenanceField;
  addedValue: string;
  beforeValue: string[];
  afterValue: string[];
  appliedAt: string;
  sourceRevisionId: string;
  resultRevisionId: string;
  sourceSnapshotId: string | null;
  sourceLessonMemoryIds: string[];
  sourceLessonIds: string[];
  evidence: ProfileMaintenanceEvidenceDto[];
  status: 'applied' | 'undone' | 'blocked';
  canUndo: boolean;
  blockedReason: string | null;
  undoneAt: string | null;
  reconsiderationAvailable: boolean;
}

export interface ProfileChangeListDto {
  studentId: string;
  activeRevisionId: string | null;
  items: ProfileMaintenanceChangeDto[];
  nextCursor: string | null;
}

export interface MaintainedProfileContentDto {
  studentId: string;
  content: string;
  structuredContent?: {
    schemaVersion: 'foundational_profile_v1';
    overallLevel: string | null;
    primaryGoals: string[];
    communicationContexts: string[];
    interestsAndUsefulThemes: string[];
    stableStrengths: string[];
    persistentChallenges: string[];
    studyPreferences: string[];
    durableConstraints: string[];
    teacherNotes: string | null;
  } | null;
  currentRevisionId: string | null;
  activeRevisionId: string | null;
  updatedAt: string | null;
}

export interface UndoProfileChangeDto {
  profile: MaintainedProfileContentDto;
  change: ProfileMaintenanceChangeDto;
}

export interface ProfileRevisionConflictDto {
  error: string;
  code:
    | 'profile_revision_precondition_required'
    | 'profile_revision_conflict'
    | 'profile_change_conflict';
  message: string;
  activeRevisionId: string | null;
}
