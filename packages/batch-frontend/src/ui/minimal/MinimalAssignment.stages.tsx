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
import { getTranscriptUnexpectedCharacterWarnings } from './MinimalAssignment.transcript-warnings';

export type WorkflowStageId = 'start' | 'source' | 'context' | 'assignment' | 'review' | 'advanced';
export type WorkflowStageStatus = 'current' | 'complete' | 'available' | 'locked';
export type StartStageMode = 'idle' | 'resume' | 'start';

export interface WorkflowStage {
  id: WorkflowStageId;
  title: string;
  description: string;
  status: WorkflowStageStatus;
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
  statusLabel: string;
  statusTone: ResumeJobListItem['statusTone'];
  meta: string[];
  supportLabel: string;
}

interface WorkflowOverviewProps {
  currentStageTitle: string;
  stages: WorkflowStage[];
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
  onReloadPromptOptions: () => void;
  promptError: string | null;
  onSaveDraft: () => void;
  validating: boolean;
  draftDirty: boolean;
  generationOptionsAvailable: boolean;
  onGenerateAssignment: () => void;
  generatingDraft: boolean;
  generationBlockedByQuota: boolean;
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
  onCancelJob: () => void;
  canPublishWithPreview: boolean;
  cancelEnabled: boolean;
  actionBusy: 'rerun' | 'cancel' | null;
  publishing: boolean;
  previewing: boolean;
  onPreviewDraft: () => void;
  draftHasContent: boolean;
  previewReadyForCurrentDraft: boolean;
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

export function WorkflowOverview({ currentStageTitle, stages }: WorkflowOverviewProps) {
  return (
    <section className="minimal-overview" aria-labelledby="assignment-builder-title">
      <div className="minimal-overview-header">
        <div className="minimal-overview-copy">
          <h1 id="assignment-builder-title">Build and share a lesson assignment</h1>
        </div>
        <div className="minimal-stage-state is-current">Current focus: {currentStageTitle}</div>
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
  const isLocked = stage.status === 'locked';
  const stageActions = isLocked ? null : actions;
  const stageGuidance = isLocked ? null : guidance;
  const stageContent = isLocked ? null : children;

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
          {stageActions}
        </div>
      </div>
      {stageGuidance ? <StageGuidance>{stageGuidance}</StageGuidance> : null}
      {stageContent}
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
}: StartStageSectionProps) {
  const showResumePanel = mode === 'resume';
  const showStartedSummary = mode === 'start';

  return (
    <StageSection stage={stage} sectionRef={sectionRef} headingRef={headingRef}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-choice-grid" aria-label="Assignment start options">
            <button
              type="button"
              aria-pressed={showResumePanel}
              className={`minimal-choice-card${showResumePanel ? ' is-selected' : ''}`}
              onClick={onShowResumeChoice}
            >
              <span className="minimal-choice-eyebrow">Resume</span>
              <span className="minimal-choice-title">Resume recent work</span>
            </button>
            <button
              type="button"
              aria-pressed={showStartedSummary}
              className={`minimal-choice-card${showStartedSummary ? ' is-selected' : ''}`}
              onClick={onStartNewAssignment}
            >
              <span className="minimal-choice-eyebrow">New</span>
              <span className="minimal-choice-title">Start new assignment</span>
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
            </div>
          ) : null}

