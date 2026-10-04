import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { JobConfigOverrides } from '@esl-pipeline/contracts';
import { serializeAssignmentV1 } from '@esl-pipeline/contracts';
import { readBool } from '@esl-pipeline/shared-infrastructure';

import { getDraftById } from '../domain/draft-repository.js';
import {
  getJobById,
  updateAssignmentShareJobDraftLink,
  updateJobDraftLink,
} from '../domain/job-repository.js';
import {
  getPromptPackageById,
  isPromptPackageSourceCanonical,
} from '../domain/prompt-package-repository.js';
import { createStorageConfigService } from '../infrastructure/storage-config.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { approveJobForPipeline } from './approve-job.js';
import {
  AssignmentArtifactValidationError,
  assignmentContext,
  draftArtifact,
  readValidatedAssignment,
} from './assignment-artifact.js';
import { createApprovalJobFromDraft } from './create-approval-job.js';
import { PromptPackageAssignmentError } from './create-prompt-package.js';

export interface MaterializeDraftParams {
  draftId: string;
  jobId?: string;
  jobOverrides?: JobConfigOverrides;
  sourceStorageUri?: string;
  expectedContentHash?: string;
  assignmentShare?: { sessionId: string; userId: string };
}

export interface MaterializeDraftResponse {
  draftId: string;
  jobId: string;
  mdPath: string | null;
  mdStorageUri: string;
}

export interface MaterializeDraftDependencies {
  storage: TranscriptionStorage;
  drafts: {
    getById: typeof getDraftById;
  };
  promptPackages: {
    getById: typeof getPromptPackageById;
    isSourceCanonical: typeof isPromptPackageSourceCanonical;
  };
  createApprovalJob: typeof createApprovalJobFromDraft;
  jobs: {
    getById?: typeof getJobById;
    updateDraftLink: typeof updateJobDraftLink;
    updateAssignmentShareDraftLink?: typeof updateAssignmentShareJobDraftLink;
  };
  approvals: {
    approveForPipeline: typeof approveJobForPipeline;
  };
  uploadDir: string;
  localExport: boolean;
}

