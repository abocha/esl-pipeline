import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpenText,
  Heart,
  MessageSquareText,
  NotebookText,
  Star,
  Target,
  TrendingUp,
} from 'lucide-react';
import React from 'react';
import type { Accept } from 'react-dropzone';
import { Link, useInRouterContext } from 'react-router-dom';

import {
  type AssignmentMaterial,
  type AssignmentValidationContext,
  emptyAssignmentMaterial,
} from '@esl-pipeline/contracts';

import type {
  AssignmentValidationResponse,
  AudioInputTopology,
  JobStatus,
  RecordingListItem,
  RecordingTranscriptResponse,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import { getRecordingProductLabel } from '../../utils/recording-state';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';
import { ProductButton } from '../system/ProductButton';
import { AssignmentEditor } from './AssignmentEditor';
import { AssignmentMaterialForm } from './AssignmentMaterialForm';
import type { RecentAssignmentItem } from './MinimalAssignment.entry-state';
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

export interface CurrentAssignmentCard {
  title: string;
  statusLabel: string;
  statusTone: 'success' | 'progress' | 'warning' | 'neutral';
  meta: string[];
  supportLabel: string;
}

interface WorkflowOverviewProps {
  currentStepTitle: string;
  stages: WorkflowStage[];
}

interface StageSectionProps {
  stage: WorkflowStage;
  actions?: React.ReactNode;
  eyebrow?: string;
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
  selectedStudentName: string | null;
  onStartNewAssignment: () => void;
  onShowResumeChoice: () => void;
  onResumeSelectedAssignment: () => Promise<void>;
  resumeLoading: boolean;
  selectedResumeJobId: string;
  onSelectedResumeJobIdChange: (value: string) => void;
  resumeJobItems: RecentAssignmentItem[];
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
  sttProviderOverrideActive: boolean;
  selectedAudioTopology: AudioInputTopology;
  onSelectedSttProviderChange: (provider: SttProvider | 'auto') => void;
  onSelectedAudioTopologyChange: (topology: AudioInputTopology) => void;
  sttProviders: readonly SttProvider[];
  formatSttProviderLabel: (provider: SttProvider) => string;
  recordingFileAccept: Accept;
  uploading: boolean;
  replacingAudio: boolean;
  canReplaceAudio: boolean;
  selectedFileName: string | null;
  uploadProgress: number;
  onFiles: (files: File[]) => void;
  onBeginAudioReplacement: () => void;
  onCancelAudioReplacement: () => void;
  onCancelUpload: () => void;
  canRetryUpload: boolean;
  onRetryUpload: () => void;
  uploadError: string | null;
  uploadCacheNotice: string | null;
  recording: RecordingListItem | null;
  transcriptProvider: RecordingTranscriptResponse['sttProvider'] | null;
  recordingError: string | null;
  transcriptStatus: 'idle' | 'loading' | 'processing' | 'ready' | 'failed';
  transcriptError: string | null;
  transcriptReady: boolean;
  transcriptText: string;
  onTranscriptTextChange: (value: string) => void;
  transcriptDirty: boolean;
  transcriptSaving: boolean;
  mixedSpeakerRoles: { speaker: number; role: 'teacher' | 'student' | '' }[];
  onMixedSpeakerRoleChange: (speaker: number, role: 'teacher' | 'student' | '') => void;
  hideStudentSelection?: boolean;
  homeworkChoice?: React.ReactNode;
  readOnly?: boolean;
}

interface ContextStageSectionProps {
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  studentId: string;
  studentName: string | null;
  selectedProfileId: string;
  profilePreview: {
    studentId: string;
    overallLevel: string | null;
    primaryGoals: string[];
    communicationContexts: string[];
    stableStrengths: string[];
    persistentChallenges: string[];
    studyPreferences: string[];

    interests?: string[];

    durableConstraints?: string[];

    goalsAndContexts: string[];
    strengthsAndChallenges: string[];
    teacherNoteSnippet: string | null;
    updatedAt: string | null;
  } | null;
  profileRevisionError: string | null;
  learnerContext: import('../../utils/api').AssignmentLearnerContext | null;

  material?: AssignmentMaterial;

  onMaterialChange?: (value: AssignmentMaterial) => void;

  sessionId?: string | null;

  active?: boolean;

  materialAttempted?: boolean;

  materialFetchEpoch?: number;

  onRetryContext?: () => void;

  teacherNotes: string;
  onTeacherNotesChange: (value: string) => void;
  readOnly?: boolean;
}

interface ProfileDossierSection {
  id: string;
  title: string;
  icon: LucideIcon;
  items?: string[];
  body?: string | null;
  badge?: string | null;
}

function compactDossierItems(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function getProfileInitials(name: string | null): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return 'LP';
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

function buildCurrentProfileDossierSections(
  profilePreview: NonNullable<ContextStageSectionProps['profilePreview']>,
): ProfileDossierSection[] {
  return [
    {
      id: 'level',
      title: 'Level',
      icon: BarChart3,
      body: profilePreview.overallLevel ? 'Current profile level' : 'Not set yet',
      badge: profilePreview.overallLevel ?? 'Not set',
    },
    {
      id: 'goals',
      title: 'Goals',
      icon: Target,
      items: compactDossierItems(profilePreview.primaryGoals),
    },
    {
      id: 'communication-contexts',
      title: 'Communication contexts',
      icon: MessageSquareText,
      items: compactDossierItems(profilePreview.communicationContexts),
    },
    {
      id: 'strengths',
      title: 'Strengths',
      icon: Star,
      items: compactDossierItems(profilePreview.stableStrengths),
    },
    {
      id: 'challenges',
      title: 'Challenges',
      icon: TrendingUp,
      items: compactDossierItems(profilePreview.persistentChallenges),
    },
    {
      id: 'study-preferences',
      title: 'Study preferences',
      icon: BookOpenText,
      items: compactDossierItems(profilePreview.studyPreferences),
    },

    {
      id: 'interests',
      title: 'Interests',
      icon: Heart,
      items: compactDossierItems(profilePreview.interests ?? []),
    },

    {
      id: 'constraints',
      title: 'Durable constraints',
      icon: BookOpenText,
      items: compactDossierItems(profilePreview.durableConstraints ?? []),
    },

    {
      id: 'teacher-note',
      title: 'Teacher note',
      icon: NotebookText,
      body: profilePreview.teacherNoteSnippet,
    },
  ];
}

interface AssignmentStageSectionProps {
  onEditorContinue?: () => void;
  editorContinueDisabled?: boolean;
  editorSessionKey?: number;
  editorValidationContext?: AssignmentValidationContext;
  savingDraft?: boolean;
  draftConflict?: boolean;
  savedDraftText?: string;
  onRetrySave?: () => void;
  onReconcileDraft?: (choice: 'local' | 'saved') => void;
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  generateDraftButtonRef?: React.Ref<HTMLButtonElement>;
  transcriptReady: boolean;
  promptLoading: boolean;
  promptOptionsReady: boolean;
  promptError: string | null;
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
  validation: AssignmentValidationResponse | null;
  validationError: string | null;
  draftError: string | null;
  structuredDraft?: boolean;
  readOnly?: boolean;
  allowGenerate?: boolean;
}

interface ReviewStageSectionProps {
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  previewButtonRef?: React.Ref<HTMLButtonElement>;
  onPublish: () => void;
  shareAvailable: boolean;
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
  jobActionFeedback?: string | null;
  currentJobStatus: JobStatus | null;
  jobFailureReason: string | null;
  jobReady: boolean;
  publishUrl: string | null | undefined;
  completedReferenceMode?: boolean;
  historicalReadOnly?: boolean;
  correctionAvailable?: boolean;
  publicationRecoveryAvailable?: boolean;
  correctionMode?: boolean;
  correctionPublishing?: boolean;
  correctionError?: string | null;
  correctionCanPublish?: boolean;
  savedUnpublishedChanges?: boolean;
  onCopyPublishedUrl?: (url: string) => void;
  onEnterCorrection?: () => void;
  onRetryPublication?: () => void;
  onExitCorrection?: () => void;
  onPublishCorrection?: () => void;
}

function formatWorkflowStageStatusLabel(status: WorkflowStageStatus): string {
  if (status === 'complete') return 'Done';
  if (status === 'current') return 'Now';
  if (status === 'available') return 'Available';
  return 'Locked';
}

export function WorkflowOverview({ currentStepTitle, stages }: WorkflowOverviewProps) {
  return (
    <section className="minimal-overview" aria-labelledby="assignment-builder-title">
      <div className="minimal-overview-header">
        <div className="minimal-overview-copy">
          <h1 id="assignment-builder-title">Build and share a lesson assignment</h1>
        </div>
        <div className="minimal-stage-state is-current">Current focus: {currentStepTitle}</div>
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
  eyebrow,
  sectionRef,
  headingRef,
  guidance,
  children,
}: StageSectionProps) {
  const isLocked = stage.status === 'locked';
  const showStageChrome = stage.id === 'start' || stage.id === 'advanced';
  const stageActions = isLocked ? null : actions;
  const stageGuidance = isLocked ? null : guidance;
  const stageContent = isLocked ? null : children;

  return (
    <section ref={sectionRef} className={`minimal-section minimal-stage-card is-${stage.status}`}>
      <div className="minimal-stage-header">
        <div className="minimal-stage-header-copy">
          {eyebrow ? <p className="minimal-stage-eyebrow">{eyebrow}</p> : null}
          <h2 ref={headingRef} tabIndex={-1}>
            {stage.title}
          </h2>
          {showStageChrome && stage.description ? <p>{stage.description}</p> : null}
        </div>
        <div className="minimal-stage-header-actions">
          {showStageChrome ? (
            <span className={`minimal-stage-state is-${stage.status}`}>
              {formatWorkflowStageStatusLabel(stage.status)}
            </span>
          ) : null}
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
  selectedStudentName,
  onStartNewAssignment,
  onShowResumeChoice,
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
  const [isChangingSetup, setIsChangingSetup] = React.useState(false);
  const setupResolved = mode === 'start' || (mode === 'resume' && Boolean(currentAssignmentCard));
  const showSetupChoices = mode === 'idle' || isChangingSetup || !setupResolved;
  const setupTitle = mode === 'resume' ? 'Resumed assignment' : 'New assignment';
  const setupDescription =
    mode === 'start' && selectedStudentName
      ? `Starting a new assignment for ${selectedStudentName}.`
      : mode === 'start'
        ? 'Starting a new assignment.'
        : 'Continuing saved assignment work.';
  const displayedStage = showSetupChoices
    ? stage
    : { ...stage, title: setupTitle, description: setupDescription };

  React.useEffect(() => {
    if (resumeError && mode === 'resume') {
      setIsChangingSetup(true);
    }
  }, [mode, resumeError]);

  const handleStartNewAssignment = () => {
    onStartNewAssignment();
    setIsChangingSetup(false);
  };

  const handleShowResumeChoice = () => {
    setIsChangingSetup(true);
    onShowResumeChoice();
  };

  const handleResumeSelectedAssignment = async () => {
    await onResumeSelectedAssignment();
    setIsChangingSetup(false);
  };

  return (
    <StageSection
      stage={displayedStage}
      actions={
        showSetupChoices ? null : (
          <button
            type="button"
            className="product-button product-button--quiet"
            onClick={() => setIsChangingSetup(true)}
          >
            Change assignment setup
          </button>
        )
      }
      eyebrow={showSetupChoices ? undefined : 'Assignment setup'}
      sectionRef={sectionRef}
      headingRef={headingRef}
    >
      <div className="minimal-stage-layout">
        {showSetupChoices ? (
          <div className="minimal-stage-panel">
            <div className="minimal-choice-grid" aria-label="Assignment start options">
              <button
                type="button"
                aria-pressed={showResumePanel}
                className={`minimal-choice-card${showResumePanel ? ' is-selected' : ''}`}
                onClick={handleShowResumeChoice}
              >
                <span className="minimal-choice-eyebrow">Resume</span>
                <span className="minimal-choice-title">Resume recent work</span>
              </button>
              <button
                type="button"
                aria-pressed={mode === 'start'}
                className={`minimal-choice-card${mode === 'start' ? ' is-selected' : ''}`}
                onClick={handleStartNewAssignment}
              >
                <span className="minimal-choice-eyebrow">New</span>
                <span className="minimal-choice-title">Start new assignment</span>
              </button>
            </div>

            {showResumePanel ? (
              <div className="minimal-resume-list-block">
                <div className="minimal-stage-panel-header">
                  <div className="minimal-stage-panel-title">
                    <h3>Recent assignments</h3>
                  </div>
                  <div className="minimal-inline">
                    <button
                      type="button"
                      className="minimal-primary minimal-guided-button"
                      onClick={() => void handleResumeSelectedAssignment()}
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
                          key={job.id}
                          type="button"
                          role="option"
                          aria-selected={job.selected}
                          className={`minimal-resume-card minimal-resume-card--${job.statusTone}${
                            job.selected ? ' minimal-resume-card--selected' : ''
                          }`}
                          onClick={() => onSelectedResumeJobIdChange(job.id)}
                        >
                          <span className="minimal-resume-card-leading" aria-hidden="true" />
                          <span className="minimal-resume-card-main">
                            <span className="minimal-resume-card-head">
                              <span className="minimal-resume-card-title">{job.learnerName}</span>
                              <span
                                className={`minimal-status-pill minimal-status-pill--${job.statusTone}`}
                              >
                                {job.statusLabel}
                              </span>
                            </span>
                            <span className="minimal-resume-card-subtitle">
                              {job.activityLabel}
                            </span>
                            <span className="minimal-resume-card-meta">
                              <span>{job.timeLabel}</span>
                              <span>{job.outcomeLabel}</span>
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
        ) : null}

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
  sttProviderOverrideActive,
  selectedAudioTopology,
  onSelectedSttProviderChange,
  onSelectedAudioTopologyChange,
  sttProviders,
  formatSttProviderLabel,
  recordingFileAccept,
  uploading,
  replacingAudio,
  canReplaceAudio,
  selectedFileName,
  uploadProgress,
  onFiles,
  onBeginAudioReplacement,
  onCancelAudioReplacement,
  onCancelUpload,
  canRetryUpload,
  onRetryUpload,
  uploadError,
  uploadCacheNotice,
  recording,
  transcriptProvider,
  recordingError,
  transcriptStatus,
  transcriptError,
  transcriptReady,
  transcriptText,
  onTranscriptTextChange,
  transcriptDirty,
  transcriptSaving,
  mixedSpeakerRoles,
  onMixedSpeakerRoleChange,
  hideStudentSelection = false,
  homeworkChoice,
  readOnly = false,
}: SourceStageSectionProps) {
  const recordingProductLabel = getRecordingProductLabel(recording, uploading, uploadProgress);
  const ordinaryTwoSpeakerMapping =
    mixedSpeakerRoles.length === 2 &&
    mixedSpeakerRoles[0]?.speaker !== mixedSpeakerRoles[1]?.speaker;
  const unexpectedTranscriptCharacters =
    transcriptReady && transcriptText
      ? getTranscriptUnexpectedCharacterWarnings(transcriptText)
      : [];

  return (
    <StageSection stage={stage} sectionRef={sectionRef} headingRef={headingRef}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Recording</h3>
            </div>
          </div>
          {!hideStudentSelection ? (
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
                disabled={readOnly || Boolean(linkedLessonId) || Boolean(recording)}
              >
                <option value="">Select a student</option>
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
                    disabled={readOnly}
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
          {!hideStudentSelection && studentOptionsError ? (
            <p className="minimal-error">{studentOptionsError}</p>
          ) : null}
          {!recording ? (
            <details className="minimal-details">
              <summary>Recording settings</summary>
              <label className="minimal-select">
                Audio source
                <select
                  value={selectedAudioTopology}
                  onChange={(event) =>
                    onSelectedAudioTopologyChange(event.target.value as AudioInputTopology)
                  }
                  disabled={readOnly}
                >
                  <option value="mixed_recording">Ordinary recording</option>
                  <option value="trusted_split_channels">
                    Trusted OBS split: channel 1 tutor, channel 2 student
                  </option>
                </select>
              </label>
              <label className="minimal-select">
                Transcript engine
                <select
                  value={sttProviderOverrideActive ? selectedSttProvider : 'auto'}
                  onChange={(event) =>
                    onSelectedSttProviderChange(event.target.value as SttProvider | 'auto')
                  }
                  disabled={readOnly || sttProviders.length === 0}
                >
                  <option value="auto">Automatic (recommended)</option>
                  {sttProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {formatSttProviderLabel(provider)}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          ) : null}
          {!recording || replacingAudio ? (
            <div className="minimal-block">
              <div
                className={
                  stage.status === 'current' && selectedStudentId
                    ? 'minimal-guided-surface'
                    : undefined
                }
              >
                <DropZone
                  title={
                    uploading
                      ? 'Uploading...'
                      : replacingAudio
                        ? 'Drop replacement audio'
                        : 'Drop audio file'
                  }
                  hint="Single supported recording file"
                  accept={recordingFileAccept}
                  multiple={false}
                  disabled={readOnly || uploading || !selectedStudentId}
                  onFiles={onFiles}
                />
              </div>
              {replacingAudio ? (
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onCancelAudioReplacement}
                  disabled={readOnly || uploading}
                >
                  Cancel replacement
                </button>
              ) : null}
            </div>
          ) : null}
          {uploading ? (
            <UploadProgress
              fileName={selectedFileName}
              progress={uploadProgress}
              onCancel={onCancelUpload}
            />
          ) : null}
          {recordingProductLabel ? (
            <p className="minimal-help" role="status" aria-live="polite">
              {recordingProductLabel}
            </p>
          ) : null}
          {uploadError ? <p className="minimal-error">{uploadError}</p> : null}
          {canRetryUpload && !uploading ? (
            <button type="button" className="minimal-secondary" onClick={onRetryUpload}>
              Retry upload
            </button>
          ) : null}
          {uploadCacheNotice ? <p className="minimal-success">{uploadCacheNotice}</p> : null}
          {recording ? (
            <div className="minimal-block">
              <div className="minimal-meta">
                <span>Recording: {recording.displayName || recording.recordingId}</span>
                <span>Status: {recordingProductLabel ?? 'Checking recording'}</span>
                {selectedStudent ? <span>Student: {selectedStudent.name}</span> : null}
              </div>
              {canReplaceAudio && !replacingAudio && !readOnly ? (
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={onBeginAudioReplacement}
                >
                  Replace audio
                </button>
              ) : null}
              <details className="minimal-details">
                <summary>Recording details</summary>
                <div className="minimal-meta">
                  <span>
                    Audio source:{' '}
                    {selectedAudioTopology === 'trusted_split_channels'
                      ? 'Trusted OBS split'
                      : 'Ordinary recording'}
                  </span>
                  <span>
                    Transcript engine:{' '}
                    {transcriptProvider === 'manual'
                      ? 'Manual transcript'
                      : transcriptProvider
                        ? formatSttProviderLabel(transcriptProvider)
                        : 'Processing'}
                  </span>
                </div>
              </details>
            </div>
          ) : null}
          {recordingError ? <p className="minimal-error">{recordingError}</p> : null}
        </div>

        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>Transcript</h3>
            </div>
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
              {mixedSpeakerRoles.length > 0 ? (
                <div className="minimal-block">
                  {ordinaryTwoSpeakerMapping ? (
                    <fieldset className="minimal-speaker-choice">
                      <legend>Which one of these is the tutor?</legend>
                      <div className="minimal-speaker-choice-options">
                        {mixedSpeakerRoles.map((item) => (
                          <label
                            className={`minimal-speaker-choice-option${
                              item.role === 'teacher' ? ' is-selected' : ''
                            }`}
                            key={item.speaker}
                          >
                            <input
                              type="radio"
                              name="tutor-speaker"
                              checked={item.role === 'teacher'}
                              onChange={() => {
                                for (const candidate of mixedSpeakerRoles) {
                                  onMixedSpeakerRoleChange(
                                    candidate.speaker,
                                    candidate.speaker === item.speaker ? 'teacher' : 'student',
                                  );
                                }
                              }}
                              disabled={readOnly || transcriptSaving}
                            />
                            <span>Speaker {item.speaker + 1}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <>
                      <p className="minimal-help">
                        Assign every anonymous speaker before confirming this source.
                      </p>
                      {mixedSpeakerRoles.map((item) => (
                        <label className="minimal-select" key={item.speaker}>
                          Speaker {item.speaker + 1}
                          <select
                            value={item.role}
                            onChange={(event) =>
                              onMixedSpeakerRoleChange(
                                item.speaker,
                                event.target.value as 'teacher' | 'student' | '',
                              )
                            }
                            disabled={readOnly || transcriptSaving}
                          >
                            <option value="">Choose role</option>
                            <option value="teacher">Teacher</option>
                            <option value="student">Student</option>
                          </select>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
              <textarea
                aria-label="Transcript text"
                value={transcriptText}
                onChange={(event) => onTranscriptTextChange(event.target.value)}
                readOnly={readOnly}
                rows={10}
              />
              <div className="minimal-inline" role="status" aria-live="polite">
                <span className="minimal-muted">
                  {transcriptSaving
                    ? 'Saving transcript changes…'
                    : transcriptDirty
                      ? 'Transcript changes waiting to save'
                      : 'Transcript changes saved'}
                </span>
              </div>
              {transcriptError ? <p className="minimal-error">{transcriptError}</p> : null}
              {homeworkChoice}
            </div>
          ) : null}
        </div>
      </div>
    </StageSection>
  );
}

function LearnerContextSection({ section }: { section: ProfileDossierSection }) {
  const contentId = React.useId();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [textOverflows, setTextOverflows] = React.useState(false);
  const items = section.items ?? [];

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || expanded || (!section.items?.length && !section.body)) return;
    // Measure the actual two-line preview, including a single very long item.
    // ResizeObserver also catches wrapping changes and sections opened inside details.
    const measure = () => {
      if (!content.isConnected) return;
      setTextOverflows(
        Array.from(content.querySelectorAll('.assignment-learner-preview')).some(
          (item) => item.scrollHeight > item.clientHeight + 1,
        ),
      );
    };
    measure();
    // A webfont can change clipping while the clamped box stays two lines high.
    document.fonts?.ready.then(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [expanded, section.items, section.body]);

  const canExpand = expanded || items.length > 2 || textOverflows;
  const label = section.title.toLowerCase();
  return (
    <section className="assignment-learner-section">
      <h4>
        <section.icon aria-hidden="true" />
        {section.title}
      </h4>
      <div id={contentId} ref={contentRef}>
        {items.length ? (
          <ul>
            {(expanded ? items : items.slice(0, 2)).map((item, index) => (
              <li key={`${index}-${item}`}>
                <span className={expanded ? undefined : 'assignment-learner-preview'}>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={expanded ? undefined : 'assignment-learner-preview'}>{section.body}</p>
        )}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="minimal-secondary assignment-learner-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? `Show less ${label}` : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : `Show all ${label}${items.length ? ` (${items.length})` : ''}`}
        </button>
      ) : null}
    </section>
  );
}

export function ContextStageSection({
  stage,
  sectionRef,
  headingRef,
  studentId,
  studentName,
  profilePreview,
  profileRevisionError,
  learnerContext,
  teacherNotes,
  onTeacherNotesChange,

  material = emptyAssignmentMaterial(),
  onMaterialChange = () => {},
  sessionId = null,

  active = true,
  materialAttempted = false,
  materialFetchEpoch = 0,
  onRetryContext,
  readOnly = false,
}: ContextStageSectionProps) {
  const isInRouterContext = useInRouterContext();

  const sections = profilePreview
    ? buildCurrentProfileDossierSections(profilePreview).filter(
        (section) => section.items?.length || section.body,
      )
    : [];

  const additional = sections.filter((section) =>
    [
      'communication-contexts',
      'strengths',
      'study-preferences',
      'constraints',
      'teacher-note',
    ].includes(section.id),
  );

  const renderSection = (section: ProfileDossierSection) => (
    <LearnerContextSection section={section} key={section.id} />
  );

  const path = `/students/${encodeURIComponent(studentId)}/learning`;

  return (
    <StageSection
      stage={{ ...stage, title: 'Material & guidance', description: '' }}
      sectionRef={sectionRef}
      headingRef={headingRef}
    >
      <div className="assignment-context-layout">
        <div className="assignment-context-main">
          <AssignmentMaterialForm
            material={material}
            onChange={onMaterialChange}
            sessionId={sessionId}
            active={active}
            attempted={materialAttempted}
            fetchEpoch={materialFetchEpoch}
            readOnly={readOnly}
          />

          <div className="assignment-guidance-label">
            <label htmlFor="assignment-lesson-guidance">Lesson guidance</label>
            <span className="minimal-muted">Optional · This assignment only</span>
          </div>
          <textarea
            id="assignment-lesson-guidance"
            value={teacherNotes}
            onChange={(event) => onTeacherNotesChange(event.target.value)}
            readOnly={readOnly}
            rows={3}
          />
        </div>

        <aside className="assignment-learner-context" aria-label="Learner context">
          <h3>Learner context</h3>

          <div className="assignment-learner-identity">
            <span className="minimal-profile-dossier-avatar" aria-hidden="true">
              {getProfileInitials(studentName)}
            </span>
            <strong>
              {studentName || 'Learner'}
              {profilePreview?.overallLevel ? ` · ${profilePreview.overallLevel}` : ''}
            </strong>
          </div>

          {profileRevisionError ? (
            <div role="alert">
              <p className="minimal-error">{profileRevisionError}</p>
              {onRetryContext ? (
                <button type="button" className="minimal-secondary" onClick={onRetryContext}>
                  Retry learner context
                </button>
              ) : null}
            </div>
          ) : !learnerContext ? (
            <p role="status" className="minimal-muted">
              Loading learner context…
            </p>
          ) : !profilePreview && learnerContext.state !== 'preparing' ? (
            <p className="minimal-muted">No structured Learning page context is available yet.</p>
          ) : null}

          {learnerContext?.state === 'preparing' ? (
            <p className="minimal-muted" role="status">
              Preparing learner context from this lesson…
            </p>
          ) : null}

          {learnerContext?.state === 'completed' ? (
            <p className="minimal-success" role="status">
              Learner context updated from this lesson.
            </p>
          ) : null}

          {learnerContext?.state === 'failed' ? (
            <p className="minimal-error" role="status">
              Learner context could not be prepared from this lesson. You can continue with the
              available context.
            </p>
          ) : null}

          {!profileRevisionError &&
          learnerContext &&
          profilePreview &&
          sections.some((section) => section.id !== 'level') ? (
            <div
              key={`${studentId}:${sessionId ?? learnerContext.assignmentSessionId}`}
              className="assignment-learner-reading-area"
              role="region"
              aria-label="Learner profile details"
              tabIndex={0}
            >
              {sections
                .filter((section) => ['goals', 'challenges', 'interests'].includes(section.id))
                .map(renderSection)}
              {additional.length ? (
                <details className="minimal-details">
                  <summary>More learner context</summary>
                  {additional.map(renderSection)}
                </details>
              ) : null}
            </div>
          ) : null}

          {studentId ? (
            isInRouterContext ? (
              <Link to={path}>Edit in Learning</Link>
            ) : (
              <a href={path}>Edit in Learning</a>
            )
          ) : null}
        </aside>
      </div>
    </StageSection>
  );
}

export function AssignmentStageSection({
  onEditorContinue,
  editorContinueDisabled,
  editorSessionKey,
  editorValidationContext,
  savingDraft = false,
  draftConflict = false,
  savedDraftText,
  onRetrySave,
  onReconcileDraft,
  stage,
  sectionRef,
  headingRef,
  generateDraftButtonRef,
  transcriptReady,
  promptLoading,
  promptOptionsReady,
  promptError,
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
  structuredDraft,
  readOnly = false,
  allowGenerate = true,
}: AssignmentStageSectionProps) {
  const assignmentBusy = promptLoading || generatingDraft;
  const hasDraft = draftText.trim().length > 0;
  const canGenerateAssignment =
    transcriptReady &&
    promptOptionsReady &&
    generationOptionsAvailable &&
    !assignmentBusy &&
    !savingDraft &&
    !draftConflict &&
    !generationBlockedByQuota;
  const regenerateAction =
    !readOnly && allowGenerate && hasDraft ? (
      <button
        ref={generateDraftButtonRef}
        type="button"
        className="minimal-secondary"
        onClick={() => {
          if (
            globalThis.confirm(
              'Replace this assignment with a newly generated assignment? Local edits and undo history will be replaced.',
            )
          )
            onGenerateAssignment();
        }}
        disabled={!canGenerateAssignment}
      >
        {assignmentBusy ? '✨ Generating assignment…' : 'Regenerate'}
      </button>
    ) : null;
  return (
    <StageSection stage={stage} sectionRef={sectionRef} headingRef={headingRef}>
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div
            className={`minimal-stage-panel-header${structuredDraft && hasDraft ? ' assignment-editor-legacy-header' : ''}`}
          >
            <div className="minimal-stage-panel-title">
              <h3>Assignment draft</h3>
            </div>
            <div className="minimal-inline">
              {!structuredDraft && regenerateAction}
              {!structuredDraft && (
                <span
                  className="minimal-muted assignment-draft-save-status"
                  role="status"
                  aria-live="polite"
                >
                  {readOnly
                    ? 'Current saved draft (reference only)'
                    : validating
                      ? 'Checking draft…'
                      : draftDirty
                        ? 'Draft changes waiting to save'
                        : 'Draft changes saved'}
                </span>
              )}
            </div>
          </div>
          {!generationOptionsAvailable ? (
            <p className="minimal-muted">
              Assignment setup is still loading. It will refresh automatically.
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
          {generationSuccess && hasDraft ? (
            <p className="minimal-success">{generationSuccess}</p>
          ) : null}
          {!readOnly && allowGenerate && !hasDraft ? (
            <div className="minimal-empty-draft-action">
              <button
                ref={generateDraftButtonRef}
                type="button"
                className="minimal-primary"
                onClick={onGenerateAssignment}
                disabled={!canGenerateAssignment}
                aria-busy={assignmentBusy || undefined}
                aria-label={assignmentBusy ? 'Generating assignment' : 'Generate assignment'}
              >
                {assignmentBusy ? '✨ Generating assignment…' : '✨ Generate assignment'}
              </button>
            </div>
          ) : null}
          {structuredDraft ? (
            <>
              {draftConflict && (
                <div className="minimal-alert" role="alert">
                  <strong>Newer saved work found. Your local edits are retained below.</strong>
                  <details>
                    <summary>Inspect saved version</summary>
                    <AssignmentEditor
                      text={savedDraftText ?? ''}
                      onChange={() => {}}
                      readOnly
                      validationContext={editorValidationContext}
                      saveStatus="Server version"
                    />
                  </details>
                  <div className="minimal-inline">
                    <button
                      type="button"
                      onClick={() => onReconcileDraft?.('local')}
                      disabled={savingDraft}
                    >
                      Save my local version
                    </button>
                    <button
                      type="button"
                      onClick={() => onReconcileDraft?.('saved')}
                      disabled={savingDraft}
                    >
                      Use saved version
                    </button>
                  </div>
                </div>
              )}
              <AssignmentEditor
                key={editorSessionKey}
                toolbarActions={regenerateAction}
                onContinue={onEditorContinue}
                continueDisabled={editorContinueDisabled}
                text={draftText}
                onChange={onDraftTextChange}
                validationContext={editorValidationContext}
                readOnly={readOnly}
                disabled={assignmentBusy}
                saveStatus={
                  readOnly
                    ? 'Saved reference'
                    : draftConflict
                      ? 'Conflict · local edits not saved'
                      : savingDraft
                        ? 'Saving…'
                        : draftDirty
                          ? draftError
                            ? 'Changes not saved · retry available'
                            : 'Changes not saved yet'
                          : 'All changes saved'
                }
              />
              {draftDirty && draftError && !draftConflict && onRetrySave && (
                <button
                  type="button"
                  onClick={onRetrySave}
                  disabled={savingDraft || assignmentBusy}
                >
                  Retry save
                </button>
              )}
            </>
          ) : hasDraft ? (
            <p className="minimal-muted">Historical assignments are read-only.</p>
          ) : null}
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
          {draftDirty && draftError ? <p className="minimal-error">{draftError}</p> : null}
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
  shareAvailable,
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
  jobActionFeedback,
  currentJobStatus,
  jobFailureReason,
  jobReady,
  publishUrl,
  completedReferenceMode = false,
  historicalReadOnly = false,
  correctionAvailable = false,
  publicationRecoveryAvailable = false,
  correctionMode = false,
  correctionPublishing = false,
  correctionError = null,
  correctionCanPublish = false,
  savedUnpublishedChanges = false,
  onEnterCorrection,
  onRetryPublication,
  onExitCorrection,
  onPublishCorrection,
  onCopyPublishedUrl,
}: ReviewStageSectionProps) {
  const jobState = currentJobStatus?.state ?? null;
  const hasPublishedArtifact = jobState === 'succeeded' && Boolean(publishUrl?.trim());
  const isPublishing = jobState === 'queued' || jobState === 'running';
  const publicationNeedsAttention = jobState === 'succeeded' && !hasPublishedArtifact;

  return (
    <StageSection
      stage={stage}
      sectionRef={sectionRef}
      headingRef={headingRef}
      actions={
        <>
          {completedReferenceMode && !correctionMode && correctionAvailable ? (
            <button
              type="button"
              className="minimal-secondary"
              onClick={onEnterCorrection}
              disabled={!onEnterCorrection}
            >
              Correct published assignment
            </button>
          ) : null}
          {completedReferenceMode && !correctionMode && publicationRecoveryAvailable ? (
            <button
              type="button"
              className="minimal-primary"
              onClick={onRetryPublication}
              disabled={!onRetryPublication || publishing}
            >
              {publishing ? 'Retrying publication...' : 'Retry publication'}
            </button>
          ) : null}
          {correctionMode ? (
            <>
              <button
                type="button"
                className="minimal-primary"
                onClick={onPublishCorrection}
                disabled={!correctionCanPublish}
              >
                {correctionPublishing
                  ? 'Publishing corrected version...'
                  : 'Publish corrected version'}
              </button>
              <button type="button" className="minimal-secondary" onClick={onExitCorrection}>
                Exit correction mode
              </button>
            </>
          ) : null}
          {shareAvailable && !completedReferenceMode && !jobReady ? (
            <button
              type="button"
              className={`${previewReadyForCurrentDraft ? 'minimal-primary' : 'minimal-secondary'}${
                stage.status === 'current' && previewReadyForCurrentDraft
                  ? ' minimal-guided-button'
                  : ''
              }`}
              onClick={onPublish}
              disabled={!canPublishWithPreview || publishing}
            >
              {publishing ? 'Sharing...' : 'Share assignment'}
            </button>
          ) : null}
          {isPublishing ? (
            <ProductButton
              type="button"
              variant="secondary"
              onClick={onCancelJob}
              disabled={!cancelEnabled}
              busy={actionBusy === 'cancel'}
            >
              {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </ProductButton>
          ) : null}
        </>
      }
    >
      {historicalReadOnly ? (
        <p>
          Read-only historical record. Original sources and already-produced outputs remain
          available; processing is unsupported.
        </p>
      ) : null}
      <div className="minimal-stage-layout">
        <div className="minimal-stage-panel">
          <div className="minimal-stage-panel-header">
            <div className="minimal-stage-panel-title">
              <h3>{historicalReadOnly ? 'Historical assignment' : 'Preview before you share'}</h3>
            </div>
            <div className="minimal-inline">
              <button
                ref={previewButtonRef}
                type="button"
                className={`${previewReadyForCurrentDraft || completedReferenceMode || jobReady ? 'minimal-secondary' : 'minimal-primary'}${
                  !previewReadyForCurrentDraft && !completedReferenceMode && !jobReady
                    ? ' minimal-preview-attention'
                    : ''
                }${
                  stage.status === 'current' && !previewReadyForCurrentDraft
                    ? ' minimal-guided-button minimal-guided-button--secondary'
                    : ''
                }`}
                onClick={onPreviewDraft}
                disabled={historicalReadOnly || previewing || !draftHasContent}
              >
                {previewing
                  ? 'Rendering preview…'
                  : previewReadyForCurrentDraft
                    ? 'Refresh preview'
                    : 'Preview assignment'}
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
          {jobActionFeedback ? (
            <p className="minimal-success" role="status">
              {jobActionFeedback}
            </p>
          ) : null}
          {correctionError ? <p className="minimal-error">{correctionError}</p> : null}
          {savedUnpublishedChanges ? (
            <p className="minimal-success" role="status">
              Unpublished changes saved
            </p>
          ) : null}
          {jobFailureReason ? <p className="minimal-error">{jobFailureReason}</p> : null}
          {isPublishing ? (
            <p className="minimal-help" role="status">
              Publishing assignment… Your preview remains available while the handout is prepared.
            </p>
          ) : null}
          {publicationNeedsAttention ? (
            <p className="minimal-error" role="alert">
              Publication completed but the shared handout link is unavailable. Contact support.
            </p>
          ) : null}
          {hasPublishedArtifact && publishUrl ? (
            <div className="minimal-publication-success">
              <p>Published and ready for your student.</p>
              <a
                className="minimal-primary minimal-link-button"
                href={publishUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open shared assignment
              </a>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => onCopyPublishedUrl?.(publishUrl)}
              >
                Copy link
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </StageSection>
  );
}
