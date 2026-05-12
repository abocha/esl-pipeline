import fs from 'node:fs/promises';
import path from 'node:path';

import type { JobConfigOverrides } from '@esl-pipeline/contracts';
import { readBool } from '@esl-pipeline/shared-infrastructure';

import { getDraftById } from '../domain/draft-repository.js';
import { getJobById, updateJobDraftLink } from '../domain/job-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import { createStorageConfigService } from '../infrastructure/storage-config.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { approveJobForPipeline } from './approve-job.js';
import { createApprovalJobFromDraft } from './create-approval-job.js';

export interface MaterializeDraftParams {
  draftId: string;
  jobId?: string;
  jobOverrides?: JobConfigOverrides;
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
  };
  createApprovalJob: typeof createApprovalJobFromDraft;
  jobs: {
    getById?: typeof getJobById;
    updateDraftLink: typeof updateJobDraftLink;
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
  };
  const createApprovalJob = overrides?.createApprovalJob ?? createApprovalJobFromDraft;
  const jobs = overrides?.jobs ?? {
    getById: getJobById,
    updateDraftLink: updateJobDraftLink,
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

  if (resolvedJobId && jobs.getById) {
    const targetJob = await jobs.getById(resolvedJobId);
    if (!targetJob || targetJob.state !== 'awaiting_approval') {
      resolvedJobId = '';
    }
  }

  const storage = overrides?.storage ?? createTranscriptionStorageForUri(draft.storageUri);

  if (!resolvedJobId) {
    const approvalJob = await createApprovalJob({
      draft,
      promptPackage,
      jobOverrides: params.jobOverrides,
    });
    resolvedJobId = approvalJob.id;
  }

  const text = await storage.getText(draft.storageUri);
  const context = {
    studentId: promptPackage.studentId ?? null,
    promptPackageId: promptPackage.id,
    profileRevisionId: promptPackage.resolvedProfileRevisionId ?? null,
    templateRevisionId: promptPackage.resolvedTemplateRevisionId ?? null,
  };
  const materializedText = injectMaterializationContext(text, context);
  let mdPath: string | null = null;
  if (localExport) {
    mdPath = resolveDraftMaterializePath(uploadDir, draft.id);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, materializedText, 'utf8');
  }

  let updated = await jobs.updateDraftLink({
    id: resolvedJobId,
    expectedState: 'awaiting_approval',
    md: mdPath,
    mdStorageUri: draft.storageUri,
    draftId: draft.id,
  });

  if (!updated && params.jobId) {
    const approvalJob = await createApprovalJob({
      draft,
      promptPackage,
      jobOverrides: params.jobOverrides,
    });
    resolvedJobId = approvalJob.id;
    updated = await jobs.updateDraftLink({
      id: resolvedJobId,
      expectedState: 'awaiting_approval',
      md: mdPath,
      mdStorageUri: draft.storageUri,
      draftId: draft.id,
    });
  }

  if (!updated) return null;

  if (params.jobOverrides?.autoPublish) {
    const approved = await approvals.approveForPipeline(resolvedJobId, {
      md: mdPath ?? undefined,
      mdStorageUri: draft.storageUri,
    });
    if (!approved) return null;
  }

  return {
    draftId: draft.id,
    jobId: resolvedJobId,
    mdPath,
    mdStorageUri: draft.storageUri,
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
