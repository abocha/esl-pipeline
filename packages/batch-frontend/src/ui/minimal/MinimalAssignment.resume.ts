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
import type { AuthoringHydrationSnapshot } from './MinimalAssignment.authoring';
import {
  type MinimalPublishTarget,
  type PublishJobOverridesInput,
} from './MinimalAssignment.logic';
import { isActivelyProcessingJobState, isTerminalJobState } from './MinimalAssignment.polling';

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

function detectPronunciationModeFromDraft(text: string): PronunciationMode | null {
  const match = text.match(/\*\*Mode:\*\*\s*([a-z_]+)/i);
  if (!match) return null;
  const mode = match[1]?.trim().toLowerCase();
  return mode === 'shadow_sentence' ||
    mode === 'connected_speech' ||
    mode === 'intonation' ||
    mode === 'rhythm_chunking' ||
    mode === 'sentence_stress' ||
    mode === 'minimal_pair'
    ? mode
    : null;
}

function isUiTtsProvider(value: string | null | undefined): value is UiTtsProvider {
  return value === 'elevenlabs' || value === 'google' || value === 'inworld';
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
  profileSelectionMode: 'auto' | 'manual';
  uploadError: string | null;
  uploadCacheNotice: string | null;
  authoring: AuthoringHydrationSnapshot;
}

export type HydrationMode = 'session' | 'job' | 'new';

export interface HydrationContext {
  id: number;
  mode: HydrationMode;
}

interface UseMinimalAssignmentResumeParams {
  applyHydratedSnapshot: (snapshot: HydratedAssignmentSnapshot) => void;
  applyCurrentJobStatus: (job: JobStatus | null) => void;
  invalidateDraftGenerationRequests: () => void;
  beginHydration: (mode: HydrationMode) => HydrationContext;
  isCurrentHydration: (context: HydrationContext) => boolean;
  jobOptions: JobOptionsResponse | null;
  presetOptionIds: readonly string[];
  resolveBoundProfileId: (studentId: string) => string;
  currentPublishTarget: MinimalPublishTarget;
  currentSelectedTtsProvider: UiTtsProvider;
  currentSelectedTtsStrategy: UiPublishTtsStrategy;
  currentSelectedTtsModel: string;
  currentSelectedPreset: string;
  currentSelectedStudentId: string;
  currentSelectedProfileId: string;
  currentProfileSelectionMode: 'auto' | 'manual';
}

