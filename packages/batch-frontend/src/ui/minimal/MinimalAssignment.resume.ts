import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DraftResponse,
  JobOptionsResponse,
  JobStatus,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
} from '../../utils/api';
import {
  fetchDraft,
  fetchPromptPackage,
  fetchRecordingTranscript,
  getJobStatus,
  getRecording,
  listUserJobs,
} from '../../utils/api';
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

function writeJobIdToQuery(jobId: string | null): void {
  if (globalThis.window === undefined) return;
  const nextUrl = new URL(globalThis.location.href);
  if (jobId) {
    nextUrl.searchParams.set('jobId', jobId);
  } else {
    nextUrl.searchParams.delete('jobId');
  }
  const suffix = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  globalThis.history.replaceState(null, '', suffix);
}

function describeJobFailureReason(job: Pick<JobStatus, 'publishTarget' | 'error'>): string {
  const reason = job.error?.trim();
  if (!reason) {
    return 'Publishing failed. Check service availability and retry.';
  }
  const normalized = reason.toLowerCase();
  if (job.publishTarget === 'anytype' && normalized.includes('fetch failed')) {
    return 'Anytype server unreachable. Start Anytype Desktop app and retry publish.';
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
  return value === 'elevenlabs' || value === 'google';
}

function isUiPublishTtsStrategy(value: string | null | undefined): value is UiPublishTtsStrategy {
  return value === 'auto' || value === 'dialogue' || value === 'tts';
}

export interface HydratedAssignmentSnapshot {
  jobStatus: JobStatus;
  publishTarget: MinimalPublishTarget;
  selectedTtsProvider: UiTtsProvider;
  selectedTtsStrategy: UiPublishTtsStrategy;
  selectedTtsModel: string;
  selectedPreset: string;
  recording: RecordingListItem | null;
  recordingStatus: RecordingStatus | null;
  recordingError: string | null;
  selectedFileName: string | null;
  transcript: RecordingTranscriptResponse | null;
  transcriptText: string;
  transcriptStatus: TranscriptUiStatus;
  transcriptError: string | null;
  promptPackage: PromptPackageResponse | null;
  teacherNotes: string;
  promptText: string;
  promptError: string | null;
  draft: DraftResponse | null;
  draftText: string;
  draftError: string | null;
  rerunTargetPronunciationMode: PronunciationMode | null;
  publishError: string | null;
  selectedStudentId: string;
  selectedProfileId: string;
  profileSelectionMode: 'auto' | 'manual';
  uploadError: string | null;
  uploadCacheNotice: string | null;
  previewHtml: string | null;
  previewError: string | null;
  lastPreviewedDraftHash: string | null;
  validation: null;
  validationError: null;
}

interface UseMinimalAssignmentResumeParams {
  applyHydratedSnapshot: (snapshot: HydratedAssignmentSnapshot) => void;
  applyCurrentJobStatus: (job: JobStatus | null) => void;
  invalidateDraftGenerationRequests: () => void;
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
  const [selectedResumeJobId, setSelectedResumeJobId] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [pinnedJobExpanded, setPinnedJobExpanded] = useState(true);
  const resumeInitializedRef = useRef(false);

  const applyJobStatusTransition = useCallback(
    (job: JobStatus) => {
      applyCurrentJobStatus(job);
      setSelectedResumeJobId(job.jobId);
      setPinnedJobExpanded(!isTerminalJobState(job.state));
      writeJobIdToQuery(job.jobId);
    },
    [applyCurrentJobStatus],
  );

  const loadResumeJobs = useCallback(async (): Promise<JobStatus[]> => {
    try {
      const response = await listUserJobs({
        limit: 20,
        offset: 0,
      });
      const jobs = response.jobs ?? [];
      setResumeJobs(jobs);
      if (jobs.length === 0) {
        setSelectedResumeJobId('');
      } else {
        setSelectedResumeJobId((current) => {
          if (current && jobs.some((job) => job.jobId === current)) {
            return current;
          }
          return (
            jobs.find((job) => isActivelyProcessingJobState(job.state))?.jobId ?? jobs[0]?.jobId ?? ''
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

  const hydrateFromJob = useCallback(
    async (jobId: string, knownJobs?: JobStatus[]) => {
      if (!jobId) return;

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
        let selectedTtsModel = currentSelectedTtsModel;
        if (
          typeof status.studyTextElevenlabsModel === 'string' &&
          status.studyTextElevenlabsModel.trim().length > 0
        ) {
          selectedTtsModel = status.studyTextElevenlabsModel;
        } else if (
          typeof status.googleTtsModel === 'string' &&
          status.googleTtsModel.trim().length > 0
        ) {
          selectedTtsModel = status.googleTtsModel;
        }

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
          publishTarget: status.publishTarget ?? currentPublishTarget,
          selectedTtsProvider,
          selectedTtsStrategy,
          selectedTtsModel,
          selectedPreset,
          recording: null,
          recordingStatus: null,
          recordingError: null,
          selectedFileName: null,
          transcript: null,
          transcriptText: '',
          transcriptStatus: 'idle',
          transcriptError: null,
          promptPackage: null,
          teacherNotes: '',
          promptText: '',
          promptError: null,
          draft: null,
          draftText: '',
          draftError: null,
          rerunTargetPronunciationMode: status.pronunciationMode ?? null,
          publishError:
            status.state === 'failed' && status.error ? describeJobFailureReason(status) : null,
          selectedStudentId: currentSelectedStudentId,
          selectedProfileId: currentSelectedProfileId,
          profileSelectionMode: currentProfileSelectionMode,
          uploadError: null,
          uploadCacheNotice: null,
          previewHtml: null,
          previewError: null,
          lastPreviewedDraftHash: null,
          validation: null,
          validationError: null,
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
            snapshot.promptPackage = resumedPromptPackage;
            snapshot.teacherNotes = resumedPromptPackage.notes ?? '';
            snapshot.promptText = resumedPromptPackage.text ?? '';
            if (!resolvedStudentId && resumedPromptPackage.studentId) {
              resolvedStudentId = resumedPromptPackage.studentId;
            }
          } catch (error) {
            snapshot.promptError =
              error instanceof Error ? error.message : 'Unable to load prompt package.';
          }
        }

        if (status.draftId) {
          try {
            const resumedDraft = await fetchDraft(status.draftId);
            snapshot.draft = resumedDraft;
            snapshot.draftText = resumedDraft.text ?? '';
            snapshot.rerunTargetPronunciationMode = detectPronunciationModeFromDraft(
              resumedDraft.text ?? '',
            );
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            snapshot.draftError =
              error instanceof Error ? error.message : 'Unable to load saved draft.';
          }
        }

        if (resolvedStudentId) {
          snapshot.profileSelectionMode = 'auto';
          snapshot.selectedStudentId = resolvedStudentId;
          snapshot.selectedProfileId = resolveBoundProfileId(resolvedStudentId);
        }

        applyHydratedSnapshot(snapshot);
        setSelectedResumeJobId(status.jobId);
        setPinnedJobExpanded(!isTerminalJobState(status.state));
        writeJobIdToQuery(status.jobId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
      } finally {
        setResumeLoading(false);
      }
    },
    [
      applyHydratedSnapshot,
      currentProfileSelectionMode,
      currentPublishTarget,
      currentSelectedPreset,
      currentSelectedProfileId,
      currentSelectedStudentId,
      currentSelectedTtsModel,
      currentSelectedTtsProvider,
      currentSelectedTtsStrategy,
      invalidateDraftGenerationRequests,
      jobOptions,
      presetOptionIds,
      resolveBoundProfileId,
      resumeJobs,
    ],
  );

  const handleResumeSelectedJob = useCallback(async () => {
    if (!selectedResumeJobId) return;
    await hydrateFromJob(selectedResumeJobId, resumeJobs);
    await loadResumeJobs();
  }, [hydrateFromJob, loadResumeJobs, resumeJobs, selectedResumeJobId]);

  useEffect(() => {
    if (resumeInitializedRef.current) return;
    resumeInitializedRef.current = true;

    const initializeResume = async () => {
      setResumeLoading(true);
      const jobs = await loadResumeJobs();
      const queryJobId = readJobIdFromQuery();
      if (queryJobId) {
        setSelectedResumeJobId(queryJobId);
        await hydrateFromJob(queryJobId, jobs);
        return;
      }

      const candidate = jobs.find((job) => isActivelyProcessingJobState(job.state)) ?? null;
      if (candidate) {
        await hydrateFromJob(candidate.jobId, jobs);
      } else {
        setResumeLoading(false);
      }
    };

    void initializeResume();
  }, [hydrateFromJob, loadResumeJobs]);

  return {
    resumeJobs,
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
