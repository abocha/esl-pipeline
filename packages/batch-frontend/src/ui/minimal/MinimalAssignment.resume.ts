import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AssignmentSession,
  JobOptionsResponse,
  JobStatus,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
} from '../../utils/api';
import {
  fetchAssignmentSession,
  fetchDraft,
  fetchPromptPackage,
  fetchRecordingTranscript,
  getJobStatus,
  getRecording,
  listAssignmentSessions,
  listUserJobs,
} from '../../utils/api';
import { getRecordingErrorAction } from '../../utils/recording-state';
import type { AuthoringHydrationSnapshot } from './MinimalAssignment.authoring';
import { deriveResumeDestination } from './MinimalAssignment.confirmation';
import {
  getJobRecentAssignmentPresentation,
  getSessionRecentAssignmentPresentation,
  type RecentAssignmentState,
} from './MinimalAssignment.entry-state';
import {
  type MinimalPublishTarget,
  type PublishJobOverridesInput,
} from './MinimalAssignment.logic';

type UiTtsProvider = PublishJobOverridesInput['selectedTtsProvider'];
type UiPublishTtsStrategy = PublishJobOverridesInput['selectedTtsStrategy'];
type TranscriptUiStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'failed';
type PronunciationMode =
  | 'shadow_sentence'
  | 'connected_speech'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'minimal_pair';

function readJobIdFromQuery(): string | null {
  if (globalThis.window === undefined) return null;
  const params = new URLSearchParams(globalThis.location.search);
  const value = params.get('jobId')?.trim();
  return value || null;
}

function readSessionIdFromQuery(): string | null {
  if (globalThis.window === undefined) return null;
  const params = new URLSearchParams(globalThis.location.search);
  const value = params.get('sessionId')?.trim();
  return value || null;
}

function writeResumeTargetToQuery(target: { jobId?: string | null; sessionId?: string | null }) {
  if (globalThis.window === undefined) return;
  const nextUrl = new URL(globalThis.location.href);
  if (target.jobId) {
    nextUrl.searchParams.set('jobId', target.jobId);
  } else {
    nextUrl.searchParams.delete('jobId');
  }
  if (target.sessionId) {
    nextUrl.searchParams.set('sessionId', target.sessionId);
  } else {
    nextUrl.searchParams.delete('sessionId');
  }
  const suffix = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  globalThis.history.replaceState(null, '', suffix);
}

function needsCanonicalSourceResolution(session: AssignmentSession): boolean {
  return (
    session.confirmedStep === 'student' &&
    session.recordingId === null &&
    session.transcriptId !== null &&
    session.promptPackageId === null &&
    session.draftId === null &&
    session.shareJobId === null
  );
}

function describeJobFailureReason(job: Pick<JobStatus, 'publishTarget' | 'error'>): string {
  const reason = job.error?.trim();
  if (!reason) {
    return 'Publishing failed. Check service availability and retry.';
  }
  return reason;
}

function normalizePresetSelection(
  availablePresets: readonly string[] | undefined,
  requestedPreset: string | null | undefined,
  currentPreset: string,
): string {
  if (availablePresets === undefined) {
    return requestedPreset ?? currentPreset;
  }
  if (availablePresets.length === 0) {
    return '';
  }
  if (requestedPreset && availablePresets.includes(requestedPreset)) {
    return requestedPreset;
  }
  if (currentPreset && availablePresets.includes(currentPreset)) {
    return currentPreset;
  }
  return availablePresets[0] ?? '';
}

function isUiTtsProvider(value: string | null | undefined): value is UiTtsProvider {
  return value === 'elevenlabs' || value === 'google' || value === 'inworld' || value === 'gemini';
}

function isUiPublishTtsStrategy(value: string | null | undefined): value is UiPublishTtsStrategy {
  return value === 'auto' || value === 'dialogue' || value === 'tts';
}

