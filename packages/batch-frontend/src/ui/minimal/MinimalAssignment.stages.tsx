import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpenText,
  CheckCircle2,
  Database,
  GraduationCap,
  MessageSquareText,
  NotebookText,
  RefreshCw,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import React from 'react';
import { Link, useInRouterContext } from 'react-router-dom';

import type {
  JobStatus,
  MarkdownValidationResponse,
  RecordingListItem,
  RecordingStatus,
  SttProvider,
  StudentOption,
} from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';
import { ProductButton } from '../system/ProductButton';
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
  currentStageTitle: string;
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
  onRefreshRecentWork: () => void;
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
  hideStudentSelection?: boolean;
}

interface ContextStageSectionProps {
  stage: WorkflowStage;
  sectionRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  studentId: string;
  studentName: string | null;
  selectedProfileId: string;
  profilePreview: {
    profileId: string;
    overallLevel: string | null;
    primaryGoals: string[];
    communicationContexts: string[];
    stableStrengths: string[];
    persistentChallenges: string[];
    studyPreferences: string[];
    goalsAndContexts: string[];
    strengthsAndChallenges: string[];
    teacherNoteSnippet: string | null;
    updatedAt: string | null;
  } | null;
  profileRevisionError: string | null;
  firstProfileAssist: FirstProfileAssistProps;
  teacherNotes: string;
  onTeacherNotesChange: (value: string) => void;
}

interface FirstProfileAssistProps {
  visible: boolean;
  confirmationState: 'unconfirmed' | 'edited' | 'confirmed';
  confirmDisabled: boolean;
  lessonMemoryStatus: 'checking' | 'building' | 'ready';
  draftProfileId: string | null;
  draftRevisionId: string | null;
  draftPreview: FirstProfileDraftPreview | null;
  busy: 'confirming' | 'drafting' | 'approving' | null;
  approved: boolean;
  error: string | null;
  onConfirm: () => void;
  onChangeStudent: () => void;
  onReplaceAudio: () => void;
  onPopulate: () => void;
  onApprove: () => void;
  onRefresh: () => void;
}

interface FirstProfileDraftPreview {
  overallLevel: string | null;
  primaryGoals: string[];
  communicationContexts: string[];
  stableStrengths: string[];
  persistentChallenges: string[];
  studyPreferences: string[];
  teacherNotes: string | null;
}

interface ProfileDossierSection {
  id: string;
  title: string;
  icon: LucideIcon;
  items?: string[];
  body?: string | null;
  badge?: string | null;
}

interface ProfileDossierProvenanceItem {
  icon: LucideIcon;
  label: string;
}

interface ProfileDossierProps {
  title: string;
  description: string;
  statusLabel: string;
  studentName: string | null;
  studentDetail: string;
  sections: ProfileDossierSection[];
  provenance?: ProfileDossierProvenanceItem[];
  actions?: React.ReactNode;
}

function compactDossierItems(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function formatDossierDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
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
      id: 'teacher-note',
      title: 'Teacher note',
      icon: NotebookText,
      body: profilePreview.teacherNoteSnippet,
    },
  ];
}

function buildDraftProfileDossierSections(
  draft: FirstProfileDraftPreview,
): ProfileDossierSection[] {
  return [
    {
      id: 'level',
      title: 'Level',
      icon: BarChart3,
      body: draft.overallLevel ? 'Estimated from the first lesson memory.' : 'Not set yet',
      badge: draft.overallLevel ?? 'Not set',
    },
    {
      id: 'goals',
      title: 'Goals',
      icon: Target,
      items: compactDossierItems(draft.primaryGoals),
    },
    {
      id: 'communication-contexts',
      title: 'Communication contexts',
      icon: MessageSquareText,
      items: compactDossierItems(draft.communicationContexts),
    },
    {
      id: 'strengths',
      title: 'Strengths',
      icon: Star,
      items: compactDossierItems(draft.stableStrengths),
    },
    {
      id: 'challenges',
      title: 'Challenges',
      icon: TrendingUp,
      items: compactDossierItems(draft.persistentChallenges),
    },
    {
      id: 'study-preferences',
      title: 'Study preferences',
      icon: BookOpenText,
      items: compactDossierItems(draft.studyPreferences),
    },
    {
      id: 'teacher-note',
      title: 'Teacher note',
      icon: NotebookText,
      body: draft.teacherNotes,
    },
  ];
}

