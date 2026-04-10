import React from 'react';

import type {
  GenerateDraftResponse,
  JobStatus,
  MarkdownValidationResponse,
  ProfileRevisionSummaryResponse,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  StudentOption,
  SttProvider,
} from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';
import type { MinimalPublishTarget } from './MinimalAssignment.logic';

export type WorkflowStageId =
  | 'start'
  | 'source'
  | 'context'
  | 'assignment'
  | 'review'
  | 'advanced';
export type WorkflowStageStatus = 'current' | 'complete' | 'available' | 'locked';

export interface WorkflowStage {
  id: WorkflowStageId;
  title: string;
  description: string;
  status: WorkflowStageStatus;
}

export interface WorkflowSummaryItem {
  label: string;
  value: string;
  note?: string;
}

interface WorkflowOverviewProps {
  currentStageTitle: string;
  stages: WorkflowStage[];
  summaryItems: WorkflowSummaryItem[];
}

interface StageSectionProps {
  stage: WorkflowStage;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

interface StartStageSectionProps {
  stage: WorkflowStage;
  onStartNewAssignment: () => void;
  onRefreshRecentWork: () => void;
  onResumeSelectedAssignment: () => void;
  resumeLoading: boolean;
  selectedResumeJobId: string;
  onSelectedResumeJobIdChange: (value: string) => void;
  resumeJobs: JobStatus[];
  resumeError: string | null;
  selectedResumeJob: JobStatus | null;
  formatResumeJobLabel: (job: JobStatus) => string;
  describeResumeJobStudent: (job: JobStatus) => string;
  currentJobStatus: JobStatus | null;
  publishUrl: string | null | undefined;
  publishLabel: string;
  publishPending: string;
  pinnedJobExpanded: boolean;
  onTogglePinnedJobExpanded: () => void;
  onRegeneratePronunciationAudio: () => void;
  onRepublishCurrentDraft: () => void;
  onCancelJob: () => void;
  rerunEnabled: boolean;
  cancelEnabled: boolean;
  actionBusy: 'rerun' | 'cancel' | null;
}

interface SourceStageSectionProps {
  stage: WorkflowStage;
  onRefreshStudents: () => void;
  studentOptions: StudentOption[];
  studentOptionsError: string | null;
  selectedStudentId: string;
  onSelectedStudentIdChange: (value: string) => void;
  selectedStudent: StudentOption | null;
  selectedSttProvider: SttProvider;
  onSelectedSttProviderChange: (provider: SttProvider) => void;
  sttProviders: readonly SttProvider[];
  formatSttProviderLabel: (provider: SttProvider) => string;
  audioExtensions: readonly string[];
  uploading: boolean;
  selectedFileName: string | null;
  uploadProgress: number;
  onFiles: (files: File[]) => void;
  onCancelUpload: () => void;
  uploadError: string | null;
  uploadCacheNotice: string | null;
  recording: RecordingListItem | null;
  recordingStatus: RecordingStatus | null;
  recordingError: string | null;
  transcriptStatus: 'idle' | 'loading' | 'processing' | 'ready' | 'failed';
  transcriptError: string | null;
  transcriptReady: boolean;
  onRefreshTranscript: () => void;
  retryingTranscript: boolean;
  onRetryTranscript: () => void;
  transcriptText: string;
  onTranscriptTextChange: (value: string) => void;
  transcriptDirty: boolean;
  transcriptSaving: boolean;
  onSaveTranscript: () => void;
}

interface ContextStageSectionProps {
  stage: WorkflowStage;
  onRefreshProfiles: () => void;
  onSaveProfile: () => void;
  profileBusy: 'loading' | 'saving' | 'creating' | 'restoring' | null;
  selectedProfileId: string;
  onSelectedProfileIdChange: (value: string) => void;
  profileOptions: { id: string; label: string }[];
  newProfileId: string;
  onNewProfileIdChange: (value: string) => void;
  onCreateProfile: () => void;
  profileEditorText: string;
  onProfileEditorTextChange: (value: string) => void;
  profileDirty: boolean;
  profileOptionsError: string | null;
  profileRevisionError: string | null;
  profileSuccess: string | null;
  profileRevisions: ProfileRevisionSummaryResponse[];
  onRestoreRevision: (revisionId: string) => void;
  teacherNotes: string;
  onTeacherNotesChange: (value: string) => void;
}

interface AssignmentStageSectionProps {
  stage: WorkflowStage;
  transcriptReady: boolean;
  promptLoading: boolean;
  promptReady: boolean;
  promptOptionsReady: boolean;
  onGeneratePrompt: () => void;
  onCopyPrompt: () => void;
  promptCopyState: 'idle' | 'copied' | 'error';
  onReloadPromptOptions: () => void;
  promptError: string | null;
  promptPackage: PromptPackageResponse | null;
  promptText: string;
  onPromptTextChange: (value: string) => void;
  onSaveDraft: () => void;
  validating: boolean;
  draftDirty: boolean;
  generationOptionsAvailable: boolean;
  selectedGenerationProvider: string;
  onSelectedGenerationProviderChange: (value: string) => void;
  generationProviders: readonly string[];
  selectedGenerationModel: string;
  onSelectedGenerationModelChange: (value: string) => void;
  generationModelsForProvider: { provider: string; id: string }[];
  onGenerateDraft: () => void;
  generatingDraft: boolean;
  generationBlockedByQuota: boolean;
  activeGenerationQuota: GenerateDraftResponse['quota'] | null;
  generationQuotaSourceLabel: string | null;
  generationQuotaUpdatedRelative: string | null;
  generationQuotaUpdatedAbsolute: string | null;
  generationQuotaHasNumericValues: boolean;
  generationQuotaBlockedReason: string | null;
  generationError: string | null;
  generationSuccess: string | null;
  draftText: string;
  onDraftTextChange: (value: string) => void;
  validation: MarkdownValidationResponse | null;
  validationError: string | null;
  draftError: string | null;
}

interface ReviewStageSectionProps {
  stage: WorkflowStage;
  onPublish: () => void;
  canPublishWithPreview: boolean;
  publishing: boolean;
  previewing: boolean;
  onPreviewDraft: () => void;
  draftHasContent: boolean;
  previewReadyForCurrentDraft: boolean;
  publishTarget: MinimalPublishTarget;
  onPublishTargetChange: (value: MinimalPublishTarget) => void;
  selectedPreset: string;
  onSelectedPresetChange: (value: string) => void;
  presetOptions: { id: string; label: string }[];
  jobOptionsLoaded: boolean;
  selectedTtsProvider: 'elevenlabs' | 'google';
  onSelectedTtsProviderChange: (value: 'elevenlabs' | 'google') => void;
  ttsProviders: readonly ('elevenlabs' | 'google')[];
  selectedTtsStrategy: 'auto' | 'dialogue' | 'tts';
  onSelectedTtsStrategyChange: (value: 'auto' | 'dialogue' | 'tts') => void;
  availablePublishTtsStrategies: readonly ('auto' | 'dialogue' | 'tts')[];
  formatPublishTtsStrategyLabel: (strategy: 'auto' | 'dialogue' | 'tts') => string;
  selectedTtsModel: string;
  onSelectedTtsModelChange: (value: string) => void;
  publishModelSelectionDisabled: boolean;
  selectedTtsModelOptions: readonly string[];
  previewError: string | null;
  previewHtml: string | null;
  publishError: string | null;
  currentJobStatus: JobStatus | null;
  jobFailureReason: string | null;
  jobReady: boolean;
  publishUrl: string | null | undefined;
  publishLabel: string;
  publishPending: string;
}

function formatWorkflowStageStatusLabel(status: WorkflowStageStatus): string {
  if (status === 'complete') return 'Done';
  if (status === 'current') return 'Now';
  if (status === 'available') return 'Available';
  return 'Locked';
}

export function WorkflowOverview({
  currentStageTitle,
  stages,
  summaryItems,
}: WorkflowOverviewProps) {
  return (
    <section className="minimal-overview" aria-labelledby="assignment-builder-title">
      <div className="minimal-overview-header">
        <div className="minimal-overview-copy">
          <span className="minimal-eyebrow">Assignment Builder</span>
          <h1 id="assignment-builder-title">Build and share a lesson assignment</h1>
          <p>
            Move from recording to published lesson in guided stages, with the technical controls
            tucked away until you actually need them.
          </p>
        </div>
        <div className="minimal-stage-state is-current">Current focus: {currentStageTitle}</div>
      </div>

      <div className="minimal-summary-grid">
        {summaryItems.map((item) => (
          <div key={item.label} className="minimal-summary-card">
            <span className="minimal-summary-label">{item.label}</span>
            <span className="minimal-summary-value">{item.value}</span>
            {item.note ? <span className="minimal-summary-note">{item.note}</span> : null}
          </div>
        ))}
      </div>

      <ol className="minimal-stage-list" aria-label="Assignment progress">
        {stages.map((stage, index) => (
          <li key={stage.id} className={`minimal-stage-item is-${stage.status}`}>
            <span className="minimal-stage-step" aria-hidden="true">
              {index + 1}
            </span>
            <div className={`minimal-stage-state is-${stage.status}`}>
              {formatWorkflowStageStatusLabel(stage.status)}
            </div>
            <span className="minimal-stage-name">{stage.title}</span>
            <span className="minimal-stage-description">{stage.description}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StageSection({ stage, actions, children }: StageSectionProps) {
  return (
    <section className={`minimal-section minimal-stage-card is-${stage.status}`}>
      <div className="minimal-stage-header">
        <div className="minimal-stage-header-copy">
          <h2>{stage.title}</h2>
          <p>{stage.description}</p>
        </div>
        <div className="minimal-stage-header-actions">
          <span className={`minimal-stage-state is-${stage.status}`}>
            {formatWorkflowStageStatusLabel(stage.status)}
          </span>
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

export function StartStageSection({
  stage,
  onStartNewAssignment,
  onRefreshRecentWork,
  onResumeSelectedAssignment,
  resumeLoading,
  selectedResumeJobId,
  onSelectedResumeJobIdChange,
  resumeJobs,
  resumeError,
  selectedResumeJob,
  formatResumeJobLabel,
  describeResumeJobStudent,
  currentJobStatus,
  publishUrl,
  publishLabel,
  publishPending,
  pinnedJobExpanded,
  onTogglePinnedJobExpanded,
  onRegeneratePronunciationAudio,
  onRepublishCurrentDraft,
  onCancelJob,
  rerunEnabled,
  cancelEnabled,
  actionBusy,
}: StartStageSectionProps) {
  return (
    <StageSection
      stage={stage}
      actions={
        <button type="button" className="minimal-secondary" onClick={onStartNewAssignment}>
          Start new assignment
        </button>
      }
    >
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Resume recent work</h3>
              <p>Pick up where you left off, or refresh the list if a new job finished recently.</p>
            </div>
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-secondary"
                onClick={onRefreshRecentWork}
                disabled={resumeLoading}
              >
                {resumeLoading ? 'Refreshing...' : 'Refresh recent work'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={onResumeSelectedAssignment}
                disabled={!selectedResumeJobId || resumeLoading}
              >
                Resume selected assignment
              </button>
            </div>
          </div>
          <label className="minimal-select">
            Recent assignments
            <select
              value={selectedResumeJobId}
              onChange={(event) => onSelectedResumeJobIdChange(event.target.value)}
              disabled={resumeJobs.length === 0 || resumeLoading}
            >
              {resumeJobs.length === 0 ? <option value="">No saved assignments yet</option> : null}
              {resumeJobs.map((job) => (
                <option key={job.jobId} value={job.jobId}>
                  {formatResumeJobLabel(job)}
                </option>
              ))}
            </select>
          </label>
          {resumeError ? <p className="minimal-error">{resumeError}</p> : null}
          {selectedResumeJob ? (
            <p className="minimal-muted">
              Selected assignment: {selectedResumeJob.jobId} ({selectedResumeJob.state} •{' '}
              {describeResumeJobStudent(selectedResumeJob)})
            </p>
          ) : null}
        </div>

        {currentJobStatus?.jobId ? (
          <div className="minimal-pinned-job">
            <div className="minimal-stage-panel-header">
              <div className="minimal-stage-panel-title">
                <h3>Current assignment</h3>
                <p>
                  Keep an eye on the latest shared output and jump back into advanced controls when
                  needed.
                </p>
              </div>
              <button
                type="button"
                className="minimal-secondary"
                onClick={onTogglePinnedJobExpanded}
              >
                {pinnedJobExpanded ? 'Hide details' : 'Show details'}
              </button>
            </div>
            <div className="minimal-meta">
              <span>Job ID: {currentJobStatus.jobId}</span>
              <span>Status: {currentJobStatus.state}</span>
              {publishUrl ? (
                <a href={publishUrl} target="_blank" rel="noreferrer">
                  {publishLabel}
                </a>
              ) : (
                <span className="minimal-muted">{publishPending}</span>
              )}
            </div>
            {pinnedJobExpanded ? (
              <div className="minimal-inline">
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onRegeneratePronunciationAudio}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Refresh pronunciation audio'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onRepublishCurrentDraft}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Republish current draft'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onCancelJob}
                  disabled={!cancelEnabled}
                >
                  {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </StageSection>
  );
}

export function SourceStageSection({
  stage,
  onRefreshStudents,
  studentOptions,
  studentOptionsError,
  selectedStudentId,
  onSelectedStudentIdChange,
  selectedStudent,
  selectedSttProvider,
  onSelectedSttProviderChange,
  sttProviders,
  formatSttProviderLabel,
  audioExtensions,
  uploading,
  selectedFileName,
  uploadProgress,
  onFiles,
  onCancelUpload,
  uploadError,
  uploadCacheNotice,
  recording,
  recordingStatus,
  recordingError,
  transcriptStatus,
  transcriptError,
  transcriptReady,
  onRefreshTranscript,
  retryingTranscript,
  onRetryTranscript,
  transcriptText,
  onTranscriptTextChange,
  transcriptDirty,
  transcriptSaving,
  onSaveTranscript,
}: SourceStageSectionProps) {
  return (
    <StageSection stage={stage}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Lesson recording</h3>
              <p>
                Choose a student, upload a recording, and let the transcript start in the
                background.
              </p>
            </div>
            <button type="button" className="minimal-secondary" onClick={onRefreshStudents}>
              Refresh students
            </button>
          </div>
          <label className="minimal-select">
            Student (optional)
            <select
              value={selectedStudentId}
              onChange={(event) => onSelectedStudentIdChange(event.target.value)}
            >
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
          {selectedStudent ? (
            <p className="minimal-muted">
              Selected: {selectedStudent.name}
              {selectedStudent.profileId ? ` (profile: ${selectedStudent.profileId})` : ''}
            </p>
          ) : null}
          {studentOptionsError ? <p className="minimal-error">{studentOptionsError}</p> : null}
          <details className="minimal-details">
            <summary>Recording settings</summary>
            <label className="minimal-select">
              Transcript engine
              <select
                value={selectedSttProvider}
                onChange={(event) => onSelectedSttProviderChange(event.target.value as SttProvider)}
                disabled={sttProviders.length === 0}
              >
                {sttProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {formatSttProviderLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
          </details>
          <DropZone
            title={uploading ? 'Uploading...' : 'Drop audio file'}
            description="Drag a recording here or click to browse"
            hint="Single file upload"
            accept={{ 'audio/*': [...audioExtensions] }}
            multiple={false}
            disabled={uploading}
            onFiles={onFiles}
          />
          {uploading ? (
            <UploadProgress
              fileName={selectedFileName}
              progress={uploadProgress}
              onCancel={onCancelUpload}
            />
          ) : null}
          {uploadError ? <p className="minimal-error">{uploadError}</p> : null}
          {uploadCacheNotice ? <p className="minimal-success">{uploadCacheNotice}</p> : null}
          {recording ? (
            <div className="minimal-meta">
              <span>Recording ID: {recording.recordingId}</span>
              <span>Status: {recordingStatus ?? 'unknown'}</span>
              <span>Transcript engine: {formatSttProviderLabel(selectedSttProvider)}</span>
              {selectedStudent ? <span>Student: {selectedStudent.name}</span> : null}
            </div>
          ) : null}
          {recordingError ? <p className="minimal-error">{recordingError}</p> : null}
        </div>

        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Transcript</h3>
              <p>
                Review the transcript here. You can refresh, retry, and make manual edits before
                continuing.
              </p>
            </div>
            <button
              type="button"
              className="minimal-secondary"
              onClick={onRefreshTranscript}
              disabled={!recording?.recordingId || transcriptStatus === 'loading'}
            >
              Refresh transcript
            </button>
          </div>
          {recording ? (
            transcriptStatus === 'processing' || transcriptStatus === 'idle' ? (
              <p className="minimal-help">
                Transcript in progress. We check every few seconds automatically.
              </p>
            ) : null
          ) : (
            <p className="minimal-help">Upload a recording to unlock the transcript.</p>
          )}
          {transcriptStatus === 'loading' ? (
            <p className="minimal-help">Loading transcript...</p>
          ) : null}
          {transcriptStatus === 'failed' ? (
            <div className="minimal-block">
              <p className="minimal-error">{transcriptError ?? 'Transcript failed to load.'}</p>
              <button
                type="button"
                className="minimal-secondary"
                onClick={onRetryTranscript}
                disabled={retryingTranscript}
              >
                {retryingTranscript ? 'Retrying...' : 'Retry transcript'}
              </button>
            </div>
          ) : null}
          {transcriptReady ? (
            <div className="minimal-block">
              <textarea
                aria-label="Transcript text"
                value={transcriptText}
                onChange={(event) => onTranscriptTextChange(event.target.value)}
                rows={10}
              />
              <div className="minimal-inline">
                <button
                  type="button"
                  className="minimal-primary"
                  onClick={onSaveTranscript}
                  disabled={!transcriptDirty || transcriptSaving}
                >
                  {transcriptSaving ? 'Saving...' : 'Save transcript edits'}
                </button>
                {transcriptDirty ? <span className="minimal-muted">Unsaved edits</span> : null}
              </div>
              {transcriptError ? <p className="minimal-error">{transcriptError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </StageSection>
  );
}

export function ContextStageSection({
  stage,
  onRefreshProfiles,
  onSaveProfile,
  profileBusy,
  selectedProfileId,
  onSelectedProfileIdChange,
  profileOptions,
  newProfileId,
  onNewProfileIdChange,
  onCreateProfile,
  profileEditorText,
  onProfileEditorTextChange,
  profileDirty,
  profileOptionsError,
  profileRevisionError,
  profileSuccess,
  profileRevisions,
  onRestoreRevision,
  teacherNotes,
  onTeacherNotesChange,
}: ContextStageSectionProps) {
  return (
    <StageSection stage={stage}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Learner profile</h3>
              <p>
                Use a saved learner profile to shape the assignment instructions, or edit the
                profile when needed.
              </p>
            </div>
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-secondary"
                onClick={onRefreshProfiles}
                disabled={profileBusy !== null}
              >
                Refresh profiles
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={onSaveProfile}
                disabled={!selectedProfileId || profileBusy !== null || !profileDirty}
              >
                {profileBusy === 'saving' ? 'Saving...' : 'Save profile'}
              </button>
            </div>
          </div>
          <label className="minimal-select">
            Learner profile
            <select
              value={selectedProfileId}
              onChange={(event) => onSelectedProfileIdChange(event.target.value)}
            >
              <option value="">Select profile</option>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} ({profile.id})
                </option>
              ))}
            </select>
          </label>
          <div className="minimal-inline">
            <label className="minimal-field grow">
              <span>New profile file</span>
              <input
                value={newProfileId}
                onChange={(event) => onNewProfileIdChange(event.target.value)}
                placeholder="profiles/new-student.md"
              />
            </label>
            <button
              type="button"
              className="minimal-secondary"
              onClick={onCreateProfile}
              disabled={profileBusy !== null}
            >
              {profileBusy === 'creating' ? 'Creating...' : 'Create profile'}
            </button>
          </div>
          <textarea
            aria-label="Profile content"
            value={profileEditorText}
            onChange={(event) => onProfileEditorTextChange(event.target.value)}
            rows={10}
            placeholder="Profile content..."
            disabled={!selectedProfileId && !newProfileId.trim()}
          />
          {profileDirty ? <p className="minimal-muted">Unsaved profile edits</p> : null}
          {profileOptionsError ? <p className="minimal-error">{profileOptionsError}</p> : null}
          {profileRevisionError ? <p className="minimal-error">{profileRevisionError}</p> : null}
          {profileSuccess ? <p className="minimal-success">{profileSuccess}</p> : null}
          {selectedProfileId ? (
            <details className="minimal-details">
              <summary>Profile history</summary>
              {profileRevisions.length > 0 ? (
                <div className="minimal-list">
                  {profileRevisions.map((revision) => (
                    <div key={revision.id} className="minimal-list-item">
                      <span>
                        {revision.source} • {new Date(revision.createdAt).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        className="minimal-secondary"
                        onClick={() => onRestoreRevision(revision.id)}
                        disabled={profileBusy !== null}
                      >
                        {profileBusy === 'restoring' ? 'Restoring...' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="minimal-muted">No revisions yet.</p>
              )}
            </details>
          ) : null}
        </div>

        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-title">
            <h3>Lesson guidance</h3>
            <p>
              Optional lesson-specific goals, corrections, or priorities you want the assignment to
              reflect.
            </p>
          </div>
          <textarea
            aria-label="Teacher notes"
            value={teacherNotes}
            onChange={(event) => onTeacherNotesChange(event.target.value)}
            rows={8}
            placeholder="Add lesson-specific context, corrections, or priorities for this assignment..."
          />
          <p className="minimal-help">
            This gets woven into the assignment instructions as extra teaching context.
          </p>
        </div>
      </div>
    </StageSection>
  );
}

export function AssignmentStageSection({
  stage,
  transcriptReady,
  promptLoading,
  promptReady,
  promptOptionsReady,
  onGeneratePrompt,
  onCopyPrompt,
  promptCopyState,
  onReloadPromptOptions,
  promptError,
  promptPackage,
  promptText,
  onPromptTextChange,
  onSaveDraft,
  validating,
  draftDirty,
  generationOptionsAvailable,
  selectedGenerationProvider,
  onSelectedGenerationProviderChange,
  generationProviders,
  selectedGenerationModel,
  onSelectedGenerationModelChange,
  generationModelsForProvider,
  onGenerateDraft,
  generatingDraft,
  generationBlockedByQuota,
  activeGenerationQuota,
  generationQuotaSourceLabel,
  generationQuotaUpdatedRelative,
  generationQuotaUpdatedAbsolute,
  generationQuotaHasNumericValues,
  generationQuotaBlockedReason,
  generationError,
  generationSuccess,
  draftText,
  onDraftTextChange,
  validation,
  validationError,
  draftError,
}: AssignmentStageSectionProps) {
  return (
    <StageSection stage={stage}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Assignment instructions</h3>
              <p>
                Generate the teaching instructions first, then tweak them before you create the
                assignment content.
              </p>
            </div>
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-primary"
                onClick={onGeneratePrompt}
                disabled={!transcriptReady || promptLoading || !promptOptionsReady}
              >
                {promptLoading
                  ? 'Generating...'
                  : promptReady
                    ? 'Refresh instructions'
                    : 'Generate instructions'}
              </button>
              <button
                type="button"
                className="minimal-secondary"
                onClick={onCopyPrompt}
                disabled={!promptText.trim()}
              >
                {promptCopyState === 'copied' ? 'Copied' : 'Copy instructions'}
              </button>
              {promptOptionsReady ? null : (
                <button type="button" className="minimal-secondary" onClick={onReloadPromptOptions}>
                  Reload instructions
                </button>
              )}
            </div>
          </div>
          <p className="minimal-help">
            Uses the default template and the current learner profile when one is selected.
          </p>
          {promptError ? <p className="minimal-error">{promptError}</p> : null}
          {promptPackage?.profileDrift?.detected ? (
            <div className="minimal-alert warning">
              <strong>Profile drift detected</strong>
              <p className="minimal-help">
                The learner profile changed after these instructions were generated (
                {promptPackage.profileDrift.reason}). Refresh the instructions to pick up the
                latest version.
              </p>
            </div>
          ) : null}
          {promptText ? (
            <textarea
              aria-label="Prompt text"
              value={promptText}
              onChange={(event) => onPromptTextChange(event.target.value)}
              rows={12}
            />
          ) : (
            <p className="minimal-muted">Generate instructions to continue.</p>
          )}
        </div>

        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Assignment content</h3>
              <p>
                Generate the assignment content from the instructions, or paste and edit your own
                version here.
              </p>
            </div>
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-primary"
                onClick={onSaveDraft}
                disabled={!promptReady || validating}
              >
                {validating ? 'Validating...' : 'Save assignment content'}
              </button>
              {draftDirty ? <span className="minimal-muted">Unsaved changes</span> : null}
            </div>
          </div>
          <details className="minimal-details">
            <summary>Generation settings</summary>
            <div className="minimal-generation-block">
              <div className="minimal-inline">
                <label className="minimal-select">
                  Generation provider
                  <select
                    value={selectedGenerationProvider}
                    onChange={(event) => onSelectedGenerationProviderChange(event.target.value)}
                    disabled={
                      !generationOptionsAvailable || generatingDraft || generationProviders.length === 0
                    }
                  >
                    {generationProviders.length === 0 ? (
                      <option value="">No providers available</option>
                    ) : null}
                    {generationProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="minimal-select">
                  Generation model
                  <select
                    value={selectedGenerationModel}
                    onChange={(event) => onSelectedGenerationModelChange(event.target.value)}
                    disabled={
                      !generationOptionsAvailable ||
                      generatingDraft ||
                      !selectedGenerationProvider ||
                      generationModelsForProvider.length === 0
                    }
                  >
                    {generationModelsForProvider.length === 0 ? (
                      <option value="">No models available</option>
                    ) : null}
                    {generationModelsForProvider.map((modelOption) => (
                      <option key={`${modelOption.provider}:${modelOption.id}`} value={modelOption.id}>
                        {modelOption.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onGenerateDraft}
                  disabled={
                    !promptReady ||
                    generatingDraft ||
                    !generationOptionsAvailable ||
                    !selectedGenerationProvider ||
                    !selectedGenerationModel ||
                    generationBlockedByQuota
                  }
                >
                  {generatingDraft ? 'Generating assignment...' : 'Generate assignment content'}
                </button>
              </div>
              {generationOptionsAvailable ? (
                <details className="minimal-details" open>
                  <summary>Generation limits and provider notes</summary>
                  {activeGenerationQuota ? (
                    <>
                      <div className="minimal-meta">
                        <span>Source: {generationQuotaSourceLabel}</span>
                        <span>
                          Updated: {generationQuotaUpdatedRelative} ({generationQuotaUpdatedAbsolute})
                        </span>
                      </div>
                      {generationQuotaHasNumericValues ? (
                        <div className="minimal-quota-grid">
                          {activeGenerationQuota.requestsPerMinute === undefined ||
                          activeGenerationQuota.requestsPerMinute === null ? null : (
                            <div className="minimal-quota-item">
                              RPM: {activeGenerationQuota.requestsPerMinute}
                            </div>
                          )}
                          {activeGenerationQuota.tokensPerMinute === undefined ||
                          activeGenerationQuota.tokensPerMinute === null ? null : (
                            <div className="minimal-quota-item">
                              TPM: {activeGenerationQuota.tokensPerMinute}
                            </div>
                          )}
                          {activeGenerationQuota.requestsPerDay === undefined ||
                          activeGenerationQuota.requestsPerDay === null ? null : (
                            <div className="minimal-quota-item">
                              RPD: {activeGenerationQuota.requestsPerDay}
                            </div>
                          )}
                          {activeGenerationQuota.dailyTokenBudget === undefined ||
                          activeGenerationQuota.dailyTokenBudget === null ? null : (
                            <div className="minimal-quota-item">
                              Daily token budget: {activeGenerationQuota.dailyTokenBudget}
                            </div>
                          )}
                          {activeGenerationQuota.dailyTokenRemaining === undefined ||
                          activeGenerationQuota.dailyTokenRemaining === null ? null : (
                            <div className="minimal-quota-item">
                              Daily token remaining: {activeGenerationQuota.dailyTokenRemaining}
                            </div>
                          )}
                          {activeGenerationQuota.dailyRequestBudget === undefined ||
                          activeGenerationQuota.dailyRequestBudget === null ? null : (
                            <div className="minimal-quota-item">
                              Daily request budget: {activeGenerationQuota.dailyRequestBudget}
                            </div>
                          )}
                          {activeGenerationQuota.dailyRequestRemaining === undefined ||
                          activeGenerationQuota.dailyRequestRemaining === null ? null : (
                            <div className="minimal-quota-item">
                              Daily request remaining: {activeGenerationQuota.dailyRequestRemaining}
                            </div>
                          )}
                          {activeGenerationQuota.rpmBudget === undefined ||
                          activeGenerationQuota.rpmBudget === null ? null : (
                            <div className="minimal-quota-item">
                              RPM budget: {activeGenerationQuota.rpmBudget}
                            </div>
                          )}
                          {activeGenerationQuota.rpmRemaining === undefined ||
                          activeGenerationQuota.rpmRemaining === null ? null : (
                            <div className="minimal-quota-item">
                              RPM remaining: {activeGenerationQuota.rpmRemaining}
                            </div>
                          )}
                          {activeGenerationQuota.usedRequestsToday === undefined ||
                          activeGenerationQuota.usedRequestsToday === null ? null : (
                            <div className="minimal-quota-item">
                              Used requests today: {activeGenerationQuota.usedRequestsToday}
                            </div>
                          )}
                          {activeGenerationQuota.usedTokensToday === undefined ||
                          activeGenerationQuota.usedTokensToday === null ? null : (
                            <div className="minimal-quota-item">
                              Used tokens today: {activeGenerationQuota.usedTokensToday}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="minimal-muted">No numeric limits available for this model.</p>
                      )}
                      {activeGenerationQuota.dashboardUrl ? (
                        <a href={activeGenerationQuota.dashboardUrl} target="_blank" rel="noreferrer">
                          View provider limits
                        </a>
                      ) : null}
                      {generationQuotaBlockedReason ? (
                        <p className="minimal-error">{generationQuotaBlockedReason}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="minimal-muted">Quota snapshot unavailable.</p>
                  )}
                </details>
              ) : (
                <p className="minimal-muted">
                  Generation options unavailable. Reload assignment settings if needed.
                </p>
              )}
              {generationError ? <p className="minimal-error">{generationError}</p> : null}
              {generationSuccess ? <p className="minimal-success">{generationSuccess}</p> : null}
            </div>
          </details>
          <textarea
            aria-label="Draft markdown"
            value={draftText}
            onChange={(event) => onDraftTextChange(event.target.value)}
            rows={14}
          />
          {validation?.errors?.length ? (
            <div className="minimal-alert">
              <strong>Validation errors</strong>
              <ul>
                {validation.errors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {validation?.warnings?.length ? (
            <div className="minimal-alert warning">
              <strong>Warnings</strong>
              <ul>
                {validation.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {validationError ? <p className="minimal-error">{validationError}</p> : null}
          {draftError ? <p className="minimal-error">{draftError}</p> : null}
        </div>
      </div>
    </StageSection>
  );
}

export function ReviewStageSection({
  stage,
  onPublish,
  canPublishWithPreview,
  publishing,
  previewing,
  onPreviewDraft,
  draftHasContent,
  previewReadyForCurrentDraft,
  publishTarget,
  onPublishTargetChange,
  selectedPreset,
  onSelectedPresetChange,
  presetOptions,
  jobOptionsLoaded,
  selectedTtsProvider,
  onSelectedTtsProviderChange,
  ttsProviders,
  selectedTtsStrategy,
  onSelectedTtsStrategyChange,
  availablePublishTtsStrategies,
  formatPublishTtsStrategyLabel,
  selectedTtsModel,
  onSelectedTtsModelChange,
  publishModelSelectionDisabled,
  selectedTtsModelOptions,
  previewError,
  previewHtml,
  publishError,
  currentJobStatus,
  jobFailureReason,
  jobReady,
  publishUrl,
  publishLabel,
  publishPending,
}: ReviewStageSectionProps) {
  return (
    <StageSection
      stage={stage}
      actions={
        <button
          type="button"
          className="minimal-primary"
          onClick={onPublish}
          disabled={!canPublishWithPreview}
        >
          {publishing ? 'Sharing...' : 'Share assignment'}
        </button>
      }
    >
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Preview before you share</h3>
              <p>
                Preview locks the current version, so you always know exactly what will be shared.
              </p>
            </div>
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-secondary"
                onClick={onPreviewDraft}
                disabled={previewing || !draftHasContent}
              >
                {previewing ? 'Rendering preview...' : 'Preview assignment'}
              </button>
              <span className={previewReadyForCurrentDraft ? 'minimal-success' : 'minimal-muted'}>
                {previewReadyForCurrentDraft
                  ? 'Preview ready for current assignment.'
                  : 'Preview required before sharing.'}
              </span>
            </div>
          </div>
          <label className="minimal-select">
            Share to
            <select
              value={publishTarget}
              onChange={(event) => onPublishTargetChange(event.target.value as MinimalPublishTarget)}
            >
              <option value="notion">Notion</option>
              <option value="anytype">Anytype</option>
              <option value="html">HTML page</option>
            </select>
          </label>
          <details className="minimal-details">
            <summary>Audio and publishing settings</summary>
            <div className="minimal-grid">
              <label className="minimal-select">
                Learning preset
                <select
                  value={selectedPreset}
                  onChange={(event) => onSelectedPresetChange(event.target.value)}
                  disabled={!jobOptionsLoaded || presetOptions.length === 0}
                >
                  {presetOptions.length > 0 ? null : <option value="">No presets available</option>}
                  {presetOptions.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="minimal-select">
                Voice engine
                <select
                  value={selectedTtsProvider}
                  onChange={(event) =>
                    onSelectedTtsProviderChange(event.target.value as 'elevenlabs' | 'google')
                  }
                  disabled={ttsProviders.length === 0}
                >
                  {ttsProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="minimal-select">
                Reading style
                <select
                  value={selectedTtsStrategy}
                  onChange={(event) =>
                    onSelectedTtsStrategyChange(event.target.value as 'auto' | 'dialogue' | 'tts')
                  }
                >
                  {availablePublishTtsStrategies.map((strategy) => (
                    <option key={strategy} value={strategy}>
                      {formatPublishTtsStrategyLabel(strategy)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="minimal-select">
                Voice model
                <select
                  value={selectedTtsModel}
                  onChange={(event) => onSelectedTtsModelChange(event.target.value)}
                  disabled={publishModelSelectionDisabled || selectedTtsModelOptions.length === 0}
                >
                  {publishModelSelectionDisabled ? (
                    <option value="">Auto follows the assignment</option>
                  ) : selectedTtsModelOptions.length === 0 ? (
                    <option value="">No models available</option>
                  ) : null}
                  {selectedTtsModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {publishModelSelectionDisabled ? (
              <p className="minimal-muted">
                Auto follows the assignment at runtime. Choose Dialogue or TTS to lock a model.
              </p>
            ) : null}
          </details>
          {previewError ? <p className="minimal-error">{previewError}</p> : null}
          {previewHtml ? (
            <details className="minimal-preview" open>
              <summary>Preview panel</summary>
              <iframe className="minimal-preview-frame" srcDoc={previewHtml} title="Draft preview" />
            </details>
          ) : null}
          {publishError ? <p className="minimal-error">{publishError}</p> : null}
          {jobFailureReason ? <p className="minimal-error">{jobFailureReason}</p> : null}
          {jobReady ? (
            <div className="minimal-meta">
              <span>Job ID: {currentJobStatus?.jobId}</span>
              <span>Status: {currentJobStatus?.state}</span>
              {publishUrl ? (
                <a href={publishUrl} target="_blank" rel="noreferrer">
                  {publishLabel}
                </a>
              ) : (
                <span className="minimal-muted">{publishPending}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </StageSection>
  );
}