export function useMinimalAssignmentResume({
  applyHydratedSnapshot,
  applyCurrentJobStatus,
  invalidateDraftGenerationRequests,
  beginHydration,
  isCurrentHydration,
  jobOptions,
  presetOptionIds,
  resolveBoundProfileId,
  currentPublishTarget,
  currentSelectedTtsProvider,
  currentSelectedTtsStrategy,
  currentSelectedTtsModel,
  currentSelectedPreset,
  currentSelectedStudentId,
  currentSelectedProfileId,
  currentProfileSelectionMode,
}: UseMinimalAssignmentResumeParams) {
  const [resumeJobs, setResumeJobs] = useState<JobStatus[]>([]);
  const [assignmentSessions, setAssignmentSessions] = useState<AssignmentSession[]>([]);
  const [activeAssignmentSession, setActiveAssignmentSession] = useState<AssignmentSession | null>(
    null,
  );
  const [selectedResumeJobId, setSelectedResumeJobId] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [pinnedJobExpanded, setPinnedJobExpanded] = useState(true);
  const resumeInitializedRef = useRef(false);
  const latestAssignmentSessionsRef = useRef<AssignmentSession[]>([]);

  const applyJobStatusTransition = useCallback(
    (job: JobStatus) => {
      applyCurrentJobStatus(job);
      setSelectedResumeJobId(job.jobId);
      setPinnedJobExpanded(!isTerminalJobState(job.state));
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
          return (
            jobs.find((job) => isActivelyProcessingJobState(job.state))?.jobId ??
            (sessions[0] ? `session:${sessions[0].id}` : (jobs[0]?.jobId ?? ''))
          );
        });
      }
      setResumeError(null);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent jobs.';
      setResumeError(message);
      return [];
    }
  }, []);

  const buildSnapshotFromSession = useCallback(
    (session: AssignmentSession): HydratedAssignmentSnapshot => {
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
        selectedProfileId: session.studentId
          ? resolveBoundProfileId(session.studentId)
          : currentSelectedProfileId,
        profileSelectionMode: session.studentId ? 'auto' : currentProfileSelectionMode,
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
      currentProfileSelectionMode,
      currentPublishTarget,
      currentSelectedPreset,
      currentSelectedProfileId,
      currentSelectedStudentId,
      currentSelectedTtsModel,
      currentSelectedTtsProvider,
      currentSelectedTtsStrategy,
      jobOptions,
      presetOptionIds,
      resolveBoundProfileId,
    ],
  );

  const hydrateFromJob = useCallback(
    async (jobId: string, knownJobs?: JobStatus[]) => {
      if (!jobId) return;

      const hydration = beginHydration('job');
      invalidateDraftGenerationRequests();
      setResumeLoading(true);
      setResumeError(null);

      try {
        const status = await getJobStatus(jobId);
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
          teacherNotes: '',
          rerunTargetPronunciationMode: status.pronunciationMode ?? null,
          selectedStudentId: currentSelectedStudentId,
          lessonId: status.lessonId ?? null,
          selectedProfileId: currentSelectedProfileId,
          profileSelectionMode: currentProfileSelectionMode,
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
            snapshot.recordingError = resumedRecording.error ?? null;
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
                  resumedRecording.status === 'transcribing' ||
                  resumedRecording.status === 'queued'
                ) {
                  snapshot.transcriptStatus = 'processing';
                  snapshot.transcriptError = null;
                } else {
                  snapshot.transcriptStatus = 'failed';
                  snapshot.transcriptError = message;
                }
              }
            } else if (resumedRecording.status === 'failed') {
              snapshot.transcriptStatus = 'failed';
              snapshot.transcriptError = resumedRecording.error ?? 'Transcription failed.';
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
            snapshot.rerunTargetPronunciationMode = detectPronunciationModeFromDraft(
              resumedDraft.text ?? '',
            );
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            snapshot.authoring.draftError =
              error instanceof Error ? error.message : 'Unable to load saved draft.';
          }
        }

        if (resolvedStudentId) {
          snapshot.profileSelectionMode = 'auto';
          snapshot.selectedStudentId = resolvedStudentId;
          snapshot.selectedProfileId = resolveBoundProfileId(resolvedStudentId);
        }

        if (!isCurrentHydration(hydration)) return;

        applyHydratedSnapshot(snapshot);
        setSelectedResumeJobId(status.jobId);
        setPinnedJobExpanded(!isTerminalJobState(status.state));
        setActiveAssignmentSession(null);
        writeResumeTargetToQuery({ jobId: status.jobId });
      } catch (error) {
        if (!isCurrentHydration(hydration)) return;
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
      } finally {
        if (isCurrentHydration(hydration)) {
          setResumeLoading(false);
        }
      }
    },
    [
      applyHydratedSnapshot,
      beginHydration,
      currentProfileSelectionMode,
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
      resolveBoundProfileId,
      resumeJobs,
    ],
  );

  const hydrateFromSession = useCallback(
    async (sessionId: string, knownSessions?: AssignmentSession[]) => {
      if (!sessionId) return;

      const hydration = beginHydration('session');
      invalidateDraftGenerationRequests();
      setResumeLoading(true);
      setResumeError(null);

      try {
        const cachedSession = knownSessions?.find((session) => session.id === sessionId);
        const session = cachedSession ?? (await fetchAssignmentSession(sessionId));
        const snapshot = buildSnapshotFromSession(session);
        let resolvedStudentId = session.studentId ?? null;

        if (session.recordingId) {
          try {
            const resumedRecording = await getRecording(session.recordingId);
            snapshot.recording = resumedRecording;
            snapshot.recordingStatus = resumedRecording.status;
            snapshot.recordingError = resumedRecording.error ?? null;
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
                  resumedRecording.status === 'transcribing' ||
                  resumedRecording.status === 'queued'
                ) {
                  snapshot.transcriptStatus = 'processing';
                  snapshot.transcriptError = null;
                } else {
                  snapshot.transcriptStatus = 'failed';
                  snapshot.transcriptError = message;
                }
              }
            } else if (resumedRecording.status === 'failed') {
              snapshot.transcriptStatus = 'failed';
              snapshot.transcriptError = resumedRecording.error ?? 'Transcription failed.';
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
            snapshot.rerunTargetPronunciationMode = detectPronunciationModeFromDraft(
              resumedDraft.text ?? '',
            );
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            snapshot.authoring.draftError =
              error instanceof Error ? error.message : 'Unable to load saved draft.';
          }
        }

        if (resolvedStudentId) {
          snapshot.profileSelectionMode = 'auto';
          snapshot.selectedStudentId = resolvedStudentId;
          snapshot.selectedProfileId = resolveBoundProfileId(resolvedStudentId);
        }

        if (!isCurrentHydration(hydration)) return;

        applyHydratedSnapshot(snapshot);
        setActiveAssignmentSession(session);
        setSelectedResumeJobId(`session:${session.id}`);
        setPinnedJobExpanded(true);
        writeResumeTargetToQuery({ sessionId: session.id });
      } catch (error) {
        if (!isCurrentHydration(hydration)) return;
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
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
      invalidateDraftGenerationRequests,
      isCurrentHydration,
      resolveBoundProfileId,
    ],
  );

  const handleResumeSelectedJob = useCallback(async () => {
    if (!selectedResumeJobId) return;
    if (selectedResumeJobId.startsWith('session:')) {
      await hydrateFromSession(selectedResumeJobId.slice('session:'.length), assignmentSessions);
    } else {
      await hydrateFromJob(selectedResumeJobId, resumeJobs);
    }
    await loadResumeJobs();
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
        await hydrateFromSession(querySessionId, sessions);
        return;
      }
      if (queryJobId) {
        setSelectedResumeJobId(queryJobId);
        await hydrateFromJob(queryJobId, jobs);
        return;
      }

      setResumeLoading(false);
    };

    void initializeResume();
  }, [hydrateFromJob, hydrateFromSession, loadResumeJobs]);

  return {
    resumeJobs,
    assignmentSessions,
    activeAssignmentSession,
    setActiveAssignmentSession,
    selectedResumeJobId,
    setSelectedResumeJobId,
    resumeLoading,
    resumeError,
    pinnedJobExpanded,
    setPinnedJobExpanded,
    loadResumeJobs,
    handleResumeSelectedJob,
    applyJobStatusTransition,
  };
}