function ProfileDossier({
  title,
  description,
  statusLabel,
  studentName,
  studentDetail,
  sections,
  provenance = [],
  actions,
}: ProfileDossierProps) {
  const visibleSections = sections.filter(
    (section) =>
      section.badge ||
      (section.body && section.body.trim()) ||
      (section.items && section.items.length > 0),
  );

  return (
    <div className="minimal-profile-dossier">
      <div className="minimal-profile-dossier-header">
        <div className="minimal-profile-dossier-student">
          <span className="minimal-profile-dossier-avatar" aria-hidden="true">
            {getProfileInitials(studentName)}
          </span>
          <div>
            <h4>{studentName?.trim() || 'Learner profile'}</h4>
            <p>{studentDetail}</p>
          </div>
        </div>
        <div className="minimal-profile-dossier-state">
          <div className="minimal-profile-dossier-title-row">
            <span className="minimal-profile-dossier-title">
              <GraduationCap aria-hidden="true" />
              {title}
            </span>
            <span className="minimal-profile-dossier-pill">{statusLabel}</span>
          </div>
          <p>{description}</p>
        </div>
      </div>

      <div className="minimal-profile-dossier-grid">
        {visibleSections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <section className="minimal-profile-dossier-section" key={section.id}>
              <div className="minimal-profile-dossier-section-heading">
                <span className="minimal-profile-dossier-section-icon" aria-hidden="true">
                  <SectionIcon />
                </span>
                <h5>{section.title}</h5>
                {section.badge ? (
                  <span className="minimal-profile-dossier-section-badge">{section.badge}</span>
                ) : null}
              </div>
              {section.items && section.items.length > 0 ? (
                <ul>
                  {section.items.map((item) => (
                    <li key={`${section.id}-${item}`}>{item}</li>
                  ))}
                </ul>
              ) : section.body ? (
                <p>{section.body}</p>
              ) : null}
            </section>
          );
        })}
      </div>

      {provenance.length > 0 || actions ? (
        <div className="minimal-profile-dossier-footer">
          {provenance.length > 0 ? (
            <div className="minimal-profile-dossier-provenance">
              {provenance.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <span key={item.label}>
                    <ItemIcon aria-hidden="true" />
                    {item.label}
                  </span>
                );
              })}
            </div>
          ) : null}
          {actions ? <div className="minimal-profile-dossier-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
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
  eyebrow,
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
          {eyebrow ? <p className="minimal-stage-eyebrow">{eyebrow}</p> : null}
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
  selectedStudentName,
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
                      className="minimal-secondary"
                      onClick={onRefreshRecentWork}
                      disabled={resumeLoading}
                    >
                      {resumeLoading ? 'Refreshing...' : 'Refresh recent work'}
                    </button>
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
  hideStudentSelection = false,
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
            {!recording && !hideStudentSelection ? (
              <button type="button" className="minimal-secondary" onClick={onRefreshStudents}>
                Refresh students
              </button>
            ) : null}
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
  studentName,
  selectedProfileId,
  profilePreview,
  profileRevisionError,
  firstProfileAssist,
  teacherNotes,
  onTeacherNotesChange,
}: ContextStageSectionProps) {
  const isInRouterContext = useInRouterContext();
  const contextGuidance =
    stage.status === 'current'
      ? 'Next step: review the learner context, add lesson goals here, then create the assignment in the next section.'
      : null;
  const renderLearningPageLink = (
    label: string,
    className = 'minimal-secondary minimal-link-button',
    options: { profileId?: string | null; draftRevisionId?: string | null } = {},
  ) => {
    if (!studentId) return null;
    const search = new URLSearchParams();
    if (options.profileId) {
      search.set('profileId', options.profileId);
    }
    if (options.draftRevisionId) {
      search.set('draftRevisionId', options.draftRevisionId);
    }
    const query = search.toString();
    const path = `/students/${encodeURIComponent(studentId)}/learning${query ? `?${query}` : ''}`;
    return isInRouterContext ? (
      <Link className={className} to={path}>
        {label}
      </Link>
    ) : (
      <a className={className} href={path}>
        {label}
      </a>
    );
  };

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
            <ProfileDossier
              title="Student Learning page"
              description="This approved profile is selected for the assignment."
              statusLabel="Selected"
              studentName={studentName}
              studentDetail="Structured learner profile"
              sections={buildCurrentProfileDossierSections(profilePreview)}
              provenance={[
                { icon: Database, label: 'Student Learning page' },
                ...(formatDossierDate(profilePreview.updatedAt)
                  ? [
                      {
                        icon: CheckCircle2,
                        label: `Updated ${formatDossierDate(profilePreview.updatedAt)}`,
                      },
                    ]
                  : []),
              ]}
              actions={renderLearningPageLink('Open Learning page')}
            />
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
          {firstProfileAssist.visible ? (
            <div className="minimal-first-profile-assist" aria-live="polite">
              {!firstProfileAssist.draftRevisionId ? (
                <div className="minimal-first-profile-assist-header">
                  <div>
                    <h4>
                      {firstProfileAssist.approved ? 'First profile ready' : 'First profile setup'}
                    </h4>
                    <p>
                      {firstProfileAssist.approved
                        ? 'The approved profile is selected for this assignment.'
                        : firstProfileAssist.confirmationState !== 'confirmed'
                          ? 'Confirm the transcript-student pairing before adding this lesson to learner memory.'
                          : firstProfileAssist.lessonMemoryStatus === 'ready'
                            ? 'Lesson memory is ready. Create the first structured profile before generating the assignment.'
                            : 'Building learner memory from the confirmed transcript.'}
                    </p>
                  </div>
                  <span
                    className={`minimal-first-profile-pill ${
                      firstProfileAssist.approved ? 'minimal-first-profile-pill-ready' : ''
                    }`}
                  >
                    {firstProfileAssist.approved
                      ? 'Approved'
                      : firstProfileAssist.confirmationState !== 'confirmed'
                        ? 'Transcript ready'
                        : firstProfileAssist.lessonMemoryStatus === 'ready'
                          ? 'Memory ready'
                          : 'Building memory'}
                  </span>
                </div>
              ) : null}
              {firstProfileAssist.approved ? (
                <p className="minimal-success">Profile approved and ready for this assignment.</p>
              ) : firstProfileAssist.draftRevisionId ? (
                <>
                  {firstProfileAssist.draftPreview ? (
                    <ProfileDossier
                      title="First profile draft"
                      description="Review what will be saved before approving."
                      statusLabel="Draft ready"
                      studentName={studentName}
                      studentDetail="No prior profile"
                      sections={buildDraftProfileDossierSections(firstProfileAssist.draftPreview)}
                      provenance={[
                        { icon: Database, label: 'Built from first lesson memory' },
                        { icon: CheckCircle2, label: 'Transcript ready' },
                      ]}
                      actions={
                        <>
                          <button
                            type="button"
                            className="minimal-primary"
                            onClick={firstProfileAssist.onApprove}
                            disabled={firstProfileAssist.busy === 'approving'}
                          >
                            {firstProfileAssist.busy === 'approving'
                              ? 'Approving...'
                              : 'Approve profile draft'}
                          </button>
                          {renderLearningPageLink('Edit in Learning page', undefined, {
                            profileId: firstProfileAssist.draftProfileId,
                            draftRevisionId: firstProfileAssist.draftRevisionId,
                          })}
                        </>
                      }
                    />
                  ) : (
                    <p className="minimal-muted">
                      The draft was created, but no structured preview was returned.
                    </p>
                  )}
                </>
              ) : firstProfileAssist.confirmationState !== 'confirmed' ? (
                <div className="minimal-memory-confirmation-gate">
                  <div className="minimal-memory-confirmation-status">
                    <CheckCircle2 aria-hidden="true" size={18} />
                    <span>Transcript ready</span>
                  </div>
                  <button
                    type="button"
                    className="minimal-primary minimal-memory-confirm-button"
                    onClick={firstProfileAssist.onConfirm}
                    disabled={
                      firstProfileAssist.busy === 'confirming' || firstProfileAssist.confirmDisabled
                    }
                  >
                    <CheckCircle2 aria-hidden="true" size={18} />
                    <span>
                      {firstProfileAssist.busy === 'confirming'
                        ? 'Confirming...'
                        : firstProfileAssist.confirmationState === 'edited'
                          ? 'Update learner context from edited transcript'
                          : `Use this transcript for ${studentName ?? 'this student'}'s learner context`}
                    </span>
                  </button>
                  <div className="minimal-memory-confirmation-actions">
                    <button
                      type="button"
                      className="minimal-secondary"
                      onClick={firstProfileAssist.onChangeStudent}
                    >
                      <UserRound aria-hidden="true" size={17} />
                      <span>Change student</span>
                    </button>
                    <button
                      type="button"
                      className="minimal-secondary"
                      onClick={firstProfileAssist.onReplaceAudio}
                    >
                      <RefreshCw aria-hidden="true" size={17} />
                      <span>Replace audio</span>
                    </button>
                  </div>
                  <p className="minimal-memory-confirmation-note">
                    <ShieldCheck aria-hidden="true" size={17} />
                    <span>Nothing is added to learner memory until you confirm.</span>
                  </p>
                  {firstProfileAssist.confirmDisabled ? (
                    <p className="minimal-muted">
                      Save transcript edits before updating learner context.
                    </p>
                  ) : null}
                </div>
              ) : firstProfileAssist.lessonMemoryStatus === 'ready' ? (
                <>
                  <div className="minimal-inline minimal-first-profile-actions">
                    <button
                      type="button"
                      className="minimal-primary"
                      onClick={firstProfileAssist.onPopulate}
                      disabled={firstProfileAssist.busy === 'drafting'}
                    >
                      {firstProfileAssist.busy === 'drafting'
                        ? 'Populating...'
                        : 'Populate first profile from lesson'}
                    </button>
                    <button
                      type="button"
                      className="minimal-secondary"
                      onClick={firstProfileAssist.onRefresh}
                    >
                      Refresh
                    </button>
                    {renderLearningPageLink('Open Learning page')}
                  </div>
                </>
              ) : (
                <>
                  <div className="minimal-memory-progress" role="status">
                    <span className="minimal-memory-spinner" aria-hidden="true" />
                    <span>
                      {firstProfileAssist.lessonMemoryStatus === 'checking'
                        ? 'Checking lesson memory'
                        : 'Building lesson memory'}{' '}
                      <span className="minimal-memory-estimate">(1-2 minutes)</span>
                    </span>
                  </div>
                  <div className="minimal-inline minimal-first-profile-actions">
                    <button
                      type="button"
                      className="minimal-secondary"
                      onClick={firstProfileAssist.onRefresh}
                    >
                      Check now
                    </button>
                    {renderLearningPageLink('Open Learning page')}
                  </div>
                </>
              )}
              {firstProfileAssist.error ? (
                <p className="minimal-error">{firstProfileAssist.error}</p>
              ) : null}
            </div>
          ) : null}
          {!firstProfileAssist.visible ? (
            <div className="minimal-inline">
              {studentId && !(selectedProfileId && profilePreview) ? (
                renderLearningPageLink('Open Learning page', 'minimal-primary minimal-link-button')
              ) : !studentId ? (
                <span className="minimal-primary minimal-link-button" aria-disabled="true">
                  Open Learning page
                </span>
              ) : null}
            </div>
          ) : null}
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
          <ProductButton
            type="button"
            variant="danger"
            onClick={onCancelJob}
            disabled={!cancelEnabled}
            busy={actionBusy === 'cancel'}
          >
            {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel'}
          </ProductButton>
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