export async function materializeDraft(
  params: MaterializeDraftParams,
  overrides?: Partial<MaterializeDraftDependencies>,
): Promise<MaterializeDraftResponse | null> {
  if (!params.draftId) return null;

  const drafts = overrides?.drafts ?? {
    getById: getDraftById,
  };
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
    isSourceCanonical: isPromptPackageSourceCanonical,
  };
  const createApprovalJob = overrides?.createApprovalJob ?? createApprovalJobFromDraft;
  const jobs = overrides?.jobs ?? {
    getById: getJobById,
    updateDraftLink: updateJobDraftLink,
    updateAssignmentShareDraftLink: updateAssignmentShareJobDraftLink,
  };
  const approvals = overrides?.approvals ?? {
    approveForPipeline: approveJobForPipeline,
  };
  const uploadDir =
    overrides?.uploadDir ?? createStorageConfigService().getFilesystemConfig().uploadDir;
  const localExport =
    overrides?.localExport ??
    readBool('DRAFT_LOCAL_EXPORT', process.env.NODE_ENV === 'development');

  let resolvedJobId = params.jobId?.trim() || '';

  const draft = await drafts.getById(params.draftId);
  if (!draft) return null;
  const promptPackage = await promptPackages.getById(draft.promptPackageId);
  if (!promptPackage) return null;
  if (!(await promptPackages.isSourceCanonical(promptPackage.id))) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      'Assignment source is no longer canonical',
    );
  }

  let frozenJob;
  if (resolvedJobId && jobs.getById) {
    const targetJob = await jobs.getById(resolvedJobId);
    frozenJob = targetJob;
    if (!targetJob || targetJob.state !== 'awaiting_approval') {
      return null;
    }
  }

  const typedDraft = draftArtifact(draft);
  if (resolvedJobId && Boolean(frozenJob?.assignmentArtifact) !== Boolean(typedDraft)) {
    throw new AssignmentArtifactValidationError('Assignment job authority format mismatch');
  }
  const reference = frozenJob?.assignmentArtifact ?? typedDraft;
  if (
    frozenJob?.assignmentArtifact &&
    (frozenJob.draftId !== draft.id || frozenJob.promptPackageId !== promptPackage.id)
  ) {
    throw new Error('Frozen assignment lineage mismatch');
  }
  const sourceStorageUri = params.sourceStorageUri ?? reference?.storageUri ?? draft.storageUri;
  if (reference && sourceStorageUri !== reference.storageUri)
    throw new Error('Frozen assignment URI mismatch');
  const storage = overrides?.storage ?? createTranscriptionStorageForUri(sourceStorageUri);

  const assignment = reference
    ? await readValidatedAssignment(reference, assignmentContext(promptPackage), storage)
    : undefined;
  const text = assignment
    ? serializeAssignmentV1(assignment)
    : await storage.getText(sourceStorageUri);
  if (
    params.expectedContentHash &&
    (reference
      ? reference.contentHash
      : createHash('sha256').update(text, 'utf8').digest('hex')) !== params.expectedContentHash
  ) {
    throw new Error('Confirmed draft content hash mismatch');
  }
  if (!resolvedJobId) {
    const approvalJob = await createApprovalJob({
      draft,
      promptPackage,
      jobOverrides: params.jobOverrides,
    });
    resolvedJobId = approvalJob.id;
  }
  const context = {
    studentId: promptPackage.studentId ?? null,
    promptPackageId: promptPackage.id,
    profileRevisionId: promptPackage.resolvedProfileRevisionId ?? null,
    templateRevisionId: promptPackage.resolvedTemplateRevisionId ?? null,
  };
  const materializedText = assignment ? text : injectMaterializationContext(text, context);
  const mdStorageUri = sourceStorageUri;
  let mdPath: string | null = null;
  if (localExport && !assignment) {
    mdPath = resolveDraftMaterializePath(uploadDir, draft.id);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, materializedText, 'utf8');
  }

  const updated = params.assignmentShare
    ? await (jobs.updateAssignmentShareDraftLink ?? updateAssignmentShareJobDraftLink)({
        id: resolvedJobId,
        sessionId: params.assignmentShare.sessionId,
        userId: params.assignmentShare.userId,
        expectedState: 'awaiting_approval',
        md: mdPath,
        mdStorageUri,
        draftId: draft.id,
      })
    : await jobs.updateDraftLink({
        id: resolvedJobId,
        expectedState: 'awaiting_approval',
        md: mdPath,
        mdStorageUri,
        draftId: draft.id,
      });

  if (!updated) return null;

  if (params.jobOverrides?.autoPublish) {
    const approved = await approvals.approveForPipeline(resolvedJobId, {
      md: mdPath ?? undefined,
      mdStorageUri,
    });
    if (!approved) return null;
  }

  return {
    draftId: draft.id,
    jobId: resolvedJobId,
    mdPath,
    mdStorageUri,
  };
}

function injectMaterializationContext(
  markdown: string,
  context: {
    studentId: string | null;
    promptPackageId: string;
    profileRevisionId: string | null;
    templateRevisionId: string | null;
  },
): string {
  const keys = [
    ['x_esl_student_id', context.studentId],
    ['x_esl_prompt_package_id', context.promptPackageId],
    ['x_esl_profile_revision_id', context.profileRevisionId],
    ['x_esl_template_revision_id', context.templateRevisionId],
  ] as const;

  const lines = keys
    .filter(([, value]) => value && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value}`);
  if (lines.length === 0) {
    return markdown;
  }

  if (markdown.startsWith('---\n') || markdown.startsWith('---\r\n')) {
    const closingIndex = markdown.indexOf('\n---', 4);
    if (closingIndex !== -1) {
      const head = markdown.slice(0, closingIndex);
      const tail = markdown.slice(closingIndex);
      return `${head}\n${lines.join('\n')}${tail}`;
    }
  }

  return `---\n${lines.join('\n')}\n---\n\n${markdown}`;
}

function resolveDraftMaterializePath(uploadDir: string, draftId: string): string {
  const baseDir = path.resolve(uploadDir);
  const safeId = path.basename(draftId);
  const filename = `${safeId}.md`;
  const target = path.resolve(baseDir, 'drafts', filename);

  if (!isWithinBaseDir(baseDir, target)) {
    throw new Error('Draft materialization path resolves outside upload dir');
  }

  return target;
}

function isWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
