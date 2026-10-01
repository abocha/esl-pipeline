import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { AssignmentSessionRecord } from './assignment-session-model.js';

/** Called under the confirmed assignment row lock, in the source transaction. */
export async function reconcileInitialEnrichmentIntent(
  client: PoolClient,
  session: AssignmentSessionRecord,
): Promise<void> {
  const source = session.confirmed.source;
  if (!source || session.confirmed.context) return;

  const canonical = await client.query(
    `SELECT 1 FROM assignment_source_bindings b
     JOIN recordings r ON r.id = b.recording_id
     JOIN transcripts t ON t.id = b.transcript_id
     WHERE b.assignment_session_id = $1 AND b.binding_role = 'confirmed'
       AND b.user_id = $2 AND b.student_id = $3
       AND b.recording_id = $4 AND b.transcript_id = $5
       AND b.source_identity_kind = $6 AND b.source_fingerprint_scheme = $7
       AND b.source_fingerprint = $8
       AND r.source_identity_kind = $6 AND r.source_fingerprint_scheme = $7
       AND r.source_fingerprint = $8
       AND t.recording_id = $4 AND t.working_version = $9
       AND t.storage_uri = $10 AND t.content_hash = $11`,
    [
      session.id,
      session.userId,
      session.studentId,
      source.recordingId,
      source.transcriptId,
      source.sourceIdentityKind,
      source.sourceFingerprintScheme,
      source.sourceFingerprint,
      source.transcriptWorkingVersion,
      source.transcriptStorageUri,
      source.transcriptHash,
    ],
  );
  if (!canonical.rows[0]) return;

  const student = await client.query<{ profile_provenance: string }>(
    'SELECT profile_provenance FROM students WHERE id = $1 FOR UPDATE',
    [session.studentId],
  );
  if (student.rows[0]?.profile_provenance !== 'tutor_only') return;
  const profile = await client.query<{ active_revision_id: string; content_hash: string }>(
    `SELECT id AS active_revision_id, content_hash FROM student_profile_revisions
     WHERE student_id = $1 AND status = 'active'`,
    [session.studentId],
  );
  const exact = await client.query(
    `SELECT id FROM profile_initial_enrichment_operations
     WHERE student_id = $1 AND assignment_session_id = $2
       AND transcript_id = $3 AND transcript_hash = $4`,
    [session.studentId, session.id, source.transcriptId, source.transcriptHash],
  );
  if (exact.rows[0]) return;

  const live = await client.query<{
    id: string;
    assignment_session_id: string;
    transcript_id: string;
    transcript_hash: string;
    state: string;
  }>(
    `SELECT id, assignment_session_id, transcript_id, transcript_hash, state
     FROM profile_initial_enrichment_operations
     WHERE student_id = $1 AND state IN
       ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain')
     FOR UPDATE`,
    [session.studentId],
  );
  const same =
    live.rows[0]?.assignment_session_id === session.id &&
    live.rows[0]?.transcript_id === source.transcriptId &&
    live.rows[0]?.transcript_hash === source.transcriptHash;
  if (same) return;
  if (live.rows[0]) {
    if (live.rows[0].state === 'submitting' || live.rows[0].state === 'uncertain') return;
    await client.query(
      `UPDATE profile_initial_enrichment_operations
       SET state = 'superseded', updated_at = NOW(), failure_code = 'source_replaced'
       WHERE id = $1`,
      [live.rows[0].id],
    );
  }
  await client.query(
    `INSERT INTO profile_initial_enrichment_operations
      (id, student_id, assignment_session_id, recording_id,
       transcript_id, transcript_storage_uri, transcript_hash, source_identity_kind,
       source_fingerprint_scheme, source_fingerprint, seed_revision_id, seed_revision_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      session.studentId,
      session.id,
      source.recordingId,
      source.transcriptId,
      source.transcriptStorageUri,
      source.transcriptHash,
      source.sourceIdentityKind,
      source.sourceFingerprintScheme,
      source.sourceFingerprint,
      profile.rows[0]?.active_revision_id ?? null,
      profile.rows[0]?.content_hash ?? null,
    ],
  );
}