          {showResumePanel ? (
            <div className="minimal-resume-list-block">
              <div className="minimal-stage-panel-header">
                <div className="minimal-stage-panel-title">
                  <h3>Recent assignments</h3>
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
            </div>
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
              </div>
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
  const unexpectedTranscriptCharacters =
    transcriptReady && transcriptText
      ? getTranscriptUnexpectedCharacterWarnings(transcriptText)
      : [];

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
              <h3>Recording</h3>
            </div>
            {!recording ? (
              <button type="button" className="minimal-secondary" onClick={onRefreshStudents}>
                Refresh students
              </button>
            ) : null}
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
              disabled={Boolean(linkedLessonId) || Boolean(recording)}
            >
              <option value="">Select a student</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
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
          {!recording ? (
            <>
              <details className="minimal-details">
                <summary>Recording settings</summary>
                <label className="minimal-select">
                  Transcript engine
                  <select
                    value={selectedSttProvider}
                    onChange={(event) =>
                      onSelectedSttProviderChange(event.target.value as SttProvider)
                    }
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
                  stage.status === 'current' && selectedStudentId
                    ? 'minimal-guided-surface'
                    : undefined
                }
              >
                <DropZone
                  title={uploading ? 'Uploading...' : 'Drop audio file'}
                  hint="Single file upload"
                  accept={{ 'audio/*': [...audioExtensions] }}
                  multiple={false}
                  disabled={uploading || !selectedStudentId}
                  onFiles={onFiles}
                />
              </div>
            </>
          ) : null}
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
              <span>Recording: {recording.displayName || recording.recordingId}</span>
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
              {unexpectedTranscriptCharacters.length > 0 ? (
                <div className="minimal-alert warning" role="note">
                  Transcript contains characters outside expected English/Russian text:{' '}
                  <strong>{unexpectedTranscriptCharacters.join(' ')}</strong>. Check these spots
                  before creating the assignment.
                </div>
              ) : null}
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
      ? 'Next step: review the learner context, add lesson goals here, then create the assignment in the next section.'
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
              <h3>Learner context</h3>
            </div>
          </div>
          {profileRevisionError ? <p className="minimal-error">{profileRevisionError}</p> : null}
          {selectedProfileId && profilePreview ? (
            <div className="minimal-profile-card">
              <div className="minimal-profile-meta-grid">
                <div>
                  <span>Source</span>
                  <strong>Student Learning page</strong>
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
              This student's Learning page context has not been structured yet. Add lesson guidance
              here or update the Learning page before creating the assignment.
            </p>
          ) : null}
          {!selectedProfileId ? (
            <p className="minimal-muted">
              No structured Learning page context is available yet. You can still create the
              assignment, add lesson guidance here, or update the student's Learning page later.
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
          </div>
          <textarea
            aria-label="Teacher notes"
            value={teacherNotes}
            onChange={(event) => onTeacherNotesChange(event.target.value)}
            rows={8}
            placeholder="Add lesson-specific context, corrections, or priorities for this assignment..."
          />
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
  onReloadPromptOptions,
  promptError,
  onSaveDraft,
  validating,
  draftDirty,
  generationOptionsAvailable,
  onGenerateAssignment,
  generatingDraft,
  generationBlockedByQuota,
  generationQuotaBlockedReason,
  generationError,
  generationSuccess,
  draftText,
  onDraftTextChange,
  validation,
  validationError,
  draftError,
}: AssignmentStageSectionProps) {
  const assignmentBusy = promptLoading || generatingDraft;
  const canGenerateAssignment =
    transcriptReady &&
    promptOptionsReady &&
    generationOptionsAvailable &&
    !assignmentBusy &&
    !generationBlockedByQuota;
  const assignmentGuidance =
    stage.status === 'current'
      ? draftText.trim()
        ? 'Next step: preview the assignment, then share it.'
        : 'Next step: generate the assignment or paste your own version here.'
      : stage.status === 'available' && transcriptReady
        ? 'Ready when you are: create the assignment after you finish reviewing the teaching context.'
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
              <h3>Assignment draft</h3>
            </div>
            <div className="minimal-inline">
              <button
                ref={generateDraftButtonRef}
                type="button"
                className={`minimal-primary${
                  stage.status === 'current' && !draftText.trim() ? ' minimal-guided-button' : ''
                }`}
                onClick={onGenerateAssignment}
                disabled={!canGenerateAssignment}
              >
                {assignmentBusy ? 'Generating assignment...' : 'Generate assignment'}
              </button>
              {promptOptionsReady ? null : (
                <button type="button" className="minimal-secondary" onClick={onReloadPromptOptions}>
                  Reload settings
                </button>
              )}
              <button
                type="button"
                className="minimal-secondary"
                onClick={onSaveDraft}
                disabled={!promptReady || validating || !draftText.trim()}
              >
                {validating ? 'Checking...' : 'Save draft'}
              </button>
              {draftDirty ? <span className="minimal-muted">Unsaved changes</span> : null}
            </div>
          </div>
          {!generationOptionsAvailable ? (
            <p className="minimal-muted">
              Assignment setup is still loading. Reload settings if this does not clear.
            </p>
          ) : null}
          {generationBlockedByQuota ? (
            <p className="minimal-error">
              {generationQuotaBlockedReason ??
                'Assignment generation is temporarily unavailable. Try again shortly.'}
            </p>
          ) : null}
          {promptError ? <p className="minimal-error">{promptError}</p> : null}
          {generationError ? <p className="minimal-error">{generationError}</p> : null}
          {generationSuccess ? <p className="minimal-success">{generationSuccess}</p> : null}
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
  onCancelJob,
  canPublishWithPreview,
  cancelEnabled,
  actionBusy,
  publishing,
  previewing,
  onPreviewDraft,
  draftHasContent,
  previewReadyForCurrentDraft,
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
        <>
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
          <button
            type="button"
            className="minimal-secondary"
            onClick={onCancelJob}
            disabled={!cancelEnabled}
          >
            {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel'}
          </button>
        </>
      }
    >
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Preview before you share</h3>
            </div>
            <div className="minimal-inline">
              <button
                ref={previewButtonRef}
                type="button"
                className={`minimal-secondary${
                  !previewReadyForCurrentDraft ? ' minimal-preview-attention' : ''
                }${
                  stage.status === 'current' && !previewReadyForCurrentDraft
                    ? ' minimal-guided-button minimal-guided-button--secondary'
                    : ''
                }`}
                onClick={onPreviewDraft}
                disabled={previewing || !draftHasContent}
              >
                {previewing ? 'Rendering preview...' : 'Preview assignment'}
              </button>
            </div>
          </div>
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
