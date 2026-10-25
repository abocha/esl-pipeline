import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { PublishTarget } from '@esl-pipeline/contracts';
import {
  type AssignmentArtifactReference,
  AssignmentArtifactReferenceSchema,
  type AssignmentV1,
} from '@esl-pipeline/contracts';

import type { HomeworkMemoryPublishTarget } from '../domain/homework-memory-model.js';
import { getLatestReadyHomeworkMemoryByAssignmentLineageKey } from '../domain/homework-memory-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { readAssignmentArtifact } from './assignment-artifact.js';
import { requireTypedAssignment } from './historical-assignment.js';

interface HomeworkSourceJobRow {
  id: string;
  student_id: string | null;
  md: string | null;
  md_storage_uri: string | null;
  assignment_artifact?: unknown;
  published_content_hash: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  lesson_id: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  source_job_id: string | null;
  publish_target: string | null;
  html_url: string | null;
  state: string;
  finished_at: Date | null;
  updated_at: Date;
}

export interface HomeworkMemorySourceBundle {
  jobId: string;
  assignmentLineageKey: string;
  studentId: string;
  promptPackageId?: string | null;
  draftId?: string | null;
  lessonId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  publishedAt: Date;
  format: 'assignment_v1';
  assignment?: AssignmentV1;
  artifact?: AssignmentArtifactReference;
  contentHash: string;
  publishTargets: HomeworkMemoryPublishTarget[];
}

export interface HomeworkMemoryGenerationDecision {
  shouldGenerate: boolean;
  reason: 'missing_ready_entry' | 'published_content_changed' | 'no_material_change';
  source: HomeworkMemorySourceBundle;
}

export async function resolveHomeworkMemorySourceFromSucceededJob(
  jobId: string,
  options?: { client?: PoolClient },
): Promise<HomeworkMemorySourceBundle> {
  const currentJob = await loadSucceededJob(jobId, options?.client);
  if (!currentJob) {
    throw new Error(`Succeeded publish job not found: ${jobId}`);
  }
  if (!currentJob.student_id) {
    throw new Error(`Succeeded publish job ${jobId} is missing student_id`);
  }

  requireTypedAssignment(currentJob.assignment_artifact);
  const assignmentLineageKey = await resolveAssignmentLineageKey(jobId, options?.client);
  const artifact = AssignmentArtifactReferenceSchema.parse(currentJob.assignment_artifact);
  if (!currentJob.prompt_package_id)
    throw new Error('Typed homework source missing prompt identity');
  const assignment = await readAssignmentArtifact(artifact, currentJob.prompt_package_id);
  const contentHash = sha256(`assignment_v1:1:${artifact.contentHash}`);
  const lineageJobs = await listSucceededLineageJobs(assignmentLineageKey, options?.client);

  const sameContentJobs: HomeworkSourceJobRow[] = [currentJob];
  for (const lineageJob of lineageJobs) {
    if (lineageJob.id === currentJob.id) {
      continue;
    }
    if (!lineageJob.assignment_artifact) continue;
    const other = AssignmentArtifactReferenceSchema.parse(lineageJob.assignment_artifact);
    if (artifact.contentHash === other.contentHash) sameContentJobs.push(lineageJob);
  }

  return {
    jobId: currentJob.id,
    assignmentLineageKey,
    studentId: currentJob.student_id,
    promptPackageId: currentJob.prompt_package_id ?? null,
    draftId: currentJob.draft_id ?? null,
    lessonId: currentJob.lesson_id ?? null,
    recordingId: currentJob.recording_id ?? null,
    transcriptId: currentJob.transcript_id ?? null,
    publishedAt: currentJob.finished_at ?? currentJob.updated_at,
    contentHash,
    publishTargets: mergePublishTargets(sameContentJobs),
    format: 'assignment_v1',
    assignment,
    artifact,
  };
}

export async function resolveHomeworkMemoryQueueScope(jobId: string): Promise<string> {
  const currentJob = await loadSucceededJob(jobId);
  if (!currentJob) {
    throw new Error(`Succeeded publish job not found: ${jobId}`);
  }

  return resolveAssignmentLineageKey(jobId);
}