export interface HydratedAssignmentSnapshot {
  jobStatus: JobStatus | null;
  recording: RecordingListItem | null;
  recordingStatus: RecordingStatus | null;
  recordingError: string | null;
  selectedFileName: string | null;
  transcript: RecordingTranscriptResponse | null;
  transcriptText: string;
  transcriptStatus: TranscriptUiStatus;
  transcriptError: string | null;
  teacherNotes: string;
  rerunTargetPronunciationMode: PronunciationMode | null;
  selectedStudentId: string;
  lessonId: string | null;
  selectedProfileId: string;
  selectedProfileRevisionId?: string | null;
  selectedProfileRevisionHash?: string | null;
  profileAuthorityResolved?: boolean;
  uploadError: string | null;
  uploadCacheNotice: string | null;
  authoring: AuthoringHydrationSnapshot;
}

function resolveSessionProfileLineage(session: AssignmentSession): {
  selectedProfileId: string;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  profileAuthorityResolved: boolean;
} {
  const currentIsComplete = Boolean(
    session.studentId && session.selectedProfileRevisionId && session.selectedProfileRevisionHash,
  );
  if (currentIsComplete) {
    return {
      selectedProfileId: session.studentId ?? '',
      selectedProfileRevisionId: session.selectedProfileRevisionId,
      selectedProfileRevisionHash: session.selectedProfileRevisionHash,
      profileAuthorityResolved: true,
    };
  }

  const confirmed = session.confirmed.context;
  const confirmedIsComplete = Boolean(
    session.studentId && confirmed?.profileRevisionId && confirmed.profileRevisionHash,
  );
  if (confirmedIsComplete) {
    return {
      selectedProfileId: session.studentId,
      selectedProfileRevisionId: confirmed?.profileRevisionId ?? null,
      selectedProfileRevisionHash: confirmed?.profileRevisionHash ?? null,
      profileAuthorityResolved: true,
    };
  }

  if (confirmed) {
    return {
      selectedProfileId: session.studentId,
      selectedProfileRevisionId: confirmed.profileRevisionId,
      selectedProfileRevisionHash: confirmed.profileRevisionHash,
      profileAuthorityResolved: true,
    };
  }

  const hasRecoveryProfileState = Boolean(
    session.selectedProfileRevisionId || session.selectedProfileRevisionHash,
  );
  return {
    selectedProfileId: session.studentId ?? '',
    selectedProfileRevisionId: session.selectedProfileRevisionId,
    selectedProfileRevisionHash: session.selectedProfileRevisionHash,
    profileAuthorityResolved: hasRecoveryProfileState,
  };
}

export type HydrationMode = 'session' | 'job' | 'new';

export interface HydrationContext {
  id: number;
  mode: HydrationMode;
}

export interface ResumeOpenSuccess {
  ok: true;
  itemId: string;
  state: RecentAssignmentState;
  destination: 'student' | 'source' | 'context' | 'assignment' | 'review';
}

export type ResumeOpenResult = ResumeOpenSuccess | { ok: false };

interface UseMinimalAssignmentResumeParams {
  applyHydratedSnapshot: (snapshot: HydratedAssignmentSnapshot) => void;
  applyCurrentJobStatus: (job: JobStatus | null) => void;
  invalidateDraftGenerationRequests: () => void;
  beginHydration: (mode: HydrationMode) => HydrationContext;
  isCurrentHydration: (context: HydrationContext) => boolean;
  jobOptions: JobOptionsResponse | null;
  presetOptionIds: readonly string[];
  currentPublishTarget: MinimalPublishTarget;
  currentSelectedTtsProvider: UiTtsProvider;
  currentSelectedTtsStrategy: UiPublishTtsStrategy;
  currentSelectedTtsModel: string;
  currentSelectedPreset: string;
  currentSelectedStudentId: string;
  currentSelectedProfileId: string;
  onInitialHydrationResolved: (result: ResumeOpenSuccess) => void;
}

