import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import type { VoiceCapabilitiesSnapshot } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { PromptPackageRecord } from './prompt-package-model.js';

interface PromptPackageRow {
  id: string;
  recording_id: string;
  transcript_id: string;
  student_id: string | null;
  profile_path: string | null;
  resolved_profile_id: string | null;
  resolved_profile_hash: string | null;
  resolved_profile_revision_id: string | null;
  resolved_profile_updated_at: Date | null;
  resolved_profile_version_label: string | null;
  resolved_profile_status: 'draft' | 'active' | 'deprecated' | null;
  resolved_template_id: string | null;
  resolved_template_hash: string | null;
  resolved_template_revision_id: string | null;
  resolved_template_updated_at: Date | null;
  resolved_template_version_label: string | null;
  resolved_template_status: 'draft' | 'active' | 'deprecated' | null;
  resolved_voice_capabilities_hash: string | null;
  resolved_voice_capabilities_generated_at: Date | null;
  resolved_voice_capabilities_snapshot: VoiceCapabilitiesSnapshot | null;
  template_version: string;
  notes: string | null;
  storage_uri: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertPromptPackageParams {
  id?: string;
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
}

export async function insertPromptPackage(
  params: InsertPromptPackageParams,
): Promise<PromptPackageRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO prompt_packages (
        id,
        recording_id,
        transcript_id,
        student_id,
        profile_path,
        resolved_profile_id,
        resolved_profile_hash,
        resolved_profile_revision_id,
        resolved_profile_updated_at,
        resolved_profile_version_label,
        resolved_profile_status,
        resolved_template_id,
        resolved_template_hash,
        resolved_template_revision_id,
        resolved_template_updated_at,
        resolved_template_version_label,
        resolved_template_status,
        resolved_voice_capabilities_hash,
        resolved_voice_capabilities_generated_at,
        resolved_voice_capabilities_snapshot,
        template_version,
        notes,
        storage_uri,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
      )
      RETURNING
        id,
        recording_id,
        transcript_id,
        student_id,
        profile_path,
        resolved_profile_id,
        resolved_profile_hash,
        resolved_profile_revision_id,
        resolved_profile_updated_at,
        resolved_profile_version_label,
        resolved_profile_status,
        resolved_template_id,
        resolved_template_hash,
        resolved_template_revision_id,
        resolved_template_updated_at,
        resolved_template_version_label,
        resolved_template_status,
        resolved_voice_capabilities_hash,
        resolved_voice_capabilities_generated_at,
        resolved_voice_capabilities_snapshot,
        template_version,
        notes,
        storage_uri,
        created_at,
        updated_at
      `,
      [
        id,
        params.recordingId,
        params.transcriptId,
        params.studentId ?? null,
        params.profilePath ?? null,
        params.resolvedProfileId ?? null,
        params.resolvedProfileHash ?? null,
        params.resolvedProfileRevisionId ?? null,
        params.resolvedProfileUpdatedAt ?? null,
        params.resolvedProfileVersionLabel ?? null,
        params.resolvedProfileStatus ?? null,
        params.resolvedTemplateId ?? null,
        params.resolvedTemplateHash ?? null,
        params.resolvedTemplateRevisionId ?? null,
        params.resolvedTemplateUpdatedAt ?? null,
        params.resolvedTemplateVersionLabel ?? null,
        params.resolvedTemplateStatus ?? null,
        params.resolvedVoiceCapabilitiesHash ?? null,
        params.resolvedVoiceCapabilitiesGeneratedAt ?? null,
        params.resolvedVoiceCapabilitiesSnapshot ?? null,
        params.templateVersion,
        params.notes ?? null,
        params.storageUri,
        now,
        now,
      ],
    );
    return result.rows[0];
  });

  logger.info('Prompt package inserted', { promptPackageId: id });
  return mapRowToPromptPackage(row);
}

export async function getPromptPackageById(id: string): Promise<PromptPackageRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, recording_id, transcript_id, profile_path, template_version,
             student_id, resolved_profile_id, resolved_profile_hash,
             resolved_profile_revision_id, resolved_profile_updated_at,
             resolved_profile_version_label, resolved_profile_status,
             resolved_template_id, resolved_template_hash,
             resolved_template_revision_id, resolved_template_updated_at,
             resolved_template_version_label, resolved_template_status,
             resolved_voice_capabilities_hash, resolved_voice_capabilities_generated_at,
             resolved_voice_capabilities_snapshot,
             notes, storage_uri, created_at, updated_at
      FROM prompt_packages
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToPromptPackage(row) : null;
}

function mapRowToPromptPackage(row: PromptPackageRow): PromptPackageRecord {
  return {
    id: row.id,
    recordingId: row.recording_id,
    transcriptId: row.transcript_id,
    studentId: row.student_id ?? null,
    profilePath: row.profile_path ?? null,
    resolvedProfileId: row.resolved_profile_id ?? null,
    resolvedProfileHash: row.resolved_profile_hash ?? null,
    resolvedProfileRevisionId: row.resolved_profile_revision_id ?? null,
    resolvedProfileUpdatedAt: row.resolved_profile_updated_at ?? null,
    resolvedProfileVersionLabel: row.resolved_profile_version_label ?? null,
    resolvedProfileStatus: row.resolved_profile_status ?? null,
    resolvedTemplateId: row.resolved_template_id ?? null,
    resolvedTemplateHash: row.resolved_template_hash ?? null,
    resolvedTemplateRevisionId: row.resolved_template_revision_id ?? null,
    resolvedTemplateUpdatedAt: row.resolved_template_updated_at ?? null,
    resolvedTemplateVersionLabel: row.resolved_template_version_label ?? null,
    resolvedTemplateStatus: row.resolved_template_status ?? null,
    resolvedVoiceCapabilitiesHash: row.resolved_voice_capabilities_hash ?? null,
    resolvedVoiceCapabilitiesGeneratedAt: row.resolved_voice_capabilities_generated_at ?? null,
    resolvedVoiceCapabilitiesSnapshot: row.resolved_voice_capabilities_snapshot ?? null,
    templateVersion: row.template_version,
    notes: row.notes ?? null,
    storageUri: row.storage_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
