import React from 'react';
import { Link, useInRouterContext } from 'react-router-dom';

import type {
  GenerateDraftResponse,
  JobStatus,
  MarkdownValidationResponse,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';

export type WorkflowStageId = 'start' | 'source' | 'context' | 'assignment' | 'review' | 'advanced';
export type WorkflowStageStatus = 'current' | 'complete' | 'available' | 'locked';
export type StartStageMode = 'idle' | 'resume' | 'start';

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

export interface ResumeJobListItem {
  jobId: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: 'success' | 'progress' | 'warning' | 'neutral';
  timeLabel: string;
  publishLabel: string;
  supportLabel: string;
  selected: boolean;
}

export interface CurrentAssignmentCard {
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: ResumeJobListItem['statusTone'];
  meta: string[];
  supportLabel: string;
}

interface WorkflowOverviewProps {
  currentStageTitle: string;
  stages: WorkflowStage[];
  summaryItems: WorkflowSummaryItem[];
}

interface StageSectionProps {
  stage: WorkflowStage;
  actions?: React.ReactNode;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  guidance?: React.ReactNode;
  children: React.ReactNode;
}

interface StartStageSectionProps {
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  mode: StartStageMode;
  onStartNewAssignment: () => void;
  onShowResumeChoice: () => void;
  onRefreshRecentWork: () => void;
  onResumeSelectedAssignment: () => void;
  resumeLoading: boolean;
  selectedResumeJobId: string;
  onSelectedResumeJobIdChange: (value: string) => void;
  resumeJobItems: ResumeJobListItem[];
  totalResumeJobs: number;
  canToggleResumeJobs: boolean;
  showAllResumeJobs: boolean;
  onToggleShowAllResumeJobs: () => void;
  resumeError: string | null;
  currentJobStatus: JobStatus | null;
  currentAssignmentCard: CurrentAssignmentCard | null;
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
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  studentSelectRef?: React.Ref<HTMLSelectElement>;
  onRefreshStudents: () => void;
  studentOptions: StudentOption[];
  studentOptionsError: string | null;
  selectedStudentId: string;
  onSelectedStudentIdChange: (value: string) => void;
  selectedStudent: StudentOption | null;
  linkedLessonId?: string | null;
  linkedLessonContextLabel?: string | null;
  lessonSuggestions: { id: string; label: string; detail: string }[];
  lessonSuggestionsError: string | null;
  onSelectLessonSuggestion: (lessonId: string) => void;
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
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  studentId: string;
  selectedProfileId: string;
  profilePreview: {
    profileId: string;
    overallLevel: string | null;
    goalsAndContexts: string[];
    strengthsAndChallenges: string[];
    teacherNoteSnippet: string | null;
    updatedAt: string | null;
  } | null;
  profileRevisionError: string | null;
  teacherNotes: string;
  onTeacherNotesChange: (value: string) => void;
}

interface AssignmentStageSectionProps {
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  generateDraftButtonRef?: React.Ref<HTMLButtonElement>;
  transcriptReady: boolean;
  promptLoading: boolean;
  promptReady: boolean;
  promptOptionsReady: boolean;
  promptTemplates: { id: string; label: string }[];
  selectedTemplateId: string;
  selectedTemplateLabel: string;
  selectedProfileLabel: string;
  onSelectedTemplateIdChange: (templateId: string) => void;
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
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  previewButtonRef?: React.Ref<HTMLButtonElement>;
  onPublish: () => void;
  canPublishWithPreview: boolean;
  publishing: boolean;
  previewing: boolean;
  onPreviewDraft: () => void;
  draftHasContent: boolean;
  previewReadyForCurrentDraft: boolean;
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

function StageGuidance({ children }: { children: React.ReactNode }) {
  return (
    <div className="minimal-stage-guidance" role="note">
      {children}
    </div>
  );
}

export function StageSection({
  stage,
  actions,
  sectionRef,
  headingRef,
  guidance,
  children,
}: StageSectionProps) {
  return (
    <section ref={sectionRef} className={`minimal-section minimal-stage-card is-${stage.status}`}>
      <div className="minimal-stage-header">
        <div className="minimal-stage-header-copy">
          <h2 ref={headingRef} tabIndex={-1}>
            {stage.title}
          </h2>
          <p>{stage.description}</p>
        </div>
        <div className="minimal-stage-header-actions">
          <span className={`minimal-stage-state is-${stage.status}`}>
            {formatWorkflowStageStatusLabel(stage.status)}
          </span>
          {actions}
        </div>
      </div>
      {guidance ? <StageGuidance>{guidance}</StageGuidance> : null}
      {children}
    </section>
  );
}

export function StartStageSection({
  stage,
  sectionRef,
  headingRef,
  mode,
  onStartNewAssignment,
  onShowResumeChoice,
  onRefreshRecentWork,
  onResumeSelectedAssignment,
  resumeLoading,
  selectedResumeJobId,
  onSelectedResumeJobIdChange,
  resumeJobItems,
  totalResumeJobs,
  canToggleResumeJobs,
  showAllResumeJobs,
  onToggleShowAllResumeJobs,
  resumeError,
  currentJobStatus,
  currentAssignmentCard,
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
  const showResumePanel = mode === 'resume';
  const showStartedSummary = mode === 'start';

  return (
    <StageSection stage={stage} sectionRef={sectionRef} headingRef={headingRef}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-title">
            <h3>Choose how you want to continue</h3>
            <p>Pick a lane once, then we will steer you to the next useful step automatically.</p>
          </div>
          <div className="minimal-choice-grid" aria-label="Assignment start options">
            <button
              type="button"
              aria-pressed={showResumePanel}
              className={`minimal-choice-card${showResumePanel ? ' is-selected' : ''}`}
              onClick={onShowResumeChoice}
            >
              <span className="minimal-choice-eyebrow">Resume</span>
              <span className="minimal-choice-title">Resume recent work</span>
              <span className="minimal-choice-copy">
                Reopen an existing assignment and jump back into editing or sharing.
              </span>
            </button>
            <button
              type="button"
              aria-pressed={showStartedSummary}
              className={`minimal-choice-card${showStartedSummary ? ' is-selected' : ''}`}
              onClick={onStartNewAssignment}
            >
              <span className="minimal-choice-eyebrow">New</span>
              <span className="minimal-choice-title">Start new assignment</span>
              <span className="minimal-choice-copy">
                Begin clean and move straight into student selection and recording upload.
              </span>
            </button>
          </div>

          {showStartedSummary ? (
            <div className="minimal-start-summary">
              <div>
                <strong>New assignment ready.</strong>
                <p className="minimal-help">
                  Next up: choose the student and upload the lesson recording in the next section.
                </p>
              </div>
              <button type="button" className="minimal-secondary" onClick={onShowResumeChoice}>
                Switch to resume
              </button>
            </div>
          ) : null}

          {showResumePanel ? (
            <div className="minimal-resume-list-block">
              <div className="minimal-stage-panel-header">
                <div className="minimal-stage-panel-title">
                  <h3>Recent assignments</h3>
                  <p>Choose one assignment to reopen, then continue exactly where you left off.</p>
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
                    className="minimal-primary minimal-guided-button"
                    onClick={onResumeSelectedAssignment}
                    disabled={!selectedResumeJobId || resumeLoading}
                  >
                    {resumeLoading ? 'Opening assignment...' : 'Resume selected assignment'}
                  </button>
                </div>
              </div>
              {resumeJobItems.length > 0 ? (
                <>
                  <div className="minimal-list-heading">
                    <span>Recent assignments</span>
                    <span className="minimal-muted">
                      {resumeJobItems.length === totalResumeJobs
                        ? `${totalResumeJobs} ${totalResumeJobs === 1 ? 'assignment' : 'assignments'}`
                        : `${resumeJobItems.length} of ${totalResumeJobs} assignments`}
                    </span>
                  </div>
                  <div
                    className="minimal-resume-list"
                    role="listbox"
                    aria-label="Recent assignments"
                    aria-busy={resumeLoading}
                  >
                    {resumeJobItems.map((job) => (
                      <button
                        key={job.jobId}
                        type="button"
                        role="option"
                        aria-selected={job.selected}
                        className={`minimal-resume-card minimal-resume-card--${job.statusTone}${
                          job.selected ? ' minimal-resume-card--selected' : ''
                        }`}
                        onClick={() => onSelectedResumeJobIdChange(job.jobId)}
                      >
                        <span className="minimal-resume-card-leading" aria-hidden="true" />
                        <span className="minimal-resume-card-main">
                          <span className="minimal-resume-card-head">
                            <span className="minimal-resume-card-title">{job.title}</span>
                            <span
                              className={`minimal-status-pill minimal-status-pill--${job.statusTone}`}
                            >
                              {job.statusLabel}
                            </span>
                          </span>
                          <span className="minimal-resume-card-subtitle">{job.subtitle}</span>
                          <span className="minimal-resume-card-meta">
                            <span>{job.timeLabel}</span>
                            <span>{job.publishLabel}</span>
                            <span className="minimal-muted">{job.supportLabel}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {canToggleResumeJobs ? (
                    <button
                      type="button"
                      className="minimal-text-action"
                      onClick={onToggleShowAllResumeJobs}
                    >
                      {showAllResumeJobs ? 'Show fewer assignments' : 'Show more assignments'}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="minimal-muted">No saved assignments yet.</p>
              )}
              <button type="button" className="minimal-text-action" onClick={onStartNewAssignment}>
                Start new instead
              </button>
            </div>
          ) : null}

          {mode === 'idle' ? (
            <p className="minimal-help">
              Pick one path to unlock the next recommended step in the builder.
            </p>
          ) : null}
          {resumeError ? <p className="minimal-error">{resumeError}</p> : null}
        </div>

        {currentJobStatus?.jobId && currentAssignmentCard ? (
          <div className="minimal-pinned-job">
            <div className="minimal-stage-panel-header">
              <div className="minimal-stage-panel-title">
                <div className="minimal-pinned-job-headline">
                  <h3>{currentAssignmentCard.title}</h3>
                  <span
                    className={`minimal-status-pill minimal-status-pill--${currentAssignmentCard.statusTone}`}
                  >
                    {currentAssignmentCard.statusLabel}
                  </span>
                </div>
                <p>{currentAssignmentCard.subtitle}</p>
              </div>
              <button
                type="button"
                className="minimal-secondary"
                onClick={onTogglePinnedJobExpanded}
              >
                {pinnedJobExpanded ? 'Hide details' : 'Show details'}
              </button>
            </div>
            <div className="minimal-pinned-job-meta">
              {currentAssignmentCard.meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
              <span className="minimal-muted">{currentAssignmentCard.supportLabel}</span>
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
  sectionRef,
  headingRef,
  studentSelectRef,
  onRefreshStudents,
  studentOptions,
  studentOptionsError,
  selectedStudentId,
  onSelectedStudentIdChange,
  selectedStudent,
  linkedLessonId,
  linkedLessonContextLabel,
  lessonSuggestions,
  lessonSuggestionsError,
  onSelectLessonSuggestion,
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
  const sourceGuidance =
    stage.status === 'current'
      ? !selectedStudentId
        ? 'Next step: choose the student for this lesson.'
        : !recording
          ? 'Next step: upload the lesson recording.'
          : !transcriptReady && transcriptStatus === 'failed'
            ? 'Next step: retry the transcript so you can keep moving.'
            : !transcriptReady
              ? 'Next step: wait for the transcript, then review it here.'
              : null
      : null;

  return (
    <StageSection
      stage={stage}
      sectionRef={sectionRef}
      headingRef={headingRef}
      guidance={sourceGuidance}
    >
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
            Student
            <select
              ref={studentSelectRef}
              className={
                stage.status === 'current' && !selectedStudentId
                  ? 'minimal-guided-field'
                  : undefined
              }
              value={selectedStudentId}
              onChange={(event) => onSelectedStudentIdChange(event.target.value)}
              disabled={Boolean(linkedLessonId)}
            >
              <option value="">Select a student</option>
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
          ) : (
            <p className="minimal-help">Select a student before uploading a recording.</p>
          )}
          {linkedLessonContextLabel ? (
            <p className="minimal-muted">{linkedLessonContextLabel}</p>
          ) : null}
          {!linkedLessonId && lessonSuggestions.length > 0 ? (
            <div className="minimal-block" aria-label="Recent lesson suggestions">
              <p className="minimal-help">Recent lessons without homework</p>
              <div className="minimal-inline">
                {lessonSuggestions.map((lesson) => (
                  <button
                    key={lesson.id}
                    type="button"
                    className="minimal-secondary"
                    onClick={() => onSelectLessonSuggestion(lesson.id)}
                  >
                    {lesson.label}
                    <span className="minimal-muted"> {lesson.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {lessonSuggestionsError ? (
            <p className="minimal-muted">Recent lesson suggestions unavailable.</p>
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
          <div
            className={
              stage.status === 'current' && selectedStudentId && !recording
                ? 'minimal-guided-surface'
                : undefined
            }
          >
            <DropZone
              title={uploading ? 'Uploading...' : 'Drop audio file'}
              description={
                selectedStudentId
                  ? 'Drag a recording here or click to browse'
                  : 'Choose a student first to unlock recording upload'
              }
              hint="Single file upload"
              accept={{ 'audio/*': [...audioExtensions] }}
              multiple={false}
              disabled={uploading || !selectedStudentId}
              onFiles={onFiles}
            />
          </div>
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
  sectionRef,
  headingRef,
  studentId,
  selectedProfileId,
  profilePreview,
  profileRevisionError,
  teacherNotes,
  onTeacherNotesChange,
}: ContextStageSectionProps) {
  const isInRouterContext = useInRouterContext();
  const contextGuidance =
    stage.status === 'current'
      ? 'Next step: review the learner context, add lesson goals here, then generate instructions in the next section.'
      : null;

  return (
    <StageSection
      stage={stage}
      sectionRef={sectionRef}
      headingRef={headingRef}
      guidance={contextGuidance}
    >
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Current learner profile</h3>
              <p>
                Review the durable learner context that will be injected into prompt packaging. Use
                the dedicated Learning page for any profile edits.
              </p>
            </div>
          </div>
          {profileRevisionError ? <p className="minimal-error">{profileRevisionError}</p> : null}
          {selectedProfileId && profilePreview ? (
            <div className="minimal-profile-card">
              <div className="minimal-profile-meta-grid">
                <div>
                  <span>Profile</span>
                  <strong>{profilePreview.profileId}</strong>
                </div>
                <div>
                  <span>Level</span>
                  <strong>{profilePreview.overallLevel ?? 'Not set yet'}</strong>
                </div>
                {profilePreview.updatedAt ? (
                  <div>
                    <span>Updated</span>
                    <strong>{new Date(profilePreview.updatedAt).toLocaleString()}</strong>
                  </div>
                ) : null}
              </div>
              <div className="minimal-profile-scan-grid">
                {profilePreview.goalsAndContexts.length > 0 ? (
                  <section className="minimal-profile-scan-group">
                    <h4>Goals / context</h4>
                    <ul>
                      {profilePreview.goalsAndContexts.map((item) => (
                        <li key={`goal-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {profilePreview.strengthsAndChallenges.length > 0 ? (
                  <section className="minimal-profile-scan-group">
                    <h4>Strengths / challenges</h4>
                    <ul>
                      {profilePreview.strengthsAndChallenges.map((item) => (
                        <li key={`signal-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {profilePreview.teacherNoteSnippet ? (
                  <section className="minimal-profile-scan-group minimal-profile-scan-group-wide">
                    <h4>Teacher note</h4>
                    <p>{profilePreview.teacherNoteSnippet}</p>
                  </section>
                ) : null}
              </div>
            </div>
          ) : selectedProfileId ? (
            <p className="minimal-muted">
              This learner profile has not been structured yet. Open the Learning page to review it
              there.
            </p>
          ) : null}
          {!selectedProfileId ? (
            <p className="minimal-muted">
              No learner profile is selected for this student yet. Open the Learning page to create
              or choose the canonical profile before generating instructions.
            </p>
          ) : null}
          <div className="minimal-inline">
            {studentId ? (
              isInRouterContext ? (
                <Link
                  className="minimal-primary minimal-link-button"
                  to={`/students/${encodeURIComponent(studentId)}/learning`}
                >
                  Open Learning page
                </Link>
              ) : (
                <a
                  className="minimal-primary minimal-link-button"
                  href={`/students/${encodeURIComponent(studentId)}/learning`}
                >
                  Open Learning page
                </a>
              )
            ) : (
              <span className="minimal-primary minimal-link-button" aria-disabled="true">
                Open Learning page
              </span>
            )}
          </div>
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
  sectionRef,
  headingRef,
  generateDraftButtonRef,
  transcriptReady,
  promptLoading,
  promptReady,
  promptOptionsReady,
  promptTemplates,
  selectedTemplateId,
  selectedTemplateLabel,
  selectedProfileLabel,
  onSelectedTemplateIdChange,
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
  const instructionsReadyToGenerate = transcriptReady && !promptReady;
  const assignmentGuidance =
    stage.status === 'current'
      ? 'Next step: generate the assignment content or paste your own version, then save the draft.'
      : stage.status === 'available' && instructionsReadyToGenerate
        ? 'Ready when you are: generate instructions here after you finish reviewing the teaching context.'
        : null;

  return (
    <StageSection
      stage={stage}
      sectionRef={sectionRef}
      headingRef={headingRef}
      guidance={assignmentGuidance}
    >
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
              <label className="minimal-select minimal-template-select">
                Prompt template
                <select
                  value={selectedTemplateId}
                  onChange={(event) => onSelectedTemplateIdChange(event.target.value)}
                  disabled={!promptOptionsReady || promptTemplates.length === 0 || promptLoading}
                >
                  {promptTemplates.length === 0 ? (
                    <option value="">No templates available</option>
                  ) : null}
                  {promptTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`minimal-primary${
                  instructionsReadyToGenerate ? ' minimal-guided-button' : ''
                }`}
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
            Uses {selectedTemplateLabel} with {selectedProfileLabel}.
          </p>
          {promptError ? <p className="minimal-error">{promptError}</p> : null}
          {promptPackage?.profileDrift?.detected ? (
            <div className="minimal-alert warning">
              <strong>Profile drift detected</strong>
              <p className="minimal-help">
                The learner profile changed after these instructions were generated (
                {promptPackage.profileDrift.reason}). Refresh the instructions to pick up the latest
                version.
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
                      !generationOptionsAvailable ||
                      generatingDraft ||
                      generationProviders.length === 0
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
                      <option
                        key={`${modelOption.provider}:${modelOption.id}`}
                        value={modelOption.id}
                      >
                        {modelOption.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  ref={generateDraftButtonRef}
                  type="button"
                  className={`minimal-secondary${
                    stage.status === 'current'
                      ? ' minimal-guided-button minimal-guided-button--secondary'
                      : ''
                  }`}
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
                          Updated: {generationQuotaUpdatedRelative} (
                          {generationQuotaUpdatedAbsolute})
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
                        <a
                          href={activeGenerationQuota.dashboardUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
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
  sectionRef,
  headingRef,
  previewButtonRef,
  onPublish,
  canPublishWithPreview,
  publishing,
  previewing,
  onPreviewDraft,
  draftHasContent,
  previewReadyForCurrentDraft,
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
  const reviewGuidance =
    stage.status === 'current'
      ? previewReadyForCurrentDraft
        ? 'Next step: share the assignment when you are happy with the preview.'
        : 'Next step: preview the current draft, then share the assignment.'
      : null;

  return (
    <StageSection
      stage={stage}
      sectionRef={sectionRef}
      headingRef={headingRef}
      guidance={reviewGuidance}
      actions={
        <button
          type="button"
          className={`minimal-primary${
            stage.status === 'current' && previewReadyForCurrentDraft
              ? ' minimal-guided-button'
              : ''
          }`}
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
                ref={previewButtonRef}
                type="button"
                className={`minimal-secondary${
                  stage.status === 'current' && !previewReadyForCurrentDraft
                    ? ' minimal-guided-button minimal-guided-button--secondary'
                    : ''
                }`}
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
          <p className="minimal-help">Assignments publish as HTML pages.</p>
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
              <iframe
                className="minimal-preview-frame"
                srcDoc={previewHtml}
                title="Draft preview"
              />
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
