import type {
  AssignmentConfirmedSnapshot,
  AssignmentLearnerContextDto,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

export async function getAssignmentLearnerContext(
  userId: string,
  assignmentSessionId: string,
): Promise<AssignmentLearnerContextDto | null> {
  return withPgClient(async (client) => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const session = await client.query<{
        student_id: string;
        confirmed_step: string;
        confirmed_snapshot: AssignmentConfirmedSnapshot;
      }>(
        `SELECT student_id, confirmed_step, confirmed_snapshot FROM assignment_sessions
         WHERE id = $1 AND user_id = $2`,
        [assignmentSessionId, userId],
      );
      const row = session.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const source = row.confirmed_snapshot.source;
      const pinned = row.confirmed_snapshot.context;
      const frozen = row.confirmed_step === 'share';
      const sourceIsCurrent =
        source && !frozen
          ? await client.query(
              `SELECT 1 FROM assignment_source_bindings b
         JOIN recordings r ON r.id = b.recording_id
         JOIN transcripts t ON t.id = b.transcript_id
         WHERE b.assignment_session_id = $1 AND b.binding_role = 'confirmed'
           AND b.recording_id = $2 AND b.transcript_id = $3
           AND b.source_identity_kind = $4 AND b.source_fingerprint_scheme = $5
           AND b.source_fingerprint = $6
           AND r.source_identity_kind = $4 AND r.source_fingerprint_scheme = $5
           AND r.source_fingerprint = $6
           AND t.content_hash = $7 AND t.storage_uri = $8
           AND t.working_version = $9`,
              [
                assignmentSessionId,
                source.recordingId,
                source.transcriptId,
                source.sourceIdentityKind,
                source.sourceFingerprintScheme,
                source.sourceFingerprint,
                source.transcriptHash,
                source.transcriptStorageUri,
                source.transcriptWorkingVersion,
              ],
            )
          : null;
      const canonicalSource = Boolean(source && (frozen || sourceIsCurrent?.rows[0]));
      const binding = await client.query<{
        profile_id: string;
        provenance: string;
        active_revision_id: string | null;
      }>(
        `SELECT p.id AS profile_id, p.provenance, p.active_revision_id
         FROM student_profile_bindings b JOIN profiles p ON p.id = b.profile_id
         WHERE b.student_id = $1 AND b.effective_to IS NULL
         ORDER BY b.effective_from DESC LIMIT 1`,
        [row.student_id],
      );
      const profileRow = binding.rows[0];
      const usableId = frozen ? pinned?.profileRevisionId : profileRow?.active_revision_id;
      const usableProfileId = frozen ? pinned?.profileId : profileRow?.profile_id;
      const revision =
        usableId && usableProfileId
          ? await client.query<{
              id: string;
              content_hash: string;
              content: string;
              structured_content: unknown;
              created_at: Date;
            }>(
              `SELECT id, content_hash, content, structured_content, created_at
         FROM profile_revisions WHERE id = $1 AND profile_id = $2`,
              [usableId, usableProfileId],
            )
          : null;
      const active = revision?.rows[0];
      const operation =
        source && profileRow
          ? await client.query<{
              state: AssignmentLearnerContextDto['operationState'];
            }>(
              `SELECT state FROM profile_initial_enrichment_operations
         WHERE profile_id = $1 AND assignment_session_id = $2
           AND transcript_id = $3 AND transcript_hash = $4
         ORDER BY created_at DESC LIMIT 1`,
              [
                profileRow.profile_id,
                assignmentSessionId,
                source.transcriptId,
                source.transcriptHash,
              ],
            )
          : null;
      const operationState = operation?.rows[0]?.state ?? null;
      const priorSubmission =
        !operationState && profileRow?.provenance === 'tutor_only'
          ? await client.query<{ state: 'submitting' | 'uncertain' }>(
              `SELECT state FROM profile_initial_enrichment_operations
               WHERE profile_id = $1 AND state IN ('submitting', 'uncertain')
               ORDER BY created_at DESC LIMIT 1`,
              [profileRow.profile_id],
            )
          : null;
      const priorSubmissionState = priorSubmission?.rows[0]?.state ?? null;
      const eligibility: AssignmentLearnerContextDto['eligibility'] = !canonicalSource
        ? 'no_confirmed_source'
        : profileRow?.provenance === 'evidence_enriched'
          ? 'already_enriched'
          : profileRow?.provenance === 'tutor_only'
            ? 'eligible'
            : 'unknown_provenance';
      const state: AssignmentLearnerContextDto['state'] =
        operationState === 'succeeded'
          ? 'completed'
          : operationState === 'failed' ||
              operationState === 'uncertain' ||
              priorSubmissionState === 'uncertain'
            ? 'failed'
            : canonicalSource &&
                ((profileRow?.provenance === 'tutor_only' && !operationState) ||
                  ['waiting_evidence', 'queued', 'submitting', 'result_ready'].includes(
                    operationState ?? '',
                  ))
              ? 'preparing'
              : 'not_applicable';
      const result: AssignmentLearnerContextDto = {
        assignmentSessionId,
        studentId: row.student_id,
        source: source
          ? {
              recordingId: source.recordingId,
              transcriptId: source.transcriptId,
              transcriptHash: source.transcriptHash,
            }
          : null,
        eligibility,
        state,
        operationState,
        profile:
          active && usableProfileId
            ? {
                profileId: usableProfileId,
                revisionId: active.id,
                revisionHash: active.content_hash,
                content: active.content,
                structuredContent: active.structured_content,
                updatedAt: active.created_at.toISOString(),
              }
            : null,
        pinned: pinned
          ? {
              profileId: pinned.profileId,
              revisionId: pinned.profileRevisionId,
              revisionHash: pinned.profileRevisionHash,
            }
          : null,
        confirmationAvailable: canonicalSource && state !== 'preparing',
        warning:
          operationState === 'uncertain' || priorSubmissionState === 'uncertain'
            ? 'enrichment_uncertain'
            : operationState === 'failed'
              ? 'enrichment_failed'
              : null,
      };
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
