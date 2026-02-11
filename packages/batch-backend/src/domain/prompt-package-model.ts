import type { VoiceCapabilitiesSnapshot } from '@esl-pipeline/contracts';

export interface PromptPackageRecord {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId?: string | null;
  profilePath?: string | null;
  resolvedProfileId?: string | null;
  resolvedProfileHash?: string | null;
  resolvedProfileRevisionId?: string | null;
  resolvedProfileUpdatedAt?: Date | null;
  resolvedProfileVersionLabel?: string | null;
  resolvedProfileStatus?: 'draft' | 'active' | 'deprecated' | null;
  resolvedTemplateId?: string | null;
  resolvedTemplateHash?: string | null;
  resolvedTemplateRevisionId?: string | null;
  resolvedTemplateUpdatedAt?: Date | null;
  resolvedTemplateVersionLabel?: string | null;
  resolvedTemplateStatus?: 'draft' | 'active' | 'deprecated' | null;
  resolvedVoiceCapabilitiesHash?: string | null;
  resolvedVoiceCapabilitiesGeneratedAt?: Date | null;
  resolvedVoiceCapabilitiesSnapshot?: VoiceCapabilitiesSnapshot | null;
  templateVersion: string;
  notes?: string | null;
  storageUri: string;
  createdAt: Date;
  updatedAt: Date;
}