export async function evaluateHomeworkMemoryGenerationForSucceededJob(
  jobId: string,
): Promise<HomeworkMemoryGenerationDecision> {
  const source = await resolveHomeworkMemorySourceFromSucceededJob(jobId);
  const latestReady = await getLatestReadyHomeworkMemoryByAssignmentLineageKey(
    source.assignmentLineageKey,
  );

  if (!latestReady) {
    return { shouldGenerate: true, reason: 'missing_ready_entry', source };
  }

  if ((latestReady.contentHash ?? null) !== source.contentHash) {
    return { shouldGenerate: true, reason: 'published_content_changed', source };
  }

  return { shouldGenerate: false, reason: 'no_material_change', source };
}

async function loadSucceededJob(
  jobId: string,
  providedClient?: PoolClient,
): Promise<HomeworkSourceJobRow | null> {
  const load = async (client: PoolClient) => {
    const result = await client.query<HomeworkSourceJobRow>(
      `
      SELECT
        id,
        student_id,
        md,
        md_storage_uri,
        assignment_artifact,
        published_content_hash,
        prompt_package_id,
        draft_id,
        lesson_id,
        recording_id,
        transcript_id,
        source_job_id,
        publish_target,
        html_url,
        state,
        finished_at,
        updated_at
      FROM jobs
      WHERE id = $1
        AND state = 'succeeded'
      `,
      [jobId],
    );
    return result.rows[0] ?? null;
  };
  return providedClient ? load(providedClient) : withPgClient(load);
}

async function resolveAssignmentLineageKey(
  jobId: string,
  providedClient?: PoolClient,
): Promise<string> {
  const load = async (client: PoolClient) => {
    const result = await client.query<{ id: string }>(
      `
      WITH RECURSIVE upstream AS (
        SELECT id, source_job_id
        FROM jobs
        WHERE id = $1

        UNION ALL

        SELECT j.id, j.source_job_id
        FROM jobs j
        INNER JOIN upstream u ON j.id = u.source_job_id
      )
      SELECT id
      FROM upstream
      WHERE source_job_id IS NULL
      LIMIT 1
      `,
      [jobId],
    );
    return result.rows[0]?.id ?? jobId;
  };
  return providedClient ? load(providedClient) : withPgClient(load);
}

async function listSucceededLineageJobs(
  assignmentLineageKey: string,
  providedClient?: PoolClient,
): Promise<HomeworkSourceJobRow[]> {
  const load = async (client: PoolClient) => {
    const result = await client.query<HomeworkSourceJobRow>(
      `
      WITH RECURSIVE lineage AS (
        SELECT
          id,
          student_id,
          md,
          md_storage_uri,
          assignment_artifact,
          published_content_hash,
          prompt_package_id,
          draft_id,
          lesson_id,
          recording_id,
          transcript_id,
          source_job_id,
          publish_target,
          html_url,
          state,
          finished_at,
          updated_at
        FROM jobs
        WHERE id = $1

        UNION ALL

        SELECT
          j.id,
          j.student_id,
          j.md,
          j.md_storage_uri,
          j.assignment_artifact,
          j.published_content_hash,
          j.prompt_package_id,
          j.draft_id,
          j.lesson_id,
          j.recording_id,
          j.transcript_id,
          j.source_job_id,
          j.publish_target,
          j.html_url,
          j.state,
          j.finished_at,
          j.updated_at
        FROM jobs j
        INNER JOIN lineage l ON j.source_job_id = l.id
      )
      SELECT *
      FROM lineage
      WHERE state = 'succeeded'
      `,
      [assignmentLineageKey],
    );
    return result.rows;
  };
  return providedClient ? load(providedClient) : withPgClient(load);
}

function mergePublishTargets(rows: HomeworkSourceJobRow[]): HomeworkMemoryPublishTarget[] {
  const byTarget = new Map<PublishTarget, HomeworkMemoryPublishTarget>();

  for (const row of rows) {
    const target = normalizePublishTarget(row.publish_target);
    if (!target) {
      continue;
    }

    const candidate: HomeworkMemoryPublishTarget = {
      target,
      url: resolvePublishUrl(row, target),
      jobId: row.id,
      publishedAt: (row.finished_at ?? row.updated_at).toISOString(),
    };

    const existing = byTarget.get(target);
    if (!existing || (existing.publishedAt ?? '') < (candidate.publishedAt ?? '')) {
      byTarget.set(target, candidate);
    }
  }

  return [...byTarget.values()].sort((left, right) => left.target.localeCompare(right.target));
}

function normalizePublishTarget(value: string | null): PublishTarget | null {
  if (value === 'html') {
    return value;
  }
  return null;
}

function resolvePublishUrl(row: HomeworkSourceJobRow, target: PublishTarget): string | null {
  return target === 'html' ? (row.html_url ?? null) : null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