export function useMinimalAssignmentResume({
  applyHydratedSnapshot,
  applyCurrentJobStatus,
  invalidateDraftGenerationRequests,
  beginHydration,
  isCurrentHydration,
  jobOptions,
  presetOptionIds,
  currentPublishTarget,
  currentSelectedTtsProvider,
  currentSelectedTtsStrategy,
  currentSelectedTtsModel,
  currentSelectedPreset,
  currentSelectedStudentId,
  currentSelectedProfileId,
  onInitialHydrationResolved,
}: UseMinimalAssignmentResumeParams) {
  const [resumeJobs, setResumeJobs] = useState<JobStatus[]>([]);
  const [assignmentSessions, setAssignmentSessions] = useState<AssignmentSession[]>([]);
  const [activeAssignmentSession, setActiveAssignmentSession] = useState<AssignmentSession | null>(
    null,
  );
  const [selectedResumeJobId, setSelectedResumeJobId] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeJobsTotal, setResumeJobsTotal] = useState(0);
  const [assignmentSessionsTotal, setAssignmentSessionsTotal] = useState(0);
  const [resumeLoadingMore, setResumeLoadingMore] = useState(false);
  const [resumeLoadMoreError, setResumeLoadMoreError] = useState<string | null>(null);
  const resumeInitializedRef = useRef(false);
  const latestAssignmentSessionsRef = useRef<AssignmentSession[]>([]);
  const initialHydrationResolvedRef = useRef(false);

  const applyJobStatusTransition = useCallback(
    (job: JobStatus) => {
      applyCurrentJobStatus(job);
      setSelectedResumeJobId(job.jobId);
      writeResumeTargetToQuery({ jobId: job.jobId });
    },
    [applyCurrentJobStatus],
  );

  const loadResumeJobs = useCallback(async (): Promise<JobStatus[]> => {
    try {
      const [jobsResponse, sessionsResponse] = await Promise.all([
        listUserJobs({
          limit: 20,
          offset: 0,
        }),
        listAssignmentSessions(20),
      ]);
      const jobs = jobsResponse.jobs ?? [];
      const sessions = sessionsResponse.sessions ?? [];
      setResumeJobs(jobs);
      setAssignmentSessions(sessions);
      setResumeJobsTotal(jobsResponse.total);
      setAssignmentSessionsTotal(sessionsResponse.total);
      latestAssignmentSessionsRef.current = sessions;
      if (jobs.length === 0 && sessions.length === 0) {
        setSelectedResumeJobId('');
      } else {
        setSelectedResumeJobId((current) => {
          if (current && jobs.some((job) => job.jobId === current)) {
            return current;
          }
          if (
            current.startsWith('session:') &&
            sessions.some((session) => `session:${session.id}` === current)
          ) {
            return current;
          }
          return '';
        });
      }
      setResumeError(null);
      setResumeLoadMoreError(null);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent jobs.';
      setResumeError(message);
      return [];
    }
  }, []);

  const loadMoreResumeJobs = useCallback(async (): Promise<void> => {
    if (resumeLoadingMore) return;
    const jobsHaveMore = resumeJobs.length < resumeJobsTotal;
    const sessionsHaveMore = assignmentSessions.length < assignmentSessionsTotal;
    if (!jobsHaveMore && !sessionsHaveMore) return;

    setResumeLoadingMore(true);
    setResumeLoadMoreError(null);
    try {
      const [jobsResponse, sessionsResponse] = await Promise.all([
        jobsHaveMore
          ? listUserJobs({ limit: 20, offset: resumeJobs.length })
          : Promise.resolve(null),
        sessionsHaveMore
          ? listAssignmentSessions(assignmentSessions.length + 20)
          : Promise.resolve(null),
      ]);
      if (jobsResponse) {
        setResumeJobs((current) => {
          const knownIds = new Set(current.map((job) => job.jobId));
          return [
            ...current,
            ...(jobsResponse.jobs ?? []).filter((job) => !knownIds.has(job.jobId)),
          ];
        });
        setResumeJobsTotal(jobsResponse.total);
      }
      if (sessionsResponse) {
        setAssignmentSessions((current) => {
          const knownIds = new Set(current.map((session) => session.id));
          const next = [
            ...current,
            ...(sessionsResponse.sessions ?? []).filter((session) => !knownIds.has(session.id)),
          ];
          latestAssignmentSessionsRef.current = next;
          return next;
        });
        setAssignmentSessionsTotal(sessionsResponse.total);
      }
    } catch (error) {
      setResumeLoadMoreError(
        error instanceof Error ? error.message : 'Unable to load older assignments.',
      );
    } finally {
      setResumeLoadingMore(false);
    }
  }, [
    assignmentSessions.length,
    assignmentSessionsTotal,
    resumeJobs.length,
    resumeJobsTotal,
    resumeLoadingMore,
  ]);

  const buildSnapshotFromSession = useCallback(
    (session: AssignmentSession): HydratedAssignmentSnapshot => {
      const sessionProfileLineage = resolveSessionProfileLineage(session);
      const selectedTtsProvider = isUiTtsProvider(session.selectedTtsProvider)
        ? session.selectedTtsProvider
        : currentSelectedTtsProvider;
      const selectedTtsStrategy = isUiPublishTtsStrategy(session.selectedTtsStrategy)
        ? session.selectedTtsStrategy
        : currentSelectedTtsStrategy;
      const selectedPreset = session.selectedPreset
        ? normalizePresetSelection(
            jobOptions ? presetOptionIds : undefined,
            session.selectedPreset,
            currentSelectedPreset,
          )
        : currentSelectedPreset;
      return {
        jobStatus: null,
        recording: null,
        recordingStatus: null,
        recordingError: null,
        selectedFileName: null,
        transcript: null,
        transcriptText: '',
        transcriptStatus: 'idle',
        transcriptError: null,
        teacherNotes: session.teacherNotes ?? '',
        rerunTargetPronunciationMode: null,
        selectedStudentId: session.studentId ?? currentSelectedStudentId,
        lessonId: session.lessonId ?? null,
        selectedProfileId:
          sessionProfileLineage.selectedProfileId ||
          (session.studentId ? session.studentId : currentSelectedProfileId),
        selectedProfileRevisionId: sessionProfileLineage.selectedProfileRevisionId,
        selectedProfileRevisionHash: sessionProfileLineage.selectedProfileRevisionHash,
        profileAuthorityResolved: sessionProfileLineage.profileAuthorityResolved,
        uploadError: null,
        uploadCacheNotice: null,
        authoring: {
          publishTarget: session.publishTarget ?? currentPublishTarget,
          selectedTtsProvider,
          selectedTtsStrategy,
          selectedTtsModel: session.selectedTtsModel ?? currentSelectedTtsModel,
          selectedPreset,
          selectedGenerationProvider: session.selectedGenerationProvider ?? '',
          selectedGenerationModel: session.selectedGenerationModel ?? '',
          promptPackage: null,
          promptText: '',
          promptError: null,
          draft: null,
          draftText: '',
          draftError: null,
          publishError: null,
          previewHtml: null,
          previewError: null,
          lastPreviewedDraftHash: null,
          validation: null,
          validationError: null,
        },
      };
    },
    [
      currentPublishTarget,
      currentSelectedPreset,
      currentSelectedProfileId,
      currentSelectedStudentId,
      currentSelectedTtsModel,
      currentSelectedTtsProvider,
      currentSelectedTtsStrategy,
      jobOptions,
      presetOptionIds,
    ],
  );

  const hydrateFromJob = useCallback(
    async (
      jobId: string,
      knownJobs?: JobStatus[],
      isInitialHydration = false,
      knownCompletedSession?: AssignmentSession,
    ): Promise<ResumeOpenResult> => {
      if (!jobId) return { ok: false };

      const hydration = beginHydration('job');
      invalidateDraftGenerationRequests();
      setResumeLoading(true);
      setResumeError(null);

      try {
        const status = await getJobStatus(jobId);
        const completedSession =
          knownCompletedSession ??
          (status.assignmentSessionId
            ? await fetchAssignmentSession(status.assignmentSessionId).catch((error) => {
                if (status.assignmentArtifact) throw error;
                return null;
              })
            : null);
        if (completedSession && completedSession.confirmedStep !== 'share') {
          throw new Error('Historical assignment link did not resolve to a completed session.');
        }
        const candidateJobs = knownJobs ?? resumeJobs;
        let resolvedStudentId =
          candidateJobs.find((job) => job.jobId === status.jobId)?.studentId ??
          status.studentId ??
          null;

        const selectedTtsProvider = isUiTtsProvider(status.ttsProvider)
          ? status.ttsProvider
          : currentSelectedTtsProvider;
        const selectedTtsStrategy = isUiPublishTtsStrategy(status.ttsStrategy)
          ? status.ttsStrategy
          : currentSelectedTtsStrategy;
        const selectedTtsModel =
          typeof status.ttsModel === 'string' && status.ttsModel.trim().length > 0
            ? status.ttsModel
            : currentSelectedTtsModel;

        const resumedPresetId = status.learningPresetId ?? status.preset;
        const selectedPreset = resumedPresetId
          ? normalizePresetSelection(
              jobOptions ? presetOptionIds : undefined,
              resumedPresetId,
              currentSelectedPreset,
            )
          : currentSelectedPreset;
        const completedSessionProfileLineage = completedSession
          ? resolveSessionProfileLineage(completedSession)
          : null;

        const snapshot: HydratedAssignmentSnapshot = {
          jobStatus: status,
          recording: null,
          recordingStatus: null,
          recordingError: null,
          selectedFileName: null,
          transcript: null,
          transcriptText: '',
          transcriptStatus: 'idle',
          transcriptError: null,
          teacherNotes: completedSession?.teacherNotes ?? '',
          rerunTargetPronunciationMode: status.pronunciationMode ?? null,
          selectedStudentId: currentSelectedStudentId,
          lessonId: status.lessonId ?? completedSession?.lessonId ?? null,
          selectedProfileId:
            completedSessionProfileLineage?.selectedProfileId ?? currentSelectedProfileId,
          selectedProfileRevisionId:
            completedSessionProfileLineage?.selectedProfileRevisionId ?? null,
          selectedProfileRevisionHash:
            completedSessionProfileLineage?.selectedProfileRevisionHash ?? null,
          profileAuthorityResolved:
            completedSessionProfileLineage?.profileAuthorityResolved ?? false,
          uploadError: null,
          uploadCacheNotice: null,
          authoring: {
            publishTarget: status.publishTarget ?? currentPublishTarget,
            selectedTtsProvider,
            selectedTtsStrategy,
            selectedTtsModel,
            selectedPreset,
            selectedGenerationProvider: '',
            selectedGenerationModel: '',
            promptPackage: null,
            promptText: '',
            promptError: null,
            draft: null,
            draftText: '',
            draftError: null,
            publishError:
              status.state === 'failed' && status.error ? describeJobFailureReason(status) : null,
            previewHtml: null,
            previewError: null,
            lastPreviewedDraftHash: null,
            validation: null,
            validationError: null,
          },
        };

        if (status.recordingId) {
          try {
            const resumedRecording = await getRecording(status.recordingId);
            snapshot.recording = resumedRecording;
            snapshot.recordingStatus = resumedRecording.status;
            snapshot.recordingError =
              resumedRecording.productState === 'attention'
                ? getRecordingErrorAction(resumedRecording.errorCode)
                : null;
            snapshot.selectedFileName = resumedRecording.displayName || null;
            if (resumedRecording.studentId) {
              resolvedStudentId = resumedRecording.studentId;
            }

            if (
              status.transcriptId ||
              resumedRecording.transcriptId ||
              resumedRecording.status === 'transcribed'
            ) {
              try {
                const resumedTranscript = await fetchRecordingTranscript(
                  resumedRecording.recordingId,
                );
                snapshot.transcript = resumedTranscript;
                snapshot.transcriptText = resumedTranscript.text ?? '';
                snapshot.transcriptStatus = 'ready';
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Unable to load transcript.';
                if (
                  resumedRecording.productState === 'checking' ||
                  resumedRecording.productState === 'waiting' ||
                  resumedRecording.productState === 'transcribing' ||
                  resumedRecording.productState === 'retrying'
                ) {
                  snapshot.transcriptStatus = 'processing';
                  snapshot.transcriptError = null;
                } else {
                  snapshot.transcriptStatus = 'failed';
                  snapshot.transcriptError = message;
                }
              }
            } else if (resumedRecording.productState === 'attention') {
              snapshot.transcriptStatus = 'failed';
              snapshot.transcriptError = getRecordingErrorAction(resumedRecording.errorCode);
            } else {
              snapshot.transcriptStatus = 'processing';
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load recording.';
            snapshot.recordingError = message;
            snapshot.transcriptStatus = 'failed';
            snapshot.transcriptError = message;
          }
        }

        if (status.promptPackageId) {
          try {
            const resumedPromptPackage = await fetchPromptPackage(status.promptPackageId);
            snapshot.authoring.promptPackage = resumedPromptPackage;
            snapshot.teacherNotes = resumedPromptPackage.notes ?? '';
            snapshot.authoring.promptText = resumedPromptPackage.text ?? '';
            if (!resolvedStudentId && resumedPromptPackage.studentId) {
              resolvedStudentId = resumedPromptPackage.studentId;
            }
          } catch (error) {
            snapshot.authoring.promptError =
              error instanceof Error ? error.message : 'Unable to load prompt package.';
          }
        }

        if (status.draftId) {
          try {
            const resumedDraft = await fetchDraft(status.draftId);
            snapshot.authoring.draft = resumedDraft;
            snapshot.authoring.draftText = resumedDraft.text ?? '';
            snapshot.rerunTargetPronunciationMode =
              resumedDraft.assignment?.pronunciation?.mode ?? null;
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            snapshot.authoring.draftError =
              error instanceof Error ? error.message : 'Unable to load saved draft.';
          }
        }

        if (resolvedStudentId) {
          snapshot.selectedStudentId = resolvedStudentId;
          if (!snapshot.profileAuthorityResolved) {
            snapshot.selectedProfileId = resolvedStudentId;
          }
        }

        if (!isCurrentHydration(hydration)) return { ok: false };

        applyHydratedSnapshot(snapshot);
        setSelectedResumeJobId(status.jobId);
        setActiveAssignmentSession(completedSession);
        writeResumeTargetToQuery({ jobId: status.jobId });
        const result: ResumeOpenSuccess = {
          ok: true,
          itemId: status.jobId,
          state: getJobRecentAssignmentPresentation(status.state, Boolean(status.htmlUrl)).state,
          destination: 'review',
        };
        if (isInitialHydration && !initialHydrationResolvedRef.current) {
          initialHydrationResolvedRef.current = true;
          onInitialHydrationResolved(result);
        }
        return result;
      } catch (error) {
        if (!isCurrentHydration(hydration)) return { ok: false };
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
        return { ok: false };
      } finally {
        if (isCurrentHydration(hydration)) {
          setResumeLoading(false);
        }
      }
    },
    [
      applyHydratedSnapshot,
      beginHydration,
      currentPublishTarget,
      currentSelectedPreset,
      currentSelectedProfileId,
      currentSelectedStudentId,
      currentSelectedTtsModel,
      currentSelectedTtsProvider,
      currentSelectedTtsStrategy,
      invalidateDraftGenerationRequests,
      isCurrentHydration,
      jobOptions,
      presetOptionIds,
      resumeJobs,
      onInitialHydrationResolved,
    ],
  );

  const hydrateFromSession = useCallback(
    async (
      sessionId: string,
      knownSessions?: AssignmentSession[],
      isInitialHydration = false,
    ): Promise<ResumeOpenResult> => {
      if (!sessionId) return { ok: false };

      const hydration = beginHydration('session');
      invalidateDraftGenerationRequests();
      setResumeLoading(true);
      setResumeError(null);

      try {
        const cachedSession = knownSessions?.find((session) => session.id === sessionId);
        // Normal resume uses the coherent list snapshot. Partial source shells and explicit
        // conflict handoffs re-fetch so the backend can return canonical assignment authority.
        const session =
          cachedSession && !needsCanonicalSourceResolution(cachedSession)
            ? cachedSession
            : await fetchAssignmentSession(sessionId);
        if (session.confirmedStep === 'share') {
          if (!session.shareJobId) throw new Error('Shared assignment is missing its linked job.');
          return hydrateFromJob(session.shareJobId, undefined, isInitialHydration, session);
        }
        const snapshot = buildSnapshotFromSession(session);
        let resolvedStudentId = session.studentId ?? null;

        if (session.recordingId) {
          try {
            const resumedRecording = await getRecording(session.recordingId);
            snapshot.recording = resumedRecording;
            snapshot.recordingStatus = resumedRecording.status;
            snapshot.recordingError =
              resumedRecording.productState === 'attention'
                ? getRecordingErrorAction(resumedRecording.errorCode)
                : null;
            snapshot.selectedFileName = resumedRecording.displayName || null;
            if (resumedRecording.studentId) {
              resolvedStudentId = resumedRecording.studentId;
            }

            if (
              session.transcriptId ||
              resumedRecording.transcriptId ||
              resumedRecording.status === 'transcribed'
            ) {
              try {
                const resumedTranscript = await fetchRecordingTranscript(
                  resumedRecording.recordingId,
                );
                snapshot.transcript = resumedTranscript;
                snapshot.transcriptText = resumedTranscript.text ?? '';
                snapshot.transcriptStatus = 'ready';
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Unable to load transcript.';
                if (
                  resumedRecording.productState === 'checking' ||
                  resumedRecording.productState === 'waiting' ||
                  resumedRecording.productState === 'transcribing' ||
                  resumedRecording.productState === 'retrying'
                ) {
                  snapshot.transcriptStatus = 'processing';
                  snapshot.transcriptError = null;
                } else {
                  snapshot.transcriptStatus = 'failed';
                  snapshot.transcriptError = message;
                }
              }
            } else if (resumedRecording.productState === 'attention') {
              snapshot.transcriptStatus = 'failed';
              snapshot.transcriptError = getRecordingErrorAction(resumedRecording.errorCode);
            } else {
              snapshot.transcriptStatus = 'processing';
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load recording.';
            snapshot.recordingError = message;
            snapshot.transcriptStatus = 'failed';
            snapshot.transcriptError = message;
          }
        }

        if (session.promptPackageId) {
          try {
            const resumedPromptPackage = await fetchPromptPackage(session.promptPackageId);
            snapshot.authoring.promptPackage = resumedPromptPackage;
            snapshot.teacherNotes = session.teacherNotes ?? resumedPromptPackage.notes ?? '';
            snapshot.authoring.promptText = resumedPromptPackage.text ?? '';
            if (!resolvedStudentId && resumedPromptPackage.studentId) {
              resolvedStudentId = resumedPromptPackage.studentId;
            }
          } catch (error) {
            snapshot.authoring.promptError =
              error instanceof Error ? error.message : 'Unable to load prompt package.';
          }
        }

        if (session.draftId) {
          try {
            const resumedDraft = await fetchDraft(session.draftId);
            snapshot.authoring.draft = resumedDraft;
            snapshot.authoring.draftText = resumedDraft.text ?? '';
            snapshot.rerunTargetPronunciationMode =
              resumedDraft.assignment?.pronunciation?.mode ?? null;
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            snapshot.authoring.draftError =
              error instanceof Error ? error.message : 'Unable to load saved draft.';
          }
        }

        if (resolvedStudentId) {
          snapshot.selectedStudentId = resolvedStudentId;
          if (!snapshot.profileAuthorityResolved) {
            snapshot.selectedProfileId = resolvedStudentId;
          }
        }

        if (!isCurrentHydration(hydration)) return { ok: false };

        applyHydratedSnapshot(snapshot);
        setActiveAssignmentSession(session);
        setSelectedResumeJobId(`session:${session.id}`);
        writeResumeTargetToQuery({ sessionId: session.id });
        const destination =
          session.historicalReadOnly ||
          (snapshot.authoring.draft && snapshot.authoring.draft.format !== 'assignment_v1') ||
          (snapshot.authoring.promptPackage &&
            snapshot.authoring.promptPackage.requestEnvelope?.promptVersion !== 'assignment_v1')
            ? 'review'
            : deriveResumeDestination(session, {
                transcript: snapshot.transcript
                  ? {
                      workingVersion: snapshot.transcript.workingVersion,
                      contentHash: snapshot.transcript.contentHash,
                    }
                  : null,
                draft: snapshot.authoring.draft
                  ? {
                      workingVersion: snapshot.authoring.draft.workingVersion,
                      contentHash: snapshot.authoring.draft.contentHash,
                    }
                  : null,
              });
        if (typeof destination !== 'string') {
          throw new Error('Active assignment unexpectedly resolved to a completed job.');
        }
        const result: ResumeOpenSuccess = {
          ok: true,
          itemId: `session:${session.id}`,
          state: getSessionRecentAssignmentPresentation(session).state,
          destination,
        };
        if (isInitialHydration && !initialHydrationResolvedRef.current) {
          initialHydrationResolvedRef.current = true;
          onInitialHydrationResolved(result);
        }
        return result;
      } catch (error) {
        if (!isCurrentHydration(hydration)) return { ok: false };
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
        return { ok: false };
      } finally {
        if (isCurrentHydration(hydration)) {
          setResumeLoading(false);
        }
      }
    },
    [
      applyHydratedSnapshot,
      beginHydration,
      buildSnapshotFromSession,
      hydrateFromJob,
      invalidateDraftGenerationRequests,
      isCurrentHydration,
      onInitialHydrationResolved,
    ],
  );

  const handleResumeSelectedJob = useCallback(async (): Promise<ResumeOpenResult> => {
    if (!selectedResumeJobId) return { ok: false };
    const result = selectedResumeJobId.startsWith('session:')
      ? await hydrateFromSession(selectedResumeJobId.slice('session:'.length), assignmentSessions)
      : await hydrateFromJob(selectedResumeJobId, resumeJobs);
    await loadResumeJobs();
    return result;
  }, [
    assignmentSessions,
    hydrateFromJob,
    hydrateFromSession,
    loadResumeJobs,
    resumeJobs,
    selectedResumeJobId,
  ]);

  useEffect(() => {
    if (resumeInitializedRef.current) return;
    resumeInitializedRef.current = true;

    const initializeResume = async () => {
      setResumeLoading(true);
      const jobs = await loadResumeJobs();
      const sessions = latestAssignmentSessionsRef.current;
      const queryJobId = readJobIdFromQuery();
      const querySessionId = readSessionIdFromQuery();
      if (querySessionId) {
        setSelectedResumeJobId(`session:${querySessionId}`);
        await hydrateFromSession(querySessionId, sessions, true);
        return;
      }
      if (queryJobId) {
        setSelectedResumeJobId(queryJobId);
        await hydrateFromJob(queryJobId, jobs, true);
        return;
      }

      setResumeLoading(false);
    };

    void initializeResume();
  }, [hydrateFromJob, hydrateFromSession, loadResumeJobs]);

  const openAssignmentSession = useCallback(
    (sessionId: string) => hydrateFromSession(sessionId),
    [hydrateFromSession],
  );

  return {
    resumeJobs,
    assignmentSessions,
    activeAssignmentSession,
    setActiveAssignmentSession,
    selectedResumeJobId,
    setSelectedResumeJobId,
    resumeLoading,
    resumeError,
    resumeHasMore:
      resumeJobs.length < resumeJobsTotal || assignmentSessions.length < assignmentSessionsTotal,
    resumeLoadingMore,
    resumeLoadMoreError,
    loadResumeJobs,
    loadMoreResumeJobs,
    handleResumeSelectedJob,
    openAssignmentSession,
    applyJobStatusTransition,
  };
}
