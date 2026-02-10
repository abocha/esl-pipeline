import copy from 'copy-to-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DraftResponse,
  JobOptionsResponse,
  JobProvenanceResponse,
  JobStatus,
  MarkdownValidationResponse,
  ProfileRevisionSummaryResponse,
  PromptOptionsResponse,
  PromptPackageResponse,
  RecordingListItem,
  RecordingStatus,
  RecordingTranscriptResponse,
  StudentOption,
} from '../../utils/api';
import {
  approveJob,
  cancelJob,
  createDraft,
  createPromptPackage,
  fetchDraft,
  fetchJobProvenance,
  fetchStudentOptions,
  fetchJobOptions,
  fetchPromptPackage,
  fetchPromptOptions,
  fetchRecordingTranscript,
  getJobStatus,
  getProfileContent,
  getRecording,
  listUserJobs,
  listProfileContents,
  listProfileRevisions,
  materializeDraft,
  restoreProfileRevision,
  retryRecordingTranscription,
  rerunAudioJob,
  rerunPublishJob,
  upsertProfileContent,
  updateDraft,
  updateRecordingTranscript,
  uploadRecording,
  validateMarkdown,
} from '../../utils/api';
import { DropZone } from '../shared/DropZone';
import { UploadProgress } from '../shared/UploadProgress';

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus'];
const POLL_INTERVAL_MS = 3000;
const TERMINAL_JOB_STATES = new Set<JobStatus['state']>(['succeeded', 'failed']);
const ACTIVE_JOB_STATES = new Set<JobStatus['state']>(['queued', 'running']);

function isTerminalJobState(state: JobStatus['state'] | null | undefined): boolean {
  return state ? TERMINAL_JOB_STATES.has(state) : false;
}

function isActivelyProcessingJobState(state: JobStatus['state'] | null | undefined): boolean {
  return state ? ACTIVE_JOB_STATES.has(state) : false;
}

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

