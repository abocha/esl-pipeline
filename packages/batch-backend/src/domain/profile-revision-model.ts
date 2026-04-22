import type { FoundationalProfile } from '../application/foundational-profile.js';

export type ProfileRevisionSource =
  | 'create'
  | 'update'
  | 'restore'
  | 'starter_profile_form'
  | 'candidate_promotion'
  | 'legacy_normalization'
  | 'lesson_population';
export type RevisionStatus = 'draft' | 'active' | 'deprecated';

export interface ProfileRevisionRecord {
  id: string;
  profileId: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  contentHash: string;
  source: ProfileRevisionSource;
  status: RevisionStatus;
  versionNumber: number;
  versionLabel: string;
  activatedAt: Date | null;
  deprecatedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface ProfileRevisionListResult {
  items: ProfileRevisionRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}
