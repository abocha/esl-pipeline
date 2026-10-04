import type { JobConfigOverrides } from '@esl-pipeline/contracts';

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
import { requireTypedAssignment } from './historical-assignment.js';

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
  let resolvedJobId = params.jobId?.trim() || '';

  const draft = await drafts.getById(params.draftId);
  if (!draft) return null;
  requireTypedAssignment(draftArtifact(draft));
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
  requireTypedAssignment(reference);
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

  await readValidatedAssignment(reference, assignmentContext(promptPackage), storage);
  if (params.expectedContentHash && reference.contentHash !== params.expectedContentHash) {
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
  const mdStorageUri = sourceStorageUri;
  const mdPath = null;

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