export const MinimalAssignment: React.FC = () => {
  const [recording, setRecording] = useState<RecordingListItem | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [transcript, setTranscript] = useState<RecordingTranscriptResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<
    'idle' | 'loading' | 'processing' | 'ready' | 'failed'
  >('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);

  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [promptPackage, setPromptPackage] = useState<PromptPackageResponse | null>(null);
  const [promptText, setPromptText] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const [draftText, setDraftText] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [validation, setValidation] = useState<MarkdownValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [jobStatus, setJobStatusState] = useState<JobStatus | null>(null);
  const [publishTarget, setPublishTarget] = useState<'notion' | 'anytype' | 'html'>('notion');
  const [jobOptions, setJobOptions] = useState<JobOptionsResponse | null>(null);
  const [jobOptionsError, setJobOptionsError] = useState<string | null>(null);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentOptionsError, setStudentOptionsError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [resumeJobs, setResumeJobs] = useState<JobStatus[]>([]);
  const [selectedResumeJobId, setSelectedResumeJobId] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [pinnedJobExpanded, setPinnedJobExpanded] = useState(true);
  const [uploadCacheNotice, setUploadCacheNotice] = useState<string | null>(null);
  const resumeInitializedRef = useRef(false);

  const [profileOptions, setProfileOptions] = useState<{ id: string; label: string }[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileSelectionMode, setProfileSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [newProfileId, setNewProfileId] = useState('');
  const [profileEditorText, setProfileEditorText] = useState('');
  const [loadedProfileContent, setLoadedProfileContent] = useState('');
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState<'loading' | 'saving' | 'creating' | 'restoring' | null>(
    null,
  );
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState<'rerun' | 'rerun_publish' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);

  const [showRerunAdvanced, setShowRerunAdvanced] = useState(false);
  const [rerunForceTts, setRerunForceTts] = useState(true);
  const [rerunVoiceId, setRerunVoiceId] = useState('');
  const [rerunVoiceAccent, setRerunVoiceAccent] = useState('');
  const [rerunTtsStrategy, setRerunTtsStrategy] = useState<'auto' | 'dialogue' | 'tts'>('auto');
  const [rerunDialogueLanguage, setRerunDialogueLanguage] = useState('');
  const [rerunDialogueStability, setRerunDialogueStability] = useState('');
  const [rerunDialogueSeed, setRerunDialogueSeed] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const loadJobProvenance = useCallback(async (jobId: string) => {
    setJobProvenanceLoading(true);
    setJobProvenanceError(null);
    try {
      const provenance = await fetchJobProvenance(jobId);
      setJobProvenance(provenance);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load job provenance details.';
      setJobProvenanceError(message);
    } finally {
      setJobProvenanceLoading(false);
    }
  }, []);

  const loadResumeJobs = useCallback(async (): Promise<JobStatus[]> => {
    try {
      const response = await listUserJobs({
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      const jobs = response.jobs ?? [];
      setResumeJobs(jobs);
      setSelectedResumeJobId((current) => {
        if (current && jobs.some((job) => job.jobId === current)) return current;
        return jobs[0]?.jobId ?? '';
      });
      setResumeError(null);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent jobs.';
      setResumeError(message);
      setResumeJobs([]);
      setSelectedResumeJobId('');
      return [];
    }
  }, []);

  const resetFlow = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    writeJobIdToQuery(null);
    setRecording(null);
    setRecordingStatus(null);
    setRecordingError(null);
    setTranscript(null);
    setTranscriptText('');
    setTranscriptStatus('idle');
    setTranscriptError(null);
    setTranscriptSaving(false);
    setRetryingTranscript(false);
    setPromptPackage(null);
    setPromptText('');
    setPromptError(null);
    setPromptCopyState('idle');
    setDraft(null);
    setDraftText('');
    setDraftError(null);
    setValidation(null);
    setValidationError(null);
    setValidating(false);
    setPublishing(false);
    setPublishError(null);
    setJobStatusState(null);
    setJobProvenance(null);
    setJobProvenanceError(null);
    setJobProvenanceLoading(false);
    setSelectedFileName(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploading(false);
    setUploadCacheNotice(null);
    setResumeError(null);
    setPinnedJobExpanded(true);
  }, []);

  const loadPromptOptions = useCallback(async () => {
    try {
      const response = await fetchPromptOptions();
      setPromptOptions(response);
      setPromptError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load prompt options.';
      setPromptError(message);
    }
  }, []);

  const loadJobOptions = useCallback(async () => {
    try {
      const response = await fetchJobOptions();
      setJobOptions(response);
      setJobOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load job options.';
      setJobOptionsError(message);
    }
  }, []);

  const loadStudentOptions = useCallback(async () => {
    try {
      const response = await fetchStudentOptions();
      setStudentOptions(response.students ?? []);
      setSelectedStudentId((current) => {
        if (current) return current;
        return response.students.find((student) => student.name === 'Default')?.id ?? '';
      });
      setStudentOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentOptionsError(message);
    }
  }, []);

  const resolveBoundProfileId = useCallback(
    (studentId: string): string =>
      studentOptions.find((student) => student.id === studentId)?.profileId ?? '',
    [studentOptions],
  );

  const loadProfileOptions = useCallback(async () => {
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
      setProfileOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profiles.';
      setProfileOptionsError(message);
    }
  }, []);

  useEffect(() => {
    void loadPromptOptions();
    void loadJobOptions();
    void loadStudentOptions();
    void loadProfileOptions();
  }, [loadJobOptions, loadProfileOptions, loadPromptOptions, loadStudentOptions]);

  const loadSelectedProfile = useCallback(async () => {
    if (!selectedProfileId) {
      setProfileEditorText('');
      setLoadedProfileContent('');
      setProfileRevisions([]);
      setProfileRevisionError(null);
      return;
    }

    setProfileBusy('loading');
    setProfileRevisionError(null);
    try {
      const [profile, revisions] = await Promise.all([
        getProfileContent(selectedProfileId),
        listProfileRevisions(selectedProfileId, { limit: 20, offset: 0, order: 'desc' }),
      ]);
      setProfileEditorText(profile.content ?? '');
      setLoadedProfileContent(profile.content ?? '');
      setProfileRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    void loadSelectedProfile();
  }, [loadSelectedProfile]);

  useEffect(() => {
    if (profileSelectionMode !== 'auto') {
      return;
    }
    if (!selectedStudentId) {
      setSelectedProfileId('');
      return;
    }
    const boundProfileId = resolveBoundProfileId(selectedStudentId);
    setSelectedProfileId((current) => (current === boundProfileId ? current : boundProfileId));
  }, [profileSelectionMode, resolveBoundProfileId, selectedStudentId]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      resetFlow();
      setSelectedFileName(file.name);
      setUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      try {
        const response = await uploadRecording(file, {
          studentId: selectedStudentId || undefined,
          signal: controller.signal,
          onProgress: (progress) => setUploadProgress(progress),
        });
        setRecording(response);
        setRecordingStatus(response.status);
        setRecordingError(response.error ?? null);
        setSelectedFileName(response.displayName || file.name);
        setUploadCacheNotice(
          response.cacheHit
            ? 'Reused an existing transcript for this exact audio file.'
            : null,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          setUploadError('Upload canceled.');
        } else {
          const message = error instanceof Error ? error.message : 'Unable to upload recording.';
          setUploadError(message);
        }
      } finally {
        setUploading(false);
        uploadAbortRef.current = null;
      }
    },
    [resetFlow, selectedStudentId, uploading],
  );

  const hydrateFromJob = useCallback(
    async (jobId: string, knownJobs?: JobStatus[]) => {
      if (!jobId) return;

      setResumeLoading(true);
      setResumeError(null);
      setPublishError(null);
      setActionError(null);
      setActionSuccess(null);
      setUploadError(null);
      setUploadCacheNotice(null);

      try {
        const status = await getJobStatus(jobId);
        setJobStatusState(status);
        setSelectedResumeJobId(status.jobId);
        setPinnedJobExpanded(!isTerminalJobState(status.state));
        writeJobIdToQuery(status.jobId);
        const candidateJobs = knownJobs ?? resumeJobs;
        let resolvedStudentId =
          candidateJobs.find((job) => job.jobId === status.jobId)?.studentId ??
          status.studentId ??
          null;

        if (status.publishTarget) {
          setPublishTarget(status.publishTarget);
        }

        if (status.recordingId) {
          try {
            const resumedRecording = await getRecording(status.recordingId);
            setRecording(resumedRecording);
            setRecordingStatus(resumedRecording.status);
            setRecordingError(resumedRecording.error ?? null);
            setSelectedFileName(resumedRecording.displayName || null);
            if (resumedRecording.studentId) {
              resolvedStudentId = resumedRecording.studentId;
            }

            if (status.transcriptId || resumedRecording.transcriptId || resumedRecording.status === 'transcribed') {
              try {
                const resumedTranscript = await fetchRecordingTranscript(resumedRecording.recordingId);
                setTranscript(resumedTranscript);
                setTranscriptText(resumedTranscript.text ?? '');
                setTranscriptStatus('ready');
                setTranscriptError(null);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Unable to load transcript.';
                if (resumedRecording.status === 'transcribing' || resumedRecording.status === 'queued') {
                  setTranscriptStatus('processing');
                  setTranscriptError(null);
                } else {
                  setTranscriptStatus('failed');
                  setTranscriptError(message);
                }
              }
            } else if (resumedRecording.status === 'failed') {
              setTranscriptStatus('failed');
              setTranscriptError(resumedRecording.error ?? 'Transcription failed.');
            } else {
              setTranscript(null);
              setTranscriptText('');
              setTranscriptStatus('processing');
              setTranscriptError(null);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load recording.';
            setRecording(null);
            setRecordingStatus(null);
            setRecordingError(message);
            setTranscript(null);
            setTranscriptText('');
            setTranscriptStatus('failed');
            setTranscriptError(message);
          }
        } else {
          setRecording(null);
          setRecordingStatus(null);
          setRecordingError(null);
          setTranscript(null);
          setTranscriptText('');
          setTranscriptStatus('idle');
          setTranscriptError(null);
        }

        if (status.promptPackageId) {
          try {
            const resumedPromptPackage = await fetchPromptPackage(status.promptPackageId);
            setPromptPackage(resumedPromptPackage);
            setPromptText(resumedPromptPackage.text ?? '');
            setPromptError(null);
            if (!resolvedStudentId && resumedPromptPackage.studentId) {
              resolvedStudentId = resumedPromptPackage.studentId;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load prompt package.';
            setPromptPackage(null);
            setPromptText('');
            setPromptError(message);
          }
        } else {
          setPromptPackage(null);
          setPromptText('');
          setPromptError(null);
        }

        if (status.draftId) {
          try {
            const resumedDraft = await fetchDraft(status.draftId);
            setDraft(resumedDraft);
            setDraftText(resumedDraft.text ?? '');
            setDraftError(null);
            if (!resolvedStudentId && resumedDraft.studentId) {
              resolvedStudentId = resumedDraft.studentId;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load saved draft.';
            setDraft(null);
            setDraftText('');
            setDraftError(message);
          }
        } else {
          setDraft(null);
          setDraftText('');
          setDraftError(null);
        }

        setValidation(null);
        setValidationError(null);
        if (status.state === 'failed' && status.error) {
          setPublishError(describeJobFailureReason(status));
        }
        if (resolvedStudentId) {
          setProfileSelectionMode('auto');
          setSelectedStudentId(resolvedStudentId);
          setSelectedProfileId(resolveBoundProfileId(resolvedStudentId));
        }
        void loadJobProvenance(status.jobId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to resume the selected assignment.';
        setResumeError(message);
      } finally {
        setResumeLoading(false);
      }
    },
    [loadJobProvenance, resolveBoundProfileId, resumeJobs],
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

      const candidate = jobs.find((job) => !isTerminalJobState(job.state)) ?? jobs[0] ?? null;
      if (candidate) {
        await hydrateFromJob(candidate.jobId, jobs);
      } else {
        setResumeLoading(false);
      }
    };

    void initializeResume();
  }, [hydrateFromJob, loadResumeJobs]);

  const handleFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    void handleUpload(file);
  };

  const handleCancelUpload = () => {
    if (!uploadAbortRef.current) return;
    uploadAbortRef.current.abort();
  };

  const loadTranscript = useCallback(async () => {
    if (!recording?.recordingId) return;
    setTranscriptStatus('loading');
    setTranscriptError(null);

    try {
      const response = await fetchRecordingTranscript(recording.recordingId);
      setTranscript(response);
      setTranscriptText(response.text ?? '');
      setTranscriptStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load transcript.';
      if (recordingStatus && recordingStatus !== 'transcribed') {
        setTranscriptStatus('processing');
        setTranscriptError(null);
      } else {
        setTranscriptStatus('failed');
        setTranscriptError(message);
      }
    }
  }, [recording?.recordingId, recordingStatus]);

  useEffect(() => {
    if (!recording?.recordingId) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const pollRecording = async () => {
      try {
        const updated = await getRecording(recording.recordingId);
        if (!active) return;
        setRecording(updated);
        setRecordingStatus(updated.status);
        setRecordingError(updated.error ?? null);
        if (updated.status === 'transcribed' && !transcript?.transcriptId) {
          void loadTranscript();
        }
        if (updated.status === 'failed') {
          setTranscriptStatus('failed');
          setTranscriptError(updated.error ?? 'Transcription failed.');
        }
        if (updated.status === 'transcribed' || updated.status === 'failed') {
          if (interval) clearInterval(interval);
          interval = null;
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Unable to refresh recording status.';
        setRecordingError(message);
      }
    };

    void pollRecording();
    interval = setInterval(pollRecording, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [recording?.recordingId, loadTranscript, transcript?.transcriptId]);

  useEffect(() => {
    if (transcriptText.trim()) {
      setTranscriptStatus('ready');
      setTranscriptError(null);
    }
  }, [transcriptText]);

  const transcriptDirty = useMemo(() => {
    const original = transcript?.text ?? '';
    return transcriptText.trim() !== original.trim();
  }, [transcript?.text, transcriptText]);

  const handleSaveTranscript = async () => {
    if (!recording?.recordingId) return;
    setTranscriptSaving(true);
    setTranscriptError(null);
    try {
      const response = await updateRecordingTranscript(
        recording.recordingId,
        transcriptText.trim(),
      );
      setTranscript(response);
      setTranscriptText(response.text ?? transcriptText.trim());
      setTranscriptStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save transcript.';
      setTranscriptError(message);
    } finally {
      setTranscriptSaving(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!recording?.recordingId) return;
    setRetryingTranscript(true);
    setTranscriptError(null);
    try {
      const updated = await retryRecordingTranscription(recording.recordingId);
      setRecording(updated);
      setRecordingStatus(updated.status);
      setRecordingError(updated.error ?? null);
      setTranscriptStatus('processing');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retry transcription.';
      setTranscriptError(message);
    } finally {
      setRetryingTranscript(false);
    }
  };

  const selectedTemplateId = useMemo(() => {
    if (!promptOptions) return '';
    return promptOptions.defaults.templateId ?? promptOptions.templates?.[0]?.id ?? '';
  }, [promptOptions]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) ?? null,
    [studentOptions, selectedStudentId],
  );

  const handleStudentSelectionChange = useCallback(
    (nextStudentId: string) => {
      setProfileSelectionMode('auto');
      setSelectedStudentId(nextStudentId);
      if (!nextStudentId) {
        setSelectedProfileId('');
        return;
      }
      setSelectedProfileId(resolveBoundProfileId(nextStudentId));
    },
    [resolveBoundProfileId],
  );

  const profileDirty = useMemo(
    () => profileEditorText.trim() !== loadedProfileContent.trim(),
    [loadedProfileContent, profileEditorText],
  );

  const handleCreateProfile = async () => {
    const candidate = newProfileId.trim();
    if (!candidate) {
      setProfileRevisionError('Profile ID is required (for example: profiles/new-student.md).');
      return;
    }

    setProfileBusy('creating');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const created = await upsertProfileContent(candidate, profileEditorText);
      await loadProfileOptions();
      setProfileSelectionMode('manual');
      setSelectedProfileId(created.id);
      setNewProfileId('');
      setProfileSuccess(`Created profile ${created.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedProfileId) {
      setProfileRevisionError('Select a profile to save.');
      return;
    }

    setProfileBusy('saving');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const saved = await upsertProfileContent(selectedProfileId, profileEditorText);
      setLoadedProfileContent(saved.content);
      const revisions = await listProfileRevisions(saved.id, { limit: 20, offset: 0, order: 'desc' });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess(`Saved ${saved.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!selectedProfileId || !revisionId) return;

    setProfileBusy('restoring');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const restored = await restoreProfileRevision(selectedProfileId, revisionId);
      setProfileEditorText(restored.content);
      setLoadedProfileContent(restored.content);
      const revisions = await listProfileRevisions(restored.id, { limit: 20, offset: 0, order: 'desc' });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess('Profile restored from revision.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to restore profile revision.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!recording?.recordingId) {
      setPromptError('Upload a recording first.');
      return;
    }
    if (!selectedTemplateId) {
      setPromptError('Prompt template defaults are missing. Check prompt templates in settings.');
      return;
    }
    if (transcriptStatus !== 'ready') {
      setPromptError('Transcript is not ready yet.');
      return;
    }

    setPromptLoading(true);
    setPromptError(null);
    try {
      const response = await createPromptPackage(recording.recordingId, {
        templateId: selectedTemplateId,
        profileId: selectedProfileId || undefined,
      });
      setPromptPackage(response);
      setPromptText(response.text ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate prompt.';
      setPromptError(message);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleCopyPrompt = () => {
    if (!promptText.trim()) return;
    const success = copy(promptText);
    setPromptCopyState(success ? 'copied' : 'error');
    setTimeout(() => setPromptCopyState('idle'), 2000);
  };

  const draftDirty = useMemo(() => {
    const original = draft?.text ?? '';
    return draftText.trim() !== original.trim();
  }, [draft?.text, draftText]);

  const runValidation = async () => {
    if (!draftText.trim()) {
      setValidation(null);
      setValidationError(null);
      return { ok: false } as MarkdownValidationResponse;
    }
    setValidating(true);
    setValidationError(null);
    try {
      const response = await validateMarkdown(draftText.trim(), true);
      setValidation(response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate markdown.';
      setValidationError(message);
      return { ok: false, errors: [message], warnings: [] } as MarkdownValidationResponse;
    } finally {
      setValidating(false);
    }
  };

  const handleSaveDraft = async (): Promise<DraftResponse | null> => {
    if (!promptPackage?.id) {
      setDraftError('Generate a prompt package first.');
      return null;
    }
    if (!draftText.trim()) {
      setDraftError('Paste the assignment draft text first.');
      return null;
    }

    const validationResult = await runValidation();
    if (validationResult.errors && validationResult.errors.length > 0) {
      setDraftError('Fix validation errors before saving.');
      return null;
    }

    setDraftError(null);
    try {
      const response = draft?.id
        ? await updateDraft(draft.id, draftText.trim())
        : await createDraft(promptPackage.id, draftText.trim());
      setDraft(response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save draft.';
      setDraftError(message);
      return null;
    }
  };

  const handlePublish = async () => {
    setPublishError(null);
    setPublishing(true);

    try {
      let savedDraft = draft;
      if (!savedDraft || draftDirty) {
        savedDraft = await handleSaveDraft();
      }
      if (!savedDraft) {
        setPublishing(false);
        return;
      }

      const materialized = await materializeDraft(savedDraft.id, {
        ...(jobStatus?.jobId ? { jobId: jobStatus.jobId } : {}),
        jobOverrides: {
          publishTarget,
        },
      });
      await approveJob(materialized.jobId, {
        md: materialized.mdPath,
        mdStorageUri: materialized.mdStorageUri,
      });
      const refreshed = await getJobStatus(materialized.jobId);
      setJobStatusState(refreshed);
      setSelectedResumeJobId(refreshed.jobId);
      setPinnedJobExpanded(!isTerminalJobState(refreshed.state));
      writeJobIdToQuery(refreshed.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to publish assignment.';
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    if (!jobStatus?.jobId || !isActivelyProcessingJobState(jobStatus.state)) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const refreshed = await getJobStatus(jobStatus.jobId);
        if (!active) return;
        setJobStatusState(refreshed);
        if (!isActivelyProcessingJobState(refreshed.state)) {
          clearInterval(interval);
          void loadResumeJobs();
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unable to refresh job status.';
        setPublishError(message);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobStatus?.jobId, jobStatus?.state, loadResumeJobs]);

  useEffect(() => {
    setActionBusy(null);
    setActionError(null);
    setActionSuccess(null);
    setShowRerunAdvanced(false);
    setCancelReason('');
  }, [jobStatus?.jobId]);

  useEffect(() => {
    if (!jobStatus) return;
    setSelectedResumeJobId((current) => current || jobStatus.jobId);
    if (isTerminalJobState(jobStatus.state)) {
      setPinnedJobExpanded(false);
      if (jobStatus.state === 'failed' && jobStatus.error) {
        setPublishError(describeJobFailureReason(jobStatus));
      }
    }
  }, [jobStatus]);

  useEffect(() => {
    if (!jobStatus?.jobId) {
      setJobProvenance(null);
      setJobProvenanceError(null);
      setJobProvenanceLoading(false);
      return;
    }
    void loadJobProvenance(jobStatus.jobId);
  }, [jobStatus?.jobId, loadJobProvenance]);

  const handleRerunAudio = async () => {
    if (!jobStatus?.jobId) return;

    const stabilityInput = rerunDialogueStability.trim();
    const seedInput = rerunDialogueSeed.trim();
    const payload: Parameters<typeof rerunAudioJob>[1] = {
      forceTts: rerunForceTts,
      ttsStrategy: rerunTtsStrategy,
    };

    if (rerunVoiceId.trim()) {
      payload.voiceId = rerunVoiceId.trim();
    }
    if (rerunVoiceAccent.trim()) {
      payload.voiceAccent = rerunVoiceAccent.trim();
    }
    if (rerunDialogueLanguage.trim()) {
      payload.dialogueLanguage = rerunDialogueLanguage.trim();
    }
    if (stabilityInput) {
      const parsed = Number(stabilityInput);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
        setActionError('Dialogue stability must be a number between 0 and 1.');
        return;
      }
      payload.dialogueStability = parsed;
    }
    if (seedInput) {
      const parsed = Number(seedInput);
      if (!Number.isInteger(parsed)) {
        setActionError('Dialogue seed must be an integer.');
        return;
      }
      payload.dialogueSeed = parsed;
    }

    setActionBusy('rerun');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await rerunAudioJob(jobStatus.jobId, payload);
      setActionSuccess(result.message ?? 'Audio rerun queued.');
      const nextJobId = result.jobId || jobStatus.jobId;
      const refreshed = await getJobStatus(nextJobId);
      setJobStatusState(refreshed);
      setSelectedResumeJobId(refreshed.jobId);
      setPinnedJobExpanded(!isTerminalJobState(refreshed.state));
      writeJobIdToQuery(refreshed.jobId);
      await loadJobProvenance(refreshed.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to rerun audio.';
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRerunPublish = async () => {
    if (!jobStatus?.jobId) return;

    setActionBusy('rerun_publish');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await rerunPublishJob(jobStatus.jobId);
      setActionSuccess(result.message ?? 'Publish rerun queued.');
      const nextJobId = result.jobId || jobStatus.jobId;
      const refreshed = await getJobStatus(nextJobId);
      setJobStatusState(refreshed);
      setSelectedResumeJobId(refreshed.jobId);
      setPinnedJobExpanded(!isTerminalJobState(refreshed.state));
      writeJobIdToQuery(refreshed.jobId);
      await loadJobProvenance(refreshed.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to rerun publish.';
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancelJob = async () => {
    if (!jobStatus?.jobId) return;

    const trimmedReason = cancelReason.trim();
    setActionBusy('cancel');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await cancelJob(
        jobStatus.jobId,
        trimmedReason ? { reason: trimmedReason } : undefined,
      );
      setActionSuccess(result.message ?? 'Job cancellation requested.');
      const refreshed = await getJobStatus(jobStatus.jobId);
      setJobStatusState(refreshed);
      await loadJobProvenance(jobStatus.jobId);
      await loadResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel job.';
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  };

  const transcriptReady = transcriptStatus === 'ready' && transcriptText.trim().length > 0;
  const promptReady = promptPackage?.id && promptText.trim().length > 0;
  const jobReady = jobStatus?.jobId;
  const selectedResumeJob = useMemo(
    () => resumeJobs.find((job) => job.jobId === selectedResumeJobId) ?? null,
    [resumeJobs, selectedResumeJobId],
  );
  const studentNameById = useMemo(
    () => new Map(studentOptions.map((student) => [student.id, student.name])),
    [studentOptions],
  );
  const describeResumeJobStudent = useCallback(
    (job: JobStatus): string => {
      if (!job.studentId) {
        return 'No student';
      }
      return studentNameById.get(job.studentId) ?? `Student ${job.studentId.slice(0, 8)}`;
    },
    [studentNameById],
  );
  const formatResumeJobLabel = useCallback(
    (job: JobStatus): string =>
      `${job.jobId.slice(0, 8)} • ${job.state} • ${describeResumeJobStudent(job)} • ${new Date(
        job.createdAt,
      ).toLocaleString()}`,
    [describeResumeJobStudent],
  );
  const canPublish = promptReady && draftText.trim().length > 0 && !publishing;
  const jobPublishTarget = jobStatus?.publishTarget ?? publishTarget;
  const publishUrl =
    jobPublishTarget === 'anytype'
      ? jobStatus?.anytypeUrl ?? jobStatus?.htmlUrl
      : jobPublishTarget === 'html'
        ? jobStatus?.htmlUrl
        : jobStatus?.notionUrl;
  const publishLabel =
    jobPublishTarget === 'anytype'
      ? 'Open published page'
      : jobPublishTarget === 'html'
        ? 'Open published HTML'
        : 'Open in Notion';
  const publishPending =
    jobPublishTarget === 'anytype'
      ? 'Publish link pending...'
      : jobPublishTarget === 'html'
        ? 'HTML link pending...'
        : 'Notion link pending...';
  const actionCapabilities = jobOptions?.supportedActions ?? [];
  const rerunImplemented =
    actionCapabilities.find((capability) => capability.type === 'rerun_audio')?.implemented ??
    false;
  const rerunPublishImplemented =
    actionCapabilities.find((capability) => capability.type === 'rerun_publish')?.implemented ??
    false;
  const cancelImplemented =
    actionCapabilities.find((capability) => capability.type === 'cancel')?.implemented ?? false;
  const cancelAllowedState = jobStatus?.state === 'queued' || jobStatus?.state === 'running';
  const rerunEnabled = Boolean(jobStatus?.jobId) && rerunImplemented && actionBusy === null;
  const rerunPublishEnabled =
    Boolean(jobStatus?.jobId) && rerunPublishImplemented && actionBusy === null;
  const cancelEnabled =
    Boolean(jobStatus?.jobId) && cancelImplemented && cancelAllowedState && actionBusy === null;

  return (
    <div className="minimal-assignment">
      <section className="minimal-section minimal-section-compact">
        <div className="minimal-section-header">
          <h2>0. Resume workflow</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadResumeJobs()}
              disabled={resumeLoading}
            >
              {resumeLoading ? 'Refreshing...' : 'Refresh jobs'}
            </button>
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleResumeSelectedJob()}
              disabled={!selectedResumeJobId || resumeLoading}
            >
              Resume selected
            </button>
          </div>
        </div>
        <label className="minimal-select">
          Recent jobs
          <select
            value={selectedResumeJobId}
            onChange={(event) => setSelectedResumeJobId(event.target.value)}
            disabled={resumeJobs.length === 0 || resumeLoading}
          >
            {resumeJobs.length === 0 ? <option value="">No saved jobs yet</option> : null}
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
            Selected job target: {selectedResumeJob.jobId} ({selectedResumeJob.state} •{' '}
            {describeResumeJobStudent(selectedResumeJob)})
          </p>
        ) : null}
        {jobStatus?.jobId ? (
          <div className="minimal-pinned-job">
            <div className="minimal-section-header">
              <div className="minimal-meta">
                <span>Pinned job: {jobStatus.jobId}</span>
                <span>State: {jobStatus.state}</span>
              </div>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => setPinnedJobExpanded((current) => !current)}
              >
                {pinnedJobExpanded ? 'Collapse details' : 'Expand details'}
              </button>
            </div>
            {pinnedJobExpanded ? (
              <div className="minimal-inline">
                {publishUrl ? (
                  <a href={publishUrl} target="_blank" rel="noreferrer">
                    {publishLabel}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleRerunAudio()}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Rerun audio'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleRerunPublish()}
                  disabled={!rerunPublishEnabled}
                >
                  {actionBusy === 'rerun_publish' ? 'Queuing publish...' : 'Rerun publish'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleCancelJob()}
                  disabled={!cancelEnabled}
                >
                  {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>1. Upload recording</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadStudentOptions()}
            >
              Refresh students
            </button>
            <button type="button" className="minimal-secondary" onClick={resetFlow}>
              Start new
            </button>
          </div>
        </div>
        <p className="minimal-help">Upload an audio recording to start the assignment pipeline.</p>
        <label className="minimal-select">
          Student (optional)
          <select
            value={selectedStudentId}
            onChange={(event) => handleStudentSelectionChange(event.target.value)}
          >
            <option value="">No explicit student (fallback to Default profile)</option>
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
        <DropZone
          title={uploading ? 'Uploading...' : 'Drop audio file'}
          description="Drag a recording here or click to browse"
          hint="Single file upload"
          accept={{ 'audio/*': AUDIO_EXTENSIONS }}
          multiple={false}
          disabled={uploading}
          onFiles={handleFiles}
        />
        {uploading ? (
          <UploadProgress
            fileName={selectedFileName}
            progress={uploadProgress}
            onCancel={handleCancelUpload}
          />
        ) : null}
        {uploadError ? <p className="minimal-error">{uploadError}</p> : null}
        {uploadCacheNotice ? <p className="minimal-success">{uploadCacheNotice}</p> : null}
        {recording ? (
          <div className="minimal-meta">
            <span>Recording ID: {recording.recordingId}</span>
            <span>Status: {recordingStatus ?? 'unknown'}</span>
            {selectedStudent ? <span>Student: {selectedStudent.name}</span> : null}
          </div>
        ) : null}
        {recordingError ? <p className="minimal-error">{recordingError}</p> : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>2. Transcript</h2>
          <button
            type="button"
            className="minimal-secondary"
            onClick={() => void loadTranscript()}
            disabled={!recording?.recordingId || transcriptStatus === 'loading'}
          >
            Refresh
          </button>
        </div>
        {recording ? (
          transcriptStatus === 'processing' || transcriptStatus === 'idle' ? (
            <p className="minimal-help">
              Transcription in progress. We check every few seconds automatically.
            </p>
          ) : null
        ) : (
          <p className="minimal-help">Upload a recording to begin transcription.</p>
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
              onClick={() => void handleRetryTranscription()}
              disabled={retryingTranscript}
            >
              {retryingTranscript ? 'Retrying...' : 'Retry transcription'}
            </button>
          </div>
        ) : null}
        {transcriptReady ? (
          <div className="minimal-block">
            <textarea
              aria-label="Transcript text"
              value={transcriptText}
              onChange={(event) => setTranscriptText(event.target.value)}
              rows={10}
            />
            <div className="minimal-inline">
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void handleSaveTranscript()}
                disabled={!transcriptDirty || transcriptSaving}
              >
                {transcriptSaving ? 'Saving...' : 'Save transcript edits'}
              </button>
              {transcriptDirty ? <span className="minimal-muted">Unsaved edits</span> : null}
            </div>
            {transcriptError ? <p className="minimal-error">{transcriptError}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>3. Profiles</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-secondary"
              onClick={() => void loadProfileOptions()}
              disabled={profileBusy !== null}
            >
              Refresh profiles
            </button>
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleSaveProfile()}
              disabled={!selectedProfileId || profileBusy !== null || !profileDirty}
            >
              {profileBusy === 'saving' ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </div>
        <p className="minimal-help">
          Edit profile text used for prompt generation. Every save creates an append-only revision
          snapshot.
        </p>
        <label className="minimal-select">
          Profile
          <select
            value={selectedProfileId}
            onChange={(event) => {
              const nextProfileId = event.target.value;
              if (!nextProfileId) {
                setProfileSelectionMode('auto');
                setSelectedProfileId(
                  selectedStudentId ? resolveBoundProfileId(selectedStudentId) : '',
                );
                return;
              }
              setProfileSelectionMode('manual');
              setSelectedProfileId(nextProfileId);
            }}
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
            <span>Create profile ID</span>
            <input
              value={newProfileId}
              onChange={(event) => setNewProfileId(event.target.value)}
              placeholder="profiles/new-student.md"
            />
          </label>
          <button
            type="button"
            className="minimal-secondary"
            onClick={() => void handleCreateProfile()}
            disabled={profileBusy !== null}
          >
            {profileBusy === 'creating' ? 'Creating...' : 'Create profile'}
          </button>
        </div>
        <textarea
          aria-label="Profile content"
          value={profileEditorText}
          onChange={(event) => setProfileEditorText(event.target.value)}
          rows={10}
          placeholder="Profile content..."
          disabled={!selectedProfileId && !newProfileId.trim()}
        />
        {profileDirty ? <p className="minimal-muted">Unsaved profile edits</p> : null}
        {profileOptionsError ? <p className="minimal-error">{profileOptionsError}</p> : null}
        {profileRevisionError ? <p className="minimal-error">{profileRevisionError}</p> : null}
        {profileSuccess ? <p className="minimal-success">{profileSuccess}</p> : null}
        {selectedProfileId ? (
          <div className="minimal-block">
            <p className="minimal-muted">Recent revisions</p>
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
                      onClick={() => void handleRestoreRevision(revision.id)}
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
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>4. Prompt</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleGeneratePrompt()}
              disabled={!transcriptReady || promptLoading || !promptOptions}
            >
              {promptLoading
                ? 'Generating...'
                : promptReady
                  ? 'Regenerate prompt'
                  : 'Generate prompt'}
            </button>
            <button
              type="button"
              className="minimal-secondary"
              onClick={handleCopyPrompt}
              disabled={!promptText.trim()}
            >
              {promptCopyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
            {promptOptions ? null : (
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => void loadPromptOptions()}
              >
                Reload prompts
              </button>
            )}
          </div>
        </div>
        <p className="minimal-help">
          Uses the default template and applies the selected profile when provided.
        </p>
        {promptError ? <p className="minimal-error">{promptError}</p> : null}
        {promptPackage?.profileDrift?.detected ? (
          <div className="minimal-alert warning">
            <strong>Profile drift detected</strong>
            <p className="minimal-help">
              The profile changed after this prompt package was created ({promptPackage.profileDrift.reason}
              ). Regenerate the prompt to use the latest profile.
            </p>
          </div>
        ) : null}
        {promptText ? (
          <textarea
            aria-label="Prompt text"
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            rows={12}
          />
        ) : (
          <p className="minimal-muted">Generate a prompt to continue.</p>
        )}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>5. Draft</h2>
          <div className="minimal-inline">
            <button
              type="button"
              className="minimal-primary"
              onClick={() => void handleSaveDraft()}
              disabled={!promptReady || validating}
            >
              {validating ? 'Validating...' : draft ? 'Save draft' : 'Save draft'}
            </button>
            {draftDirty ? <span className="minimal-muted">Unsaved changes</span> : null}
          </div>
        </div>
        <p className="minimal-help">Paste the assignment markdown from your LLM.</p>
        <textarea
          aria-label="Draft markdown"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
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
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>6. Publish</h2>
          <button
            type="button"
            className="minimal-primary"
            onClick={() => void handlePublish()}
            disabled={!canPublish}
          >
            {publishing ? 'Publishing...' : 'Publish assignment'}
          </button>
        </div>
        <label className="minimal-select">
          Publish to
          <select
            value={publishTarget}
            onChange={(event) =>
              setPublishTarget(event.target.value as 'notion' | 'anytype' | 'html')
            }
          >
            <option value="notion">Notion</option>
            <option value="anytype">Anytype</option>
            <option value="html">HTML page</option>
          </select>
        </label>
        <p className="minimal-help">Publishes the markdown as a job and approves it.</p>
        {publishError ? <p className="minimal-error">{publishError}</p> : null}
        {jobStatus?.state === 'failed' && jobStatus.error ? (
          <p className="minimal-error">{describeJobFailureReason(jobStatus)}</p>
        ) : null}
        {jobReady ? (
          <div className="minimal-meta">
            <span>Job ID: {jobStatus?.jobId}</span>
            <span>Status: {jobStatus?.state}</span>
            {publishUrl ? (
              <a href={publishUrl} target="_blank" rel="noreferrer">
                {publishLabel}
              </a>
            ) : (
              <span className="minimal-muted">{publishPending}</span>
            )}
          </div>
        ) : null}
      </section>

      <section className="minimal-section">
        <div className="minimal-section-header">
          <h2>7. Job actions</h2>
          <button type="button" className="minimal-secondary" onClick={() => void loadJobOptions()}>
            Refresh actions
          </button>
        </div>
        {jobReady ? (
          <>
            <p className="minimal-help">
              Rerun audio generation, rerun publish only, or cancel active jobs. Availability is
              driven by backend capabilities.
            </p>
            <div className="minimal-meta">
              <span>Job ID: {jobStatus?.jobId}</span>
              <span>State: {jobStatus?.state}</span>
            </div>
            <div className="minimal-action-row">
              <div className="minimal-action-card">
                <div className="minimal-inline">
                  <button
                    type="button"
                    className="minimal-primary"
                    onClick={() => void handleRerunPublish()}
                    disabled={!rerunPublishEnabled}
                  >
                    {actionBusy === 'rerun_publish' ? 'Queuing publish...' : 'Rerun publish'}
                  </button>
                </div>
                <p className="minimal-help">
                  Re-run publish stage and reuse existing audio artifacts when available.
                </p>
              </div>
            </div>
            <div className="minimal-block">
              <div className="minimal-inline">
                <button
                  type="button"
                  className="minimal-primary"
                  onClick={() => void handleRerunAudio()}
                  disabled={!rerunEnabled}
                >
                  {actionBusy === 'rerun' ? 'Queuing rerun...' : 'Rerun audio'}
                </button>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => setShowRerunAdvanced((current) => !current)}
                >
                  {showRerunAdvanced ? 'Hide advanced' : 'Show advanced rerun'}
                </button>
              </div>
              {showRerunAdvanced ? (
                <div className="minimal-grid">
                  <label className="minimal-field">
                    <span>Voice ID</span>
                    <input
                      value={rerunVoiceId}
                      onChange={(event) => setRerunVoiceId(event.target.value)}
                      placeholder="voice id override"
                    />
                  </label>
                  <label className="minimal-field">
                    <span>Voice Accent</span>
                    <input
                      value={rerunVoiceAccent}
                      onChange={(event) => setRerunVoiceAccent(event.target.value)}
                      placeholder="accent override"
                    />
                  </label>
                  <label className="minimal-field">
                    <span>TTS strategy</span>
                    <select
                      value={rerunTtsStrategy}
                      onChange={(event) =>
                        setRerunTtsStrategy(event.target.value as 'auto' | 'dialogue' | 'tts')
                      }
                    >
                      {jobOptions?.ttsStrategies?.length
                        ? jobOptions.ttsStrategies.map((strategy) => (
                            <option key={strategy} value={strategy}>
                              {strategy}
                            </option>
                          ))
                        : ['auto', 'dialogue', 'tts'].map((strategy) => (
                            <option key={strategy} value={strategy}>
                              {strategy}
                            </option>
                          ))}
                    </select>
                  </label>
                  <label className="minimal-field">
                    <span>Dialogue language</span>
                    <input
                      value={rerunDialogueLanguage}
                      onChange={(event) => setRerunDialogueLanguage(event.target.value)}
                      placeholder="e.g. es"
                    />
                  </label>
                  <label className="minimal-field">
                    <span>Dialogue stability (0..1)</span>
                    <input
                      value={rerunDialogueStability}
                      onChange={(event) => setRerunDialogueStability(event.target.value)}
                      placeholder="0.42"
                    />
                  </label>
                  <label className="minimal-field">
                    <span>Dialogue seed (integer)</span>
                    <input
                      value={rerunDialogueSeed}
                      onChange={(event) => setRerunDialogueSeed(event.target.value)}
                      placeholder="7"
                    />
                  </label>
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={rerunForceTts}
                      onChange={(event) => setRerunForceTts(event.target.checked)}
                    />
                    <span>Force TTS regeneration</span>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="minimal-block">
              <div className="minimal-inline">
                <label className="minimal-field grow">
                  <span>Cancel reason (optional)</span>
                  <input
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    placeholder="reason for cancellation"
                  />
                </label>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void handleCancelJob()}
                  disabled={!cancelEnabled}
                >
                  {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
              {!cancelAllowedState && jobStatus ? (
                <p className="minimal-muted">Cancel is only available for queued or running jobs.</p>
              ) : null}
            </div>
            {jobOptionsError ? <p className="minimal-error">{jobOptionsError}</p> : null}
            {!rerunImplemented || !rerunPublishImplemented || !cancelImplemented ? (
              <p className="minimal-muted">
                Some actions are unavailable because backend capability metadata does not mark them as
                implemented.
              </p>
            ) : null}
            {actionError ? <p className="minimal-error">{actionError}</p> : null}
            {actionSuccess ? <p className="minimal-success">{actionSuccess}</p> : null}
            <div className="minimal-block">
              <div className="minimal-section-header">
                <p className="minimal-help">Assignment provenance and lineage</p>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => jobStatus?.jobId && void loadJobProvenance(jobStatus.jobId)}
                  disabled={jobProvenanceLoading}
                >
                  {jobProvenanceLoading ? 'Refreshing...' : 'Refresh provenance'}
                </button>
              </div>
              {jobProvenanceError ? <p className="minimal-error">{jobProvenanceError}</p> : null}
              {jobProvenance ? (
                <>
                  <div className="minimal-meta">
                    <span>Source job: {jobProvenance.job.sourceJobId ?? 'none'}</span>
                    <span>Prompt package: {jobProvenance.promptPackage?.id ?? 'none'}</span>
                    <span>Draft: {jobProvenance.draft?.id ?? 'none'}</span>
                  </div>
                  {jobProvenance.lineage?.profile?.snapshot?.revisionId ||
                  jobProvenance.lineage?.template?.snapshot?.revisionId ? (
                    <div className="minimal-meta">
                      <span>
                        Profile revision:{' '}
                        {jobProvenance.lineage?.profile?.snapshot?.revisionId ?? 'unknown'}
                      </span>
                      <span>
                        Template revision:{' '}
                        {jobProvenance.lineage?.template?.snapshot?.revisionId ?? 'unknown'}
                      </span>
                    </div>
                  ) : null}
                  {jobProvenance.lineage?.bindingAtCreation ? (
                    <div className="minimal-meta">
                      <span>
                        Bound profile at creation:{' '}
                        {jobProvenance.lineage.bindingAtCreation.profileId}
                      </span>
                      <span>
                        Bound from:{' '}
                        {new Date(jobProvenance.lineage.bindingAtCreation.effectiveFrom).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {jobProvenance.actions.length > 0 ? (
                    <div className="minimal-list">
                      {jobProvenance.actions.slice(0, 6).map((event) => (
                        <div key={event.id} className="minimal-list-item">
                          <span>
                            {event.actionType} • {event.outcome} •{' '}
                            {new Date(event.requestedAt).toLocaleString()}
                          </span>
                          <span className="minimal-muted">{event.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="minimal-muted">No action audit events yet.</p>
                  )}
                </>
              ) : (
                <p className="minimal-muted">Provenance details will appear once loaded.</p>
              )}
            </div>
          </>
        ) : (
          <p className="minimal-help">Publish once to create a job, then actions become available.</p>
        )}
      </section>

      <style>{`
        .minimal-assignment {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .minimal-section {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-5);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .minimal-section-compact {
          gap: var(--space-2);
        }

        .minimal-pinned-job {
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .minimal-section h2 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .minimal-help {
          margin: 0;
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .minimal-muted {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .minimal-success {
          margin: 0;
          color: #0f8b4c;
          font-size: var(--text-sm);
        }

        .minimal-primary,
        .minimal-secondary {
          padding: var(--space-2) var(--space-4);
          border-radius: var(--radius-full);
          font-size: var(--text-sm);
          cursor: pointer;
          border: 1px solid transparent;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .minimal-primary {
          background: var(--color-primary-600);
          color: white;
        }

        .minimal-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .minimal-secondary {
          background: var(--bg-secondary);
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .minimal-inline {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .minimal-block {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .minimal-action-row {
          display: grid;
          gap: var(--space-3);
        }

        .minimal-action-card {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .minimal-list-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          font-size: var(--text-sm);
        }

        .minimal-grid {
          display: grid;
          gap: var(--space-3);
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .minimal-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-field.grow {
          flex: 1;
          min-width: 240px;
        }

        .minimal-field input,
        .minimal-field select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-secondary);
        }

        .minimal-checkbox {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-select {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-select select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-secondary);
        }

        textarea {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          background: var(--bg-secondary);
        }

        .minimal-meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-3);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .minimal-error {
          color: var(--color-error-500);
          font-size: var(--text-sm);
          margin: 0;
        }

        .minimal-alert {
          border: 1px solid rgba(239, 68, 68, 0.2);
          background: rgba(239, 68, 68, 0.08);
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
        }

        .minimal-alert.warning {
          border-color: rgba(245, 158, 11, 0.2);
          background: rgba(245, 158, 11, 0.08);
        }

        .minimal-alert ul {
          margin: var(--space-2) 0 0;
          padding-left: var(--space-4);
          display: grid;
          gap: var(--space-1);
        }

        a {
          color: var(--color-primary-600);
          text-decoration: none;
          font-weight: 600;
        }

        a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};
