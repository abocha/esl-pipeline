/* eslint-disable react-refresh/only-export-components */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { JobOptionsResponse, JobProvenanceResponse, JobStatus } from '../../utils/api';
import { cancelJob, fetchJobProvenance, getJobStatus, rerunJob } from '../../utils/api';
import {
  buildCustomRerunPayload,
  buildPresetRerunPayload,
  type CustomRerunInput,
} from './MinimalAssignment.logic';
import { StageSection, type WorkflowStage } from './MinimalAssignment.stages';

type UiTtsProvider = CustomRerunInput['rerunStudyTextProvider'];
type UiPronunciationChunkTtsProvider = CustomRerunInput['rerunPronunciationChunkProvider'];
type UiStudyTextStrategy = CustomRerunInput['rerunStudyTextStrategy'];
type ActionBusyState = 'rerun' | 'cancel' | null;

function createDefaultCustomRerunInput(
  selectedTtsProvider: UiTtsProvider,
  jobStatus: JobStatus | null,
): CustomRerunInput {
  const persistedStudyTextModel =
    selectedTtsProvider === 'google'
      ? (jobStatus?.googleTtsModel ?? '')
      : (jobStatus?.studyTextElevenlabsModel ?? '');

  return {
    rerunStudyTextAudio: false,
    rerunPronunciationMainAudio: false,
    rerunPronunciationChunkAudio: false,
    rerunStudyTextProvider: selectedTtsProvider,
    rerunStudyTextModel: persistedStudyTextModel,
    rerunStudyTextVoiceId: '',
    rerunStudyTextVoiceAccent: '',
    rerunStudyTextStrategy: 'auto',
    rerunStudyTextDialogueLanguage: '',
    rerunStudyTextDialogueStability: '',
    rerunStudyTextDialogueSeed: '',
    rerunPronunciationMainProvider: selectedTtsProvider,
    rerunPronunciationMainModel: selectedTtsProvider === 'google' ? persistedStudyTextModel : '',
    rerunPronunciationMainVoiceId: '',
    rerunPronunciationMainVoiceAccent: '',
    rerunPronunciationChunkProvider: 'edge-tts',
    rerunPronunciationChunkModel: '',
    rerunPronunciationChunkVoiceId: '',
    rerunPronunciationChunkVoiceAccent: '',
    rerunPronunciationChunkEdgeVoice: '',
  };
}

export interface AdvancedActionsController {
  showAdvancedActions: boolean;
  showCustomRerun: boolean;
  actionBusy: ActionBusyState;
  actionError: string | null;
  actionSuccess: string | null;
  jobProvenance: JobProvenanceResponse | null;
  jobProvenanceLoading: boolean;
  jobProvenanceError: string | null;
  rerunEnabled: boolean;
  cancelEnabled: boolean;
  rerunImplemented: boolean;
  cancelImplemented: boolean;
  cancelAllowedState: boolean;
  customRerunHasSelection: boolean;
  customRerunSummary: string[];
  cancelReason: string;
  form: CustomRerunInput;
  toggleAdvancedActions: () => void;
  toggleCustomRerun: () => void;
  setCancelReason: (value: string) => void;
  setFormField: <K extends keyof CustomRerunInput>(field: K, value: CustomRerunInput[K]) => void;
  setPronunciationChunkProvider: (provider: UiPronunciationChunkTtsProvider) => void;
  refreshLineage: () => Promise<void>;
  handleRepublishCurrentDraft: () => Promise<void>;
  handleRegeneratePronunciationAudio: () => Promise<void>;
  handleRegenerateStudyTextAudio: () => Promise<void>;
  handleRegenerateAllAudio: () => Promise<void>;
  handleCustomRerun: () => Promise<void>;
  handleCancelJob: () => Promise<void>;
}

interface UseAdvancedActionsControllerParams {
  jobStatus: JobStatus | null;
  jobOptions: Pick<JobOptionsResponse, 'supportedActions' | 'ttsStrategies'> | null;
  selectedTtsProvider: UiTtsProvider;
  ttsProviders: readonly UiTtsProvider[];
  googleTtsModelOptions: readonly string[];
  elevenlabsStandardModelOptions: readonly string[];
  defaultPronunciationChunkProvider: UiPronunciationChunkTtsProvider;
  applyJobStatusTransition: (job: JobStatus) => void;
  refreshResumeJobs: () => Promise<unknown>;
}

export function useAdvancedActionsController({
  jobStatus,
  jobOptions,
  selectedTtsProvider,
  ttsProviders,
  googleTtsModelOptions,
  elevenlabsStandardModelOptions,
  defaultPronunciationChunkProvider,
  applyJobStatusTransition,
  refreshResumeJobs,
}: UseAdvancedActionsControllerParams): AdvancedActionsController {
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  const [showCustomRerun, setShowCustomRerun] = useState(false);
  const [actionBusy, setActionBusy] = useState<ActionBusyState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [form, setForm] = useState<CustomRerunInput>(() =>
    createDefaultCustomRerunInput(selectedTtsProvider, jobStatus),
  );
  const [rerunPronunciationChunkProviderDirty, setRerunPronunciationChunkProviderDirty] =
    useState(false);
  const preserveAdvancedActionsOnNextJobSwitchRef = useRef<string | null>(null);
  const previousJobIdRef = useRef<string | null>(jobStatus?.jobId ?? null);

  const setFormField = useCallback(
    <K extends keyof CustomRerunInput>(field: K, value: CustomRerunInput[K]) => {
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const setPronunciationChunkProvider = useCallback((provider: UiPronunciationChunkTtsProvider) => {
    setRerunPronunciationChunkProviderDirty(true);
    setForm((current) => ({
      ...current,
      rerunPronunciationChunkProvider: provider,
    }));
  }, []);

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

  const actionCapabilities = jobOptions?.supportedActions ?? [];
  const rerunImplemented =
    actionCapabilities.find((capability) => capability.type === 'rerun')?.implemented ?? false;
  const cancelImplemented =
    actionCapabilities.find((capability) => capability.type === 'cancel')?.implemented ?? false;
  const cancelAllowedState = jobStatus?.state === 'queued' || jobStatus?.state === 'running';
  const rerunEnabled = Boolean(jobStatus?.jobId) && rerunImplemented && actionBusy === null;
  const cancelEnabled =
    Boolean(jobStatus?.jobId) && cancelImplemented && cancelAllowedState && actionBusy === null;
  const customRerunHasSelection =
    form.rerunStudyTextAudio ||
    form.rerunPronunciationMainAudio ||
    form.rerunPronunciationChunkAudio;
  const customRerunSummary = [
    form.rerunStudyTextAudio ? 'regenerate study-text audio' : 'reuse study-text audio',
    form.rerunPronunciationMainAudio
      ? 'regenerate main pronunciation audio'
      : 'reuse main pronunciation audio',
    form.rerunPronunciationChunkAudio
      ? 'regenerate pronunciation chunk audio'
      : 'reuse pronunciation chunk audio',
    'refresh published output',
  ];

  useEffect(() => {
    const nextJobId = jobStatus?.jobId ?? null;
    const previousJobId = previousJobIdRef.current;

    if (previousJobId === nextJobId) {
      return;
    }

    previousJobIdRef.current = nextJobId;

    if (
      nextJobId &&
      preserveAdvancedActionsOnNextJobSwitchRef.current &&
      preserveAdvancedActionsOnNextJobSwitchRef.current === nextJobId
    ) {
      preserveAdvancedActionsOnNextJobSwitchRef.current = null;
      setActionBusy(null);
      setActionError(null);
      setShowCustomRerun(false);
      setCancelReason('');
      setRerunPronunciationChunkProviderDirty(false);
      setForm(createDefaultCustomRerunInput(selectedTtsProvider, jobStatus));
      return;
    }

    preserveAdvancedActionsOnNextJobSwitchRef.current = null;
    setActionBusy(null);
    setActionError(null);
    setActionSuccess(null);
    setShowAdvancedActions(false);
    setShowCustomRerun(false);
    setCancelReason('');
    setRerunPronunciationChunkProviderDirty(false);
    setForm(createDefaultCustomRerunInput(selectedTtsProvider, jobStatus));
  }, [jobStatus, jobStatus?.jobId, selectedTtsProvider]);

  useEffect(() => {
    if (!ttsProviders.includes(form.rerunStudyTextProvider)) {
      setForm((current) => ({
        ...current,
        rerunStudyTextProvider: selectedTtsProvider,
      }));
    }
  }, [form.rerunStudyTextProvider, selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    if (!ttsProviders.includes(form.rerunPronunciationMainProvider)) {
      setForm((current) => ({
        ...current,
        rerunPronunciationMainProvider: selectedTtsProvider,
      }));
    }
  }, [form.rerunPronunciationMainProvider, selectedTtsProvider, ttsProviders]);

  useEffect(() => {
    if (
      form.rerunPronunciationChunkProvider !== 'edge-tts' &&
      form.rerunPronunciationChunkProvider !== 'elevenlabs' &&
      form.rerunPronunciationChunkProvider !== 'google'
    ) {
      setForm((current) => ({
        ...current,
        rerunPronunciationChunkProvider: defaultPronunciationChunkProvider,
      }));
    }
  }, [defaultPronunciationChunkProvider, form.rerunPronunciationChunkProvider]);

  useEffect(() => {
    if (!rerunPronunciationChunkProviderDirty) {
      setForm((current) => ({
        ...current,
        rerunPronunciationChunkProvider: defaultPronunciationChunkProvider,
      }));
    }
  }, [defaultPronunciationChunkProvider, rerunPronunciationChunkProviderDirty, jobStatus?.jobId]);

  useEffect(() => {
    if (form.rerunStudyTextProvider === 'google') {
      if (!form.rerunStudyTextModel || !googleTtsModelOptions.includes(form.rerunStudyTextModel)) {
        setForm((current) => ({
          ...current,
          rerunStudyTextModel: googleTtsModelOptions[0] ?? '',
        }));
      }
      return;
    }
    if (form.rerunStudyTextStrategy === 'auto') {
      if (form.rerunStudyTextModel) {
        setForm((current) => ({ ...current, rerunStudyTextModel: '' }));
      }
      return;
    }
    if (form.rerunStudyTextStrategy === 'dialogue') {
      if (form.rerunStudyTextModel !== 'eleven_v3') {
        setForm((current) => ({ ...current, rerunStudyTextModel: 'eleven_v3' }));
      }
      return;
    }
    if (
      form.rerunStudyTextModel &&
      !elevenlabsStandardModelOptions.includes(form.rerunStudyTextModel)
    ) {
      setForm((current) => ({ ...current, rerunStudyTextModel: '' }));
    }
  }, [
    elevenlabsStandardModelOptions,
    form.rerunStudyTextModel,
    form.rerunStudyTextProvider,
    form.rerunStudyTextStrategy,
    googleTtsModelOptions,
  ]);

  useEffect(() => {
    if (form.rerunPronunciationMainProvider === 'google') {
      if (
        !form.rerunPronunciationMainModel ||
        !googleTtsModelOptions.includes(form.rerunPronunciationMainModel)
      ) {
        setForm((current) => ({
          ...current,
          rerunPronunciationMainModel: googleTtsModelOptions[0] ?? '',
        }));
      }
      return;
    }
    if (
      !form.rerunPronunciationMainModel ||
      !elevenlabsStandardModelOptions.includes(form.rerunPronunciationMainModel)
    ) {
      setForm((current) => ({
        ...current,
        rerunPronunciationMainModel:
          elevenlabsStandardModelOptions.find((model) => model === 'eleven_flash_v2_5') ??
          elevenlabsStandardModelOptions[0] ??
          '',
      }));
    }
  }, [
    elevenlabsStandardModelOptions,
    form.rerunPronunciationMainModel,
    form.rerunPronunciationMainProvider,
    googleTtsModelOptions,
  ]);

  useEffect(() => {
    if (form.rerunPronunciationChunkProvider === 'google') {
      if (
        !form.rerunPronunciationChunkModel ||
        !googleTtsModelOptions.includes(form.rerunPronunciationChunkModel)
      ) {
        setForm((current) => ({
          ...current,
          rerunPronunciationChunkModel: googleTtsModelOptions[0] ?? '',
        }));
      }
      return;
    }
    if (form.rerunPronunciationChunkProvider === 'elevenlabs') {
      if (
        !form.rerunPronunciationChunkModel ||
        !elevenlabsStandardModelOptions.includes(form.rerunPronunciationChunkModel)
      ) {
        setForm((current) => ({
          ...current,
          rerunPronunciationChunkModel:
            elevenlabsStandardModelOptions.find((model) => model === 'eleven_flash_v2_5') ??
            elevenlabsStandardModelOptions[0] ??
            '',
        }));
      }
      return;
    }
    if (form.rerunPronunciationChunkModel) {
      setForm((current) => ({
        ...current,
        rerunPronunciationChunkModel: '',
      }));
    }
  }, [
    elevenlabsStandardModelOptions,
    form.rerunPronunciationChunkModel,
    form.rerunPronunciationChunkProvider,
    googleTtsModelOptions,
  ]);

  useEffect(() => {
    if (!jobStatus?.jobId) {
      setJobProvenance(null);
      setJobProvenanceError(null);
      setJobProvenanceLoading(false);
      return;
    }
    void loadJobProvenance(jobStatus.jobId);
  }, [jobStatus?.jobId, loadJobProvenance]);

  const queueRerun = useCallback(
    async (payload: Parameters<typeof rerunJob>[1], fallbackMessage: string): Promise<void> => {
      if (!jobStatus?.jobId) return;

      const currentJobId = jobStatus.jobId;
      setActionBusy('rerun');
      setActionError(null);
      setActionSuccess(null);
      try {
        const result = await rerunJob(currentJobId, payload);
        setActionSuccess(result.message ?? fallbackMessage);
        const nextJobId = result.jobId || currentJobId;
        preserveAdvancedActionsOnNextJobSwitchRef.current =
          nextJobId !== currentJobId ? nextJobId : null;
        const refreshed = await getJobStatus(nextJobId);
        applyJobStatusTransition(refreshed);
        await loadJobProvenance(refreshed.jobId);
        await refreshResumeJobs();
      } catch (error) {
        const message = error instanceof Error ? error.message : fallbackMessage;
        setActionError(message);
      } finally {
        setActionBusy(null);
      }
    },
    [applyJobStatusTransition, jobStatus?.jobId, loadJobProvenance, refreshResumeJobs],
  );

  const handleRepublishCurrentDraft = useCallback(async () => {
    await queueRerun(buildPresetRerunPayload('republish'), 'Republish queued.');
  }, [queueRerun]);

  const handleRegeneratePronunciationAudio = useCallback(async () => {
    await queueRerun(buildPresetRerunPayload('pronunciation'), 'Pronunciation rerun queued.');
  }, [queueRerun]);

  const handleRegenerateStudyTextAudio = useCallback(async () => {
    await queueRerun(buildPresetRerunPayload('studyText'), 'Study-text rerun queued.');
  }, [queueRerun]);

  const handleRegenerateAllAudio = useCallback(async () => {
    await queueRerun(buildPresetRerunPayload('allAudio'), 'Full audio rerun queued.');
  }, [queueRerun]);

  const handleCustomRerun = useCallback(async () => {
    if (!jobStatus?.jobId) return;

    const payload = buildCustomRerunPayload(form);
    if (!payload.ok) {
      setActionError(payload.error);
      return;
    }

    await queueRerun(payload.payload, 'Custom rerun queued.');
  }, [form, jobStatus?.jobId, queueRerun]);

  const handleCancelJob = useCallback(async () => {
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
      applyJobStatusTransition(refreshed);
      await loadJobProvenance(jobStatus.jobId);
      await refreshResumeJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel job.';
      setActionError(message);
    } finally {
      setActionBusy(null);
    }
  }, [
    applyJobStatusTransition,
    cancelReason,
    jobStatus?.jobId,
    loadJobProvenance,
    refreshResumeJobs,
  ]);

  const refreshLineage = useCallback(async () => {
    if (!jobStatus?.jobId) return;
    await loadJobProvenance(jobStatus.jobId);
  }, [jobStatus?.jobId, loadJobProvenance]);

  return {
    showAdvancedActions,
    showCustomRerun,
    actionBusy,
    actionError,
    actionSuccess,
    jobProvenance,
    jobProvenanceLoading,
    jobProvenanceError,
    rerunEnabled,
    cancelEnabled,
    rerunImplemented,
    cancelImplemented,
    cancelAllowedState,
    customRerunHasSelection,
    customRerunSummary,
    cancelReason,
    form,
    toggleAdvancedActions: () => setShowAdvancedActions((current) => !current),
    toggleCustomRerun: () => setShowCustomRerun((current) => !current),
    setCancelReason,
    setFormField,
    setPronunciationChunkProvider,
    refreshLineage,
    handleRepublishCurrentDraft,
    handleRegeneratePronunciationAudio,
    handleRegenerateStudyTextAudio,
    handleRegenerateAllAudio,
    handleCustomRerun,
    handleCancelJob,
  };
}

interface AdvancedActionsStageProps {
  stage: WorkflowStage;
  jobReady: boolean;
  jobStatus: JobStatus | null;
  controller: AdvancedActionsController;
  onRefreshActions: () => void;
  jobOptionsError: string | null;
  ttsProviders: readonly UiTtsProvider[];
  googleTtsModelOptions: readonly string[];
  elevenlabsStandardModelOptions: readonly string[];
  pronunciationChunkProviders: readonly UiPronunciationChunkTtsProvider[];
  studyTextStrategies: readonly UiStudyTextStrategy[];
}

export function AdvancedActionsStage({
  stage,
  jobReady,
  jobStatus,
  controller,
  onRefreshActions,
  jobOptionsError,
  ttsProviders,
  googleTtsModelOptions,
  elevenlabsStandardModelOptions,
  pronunciationChunkProviders,
  studyTextStrategies,
}: AdvancedActionsStageProps) {
  return (
    <StageSection
      stage={stage}
      actions={
        jobReady ? (
          <button
            type="button"
            className="minimal-secondary"
            onClick={controller.toggleAdvancedActions}
          >
            {controller.showAdvancedActions ? 'Hide advanced actions' : 'Show advanced actions'}
          </button>
        ) : undefined
      }
    >
      {!jobReady ? (
        <p className="minimal-help">
          Share the assignment once to unlock republish, reruns, cancellation, and lineage details.
        </p>
      ) : controller.showAdvancedActions ? (
        <div className="minimal-stage-layout">
          <div className="minimal-stage-panel">
            <div className="minimal-stage-panel-header">
              <div className="minimal-stage-panel-title">
                <h3>Republish and rerun</h3>
                <p>Choose exactly what to regenerate. Anything you leave unchecked stays as-is.</p>
              </div>
              <button type="button" className="minimal-secondary" onClick={onRefreshActions}>
                Refresh actions
              </button>
            </div>
            <div className="minimal-meta">
              <span>Job ID: {jobStatus?.jobId}</span>
              <span>State: {jobStatus?.state}</span>
            </div>
            <div className="minimal-grid">
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void controller.handleRepublishCurrentDraft()}
                disabled={!controller.rerunEnabled}
              >
                {controller.actionBusy === 'rerun' ? 'Queuing rerun...' : 'Republish current draft'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void controller.handleRegeneratePronunciationAudio()}
                disabled={!controller.rerunEnabled}
              >
                {controller.actionBusy === 'rerun'
                  ? 'Queuing rerun...'
                  : 'Regenerate pronunciation audio'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void controller.handleRegenerateStudyTextAudio()}
                disabled={!controller.rerunEnabled}
              >
                {controller.actionBusy === 'rerun'
                  ? 'Queuing rerun...'
                  : 'Regenerate study-text audio'}
              </button>
              <button
                type="button"
                className="minimal-primary"
                onClick={() => void controller.handleRegenerateAllAudio()}
                disabled={!controller.rerunEnabled}
              >
                {controller.actionBusy === 'rerun' ? 'Queuing rerun...' : 'Regenerate all audio'}
              </button>
              <button
                type="button"
                className="minimal-secondary"
                onClick={controller.toggleCustomRerun}
                disabled={!controller.rerunEnabled}
              >
                {controller.showCustomRerun ? 'Hide custom rerun' : 'Custom rerun'}
              </button>
            </div>
            <p className="minimal-help">
              Pronunciation chunks default to `edge-tts`, except `connected_speech`, which defaults
              to ElevenLabs.
            </p>
            {controller.showCustomRerun ? (
              <div className="minimal-block">
                <div className="minimal-grid">
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={controller.form.rerunStudyTextAudio}
                      onChange={(event) =>
                        controller.setFormField('rerunStudyTextAudio', event.target.checked)
                      }
                    />
                    <span>Study-text audio</span>
                  </label>
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={controller.form.rerunPronunciationMainAudio}
                      onChange={(event) =>
                        controller.setFormField('rerunPronunciationMainAudio', event.target.checked)
                      }
                    />
                    <span>Main pronunciation audio</span>
                  </label>
                  <label className="minimal-checkbox">
                    <input
                      type="checkbox"
                      checked={controller.form.rerunPronunciationChunkAudio}
                      onChange={(event) =>
                        controller.setFormField(
                          'rerunPronunciationChunkAudio',
                          event.target.checked,
                        )
                      }
                    />
                    <span>Pronunciation chunk audio</span>
                  </label>
                </div>
                <p className="minimal-help">{controller.customRerunSummary.join(' • ')}</p>
                {controller.form.rerunStudyTextAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Study-text provider</span>
                      <select
                        value={controller.form.rerunStudyTextProvider}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunStudyTextProvider',
                            event.target.value as UiTtsProvider,
                          )
                        }
                      >
                        {ttsProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Study-text model</span>
                      <select
                        value={controller.form.rerunStudyTextModel}
                        onChange={(event) =>
                          controller.setFormField('rerunStudyTextModel', event.target.value)
                        }
                      >
                        {controller.form.rerunStudyTextProvider === 'google' ? (
                          googleTtsModelOptions.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))
                        ) : controller.form.rerunStudyTextStrategy === 'auto' ? (
                          <option value="">
                            Strategy default (`dialogue` {`->`} `eleven_v3`, `tts` {`->`}{' '}
                            `eleven_multilingual_v2`)
                          </option>
                        ) : controller.form.rerunStudyTextStrategy === 'dialogue' ? (
                          <>
                            <option value="">Dialogue default (`eleven_v3`)</option>
                            <option value="eleven_v3">eleven_v3</option>
                          </>
                        ) : (
                          <>
                            <option value="">TTS default (`eleven_multilingual_v2`)</option>
                            {elevenlabsStandardModelOptions.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Study-text voice ID</span>
                      <input
                        value={controller.form.rerunStudyTextVoiceId}
                        onChange={(event) =>
                          controller.setFormField('rerunStudyTextVoiceId', event.target.value)
                        }
                        placeholder="voice id override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Study-text accent</span>
                      <input
                        value={controller.form.rerunStudyTextVoiceAccent}
                        onChange={(event) =>
                          controller.setFormField('rerunStudyTextVoiceAccent', event.target.value)
                        }
                        placeholder="accent override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Study-text strategy</span>
                      <select
                        value={controller.form.rerunStudyTextStrategy}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunStudyTextStrategy',
                            event.target.value as UiStudyTextStrategy,
                          )
                        }
                      >
                        {studyTextStrategies.map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {strategy}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue language</span>
                      <input
                        value={controller.form.rerunStudyTextDialogueLanguage}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunStudyTextDialogueLanguage',
                            event.target.value,
                          )
                        }
                        placeholder="e.g. es"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue stability (0..1)</span>
                      <input
                        value={controller.form.rerunStudyTextDialogueStability}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunStudyTextDialogueStability',
                            event.target.value,
                          )
                        }
                        placeholder="0.42"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Dialogue seed (integer)</span>
                      <input
                        value={controller.form.rerunStudyTextDialogueSeed}
                        onChange={(event) =>
                          controller.setFormField('rerunStudyTextDialogueSeed', event.target.value)
                        }
                        placeholder="7"
                      />
                    </label>
                  </div>
                ) : null}
                {controller.form.rerunPronunciationMainAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Main pronunciation provider</span>
                      <select
                        value={controller.form.rerunPronunciationMainProvider}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunPronunciationMainProvider',
                            event.target.value as UiTtsProvider,
                          )
                        }
                      >
                        {ttsProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation model</span>
                      <select
                        value={controller.form.rerunPronunciationMainModel}
                        onChange={(event) =>
                          controller.setFormField('rerunPronunciationMainModel', event.target.value)
                        }
                      >
                        {(controller.form.rerunPronunciationMainProvider === 'google'
                          ? googleTtsModelOptions
                          : elevenlabsStandardModelOptions
                        ).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation voice ID</span>
                      <input
                        value={controller.form.rerunPronunciationMainVoiceId}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunPronunciationMainVoiceId',
                            event.target.value,
                          )
                        }
                        placeholder="voice id override"
                      />
                    </label>
                    <label className="minimal-field">
                      <span>Main pronunciation accent</span>
                      <input
                        value={controller.form.rerunPronunciationMainVoiceAccent}
                        onChange={(event) =>
                          controller.setFormField(
                            'rerunPronunciationMainVoiceAccent',
                            event.target.value,
                          )
                        }
                        placeholder="accent override"
                      />
                    </label>
                  </div>
                ) : null}
                {controller.form.rerunPronunciationChunkAudio ? (
                  <div className="minimal-grid">
                    <label className="minimal-field">
                      <span>Pronunciation chunk provider</span>
                      <select
                        value={controller.form.rerunPronunciationChunkProvider}
                        onChange={(event) =>
                          controller.setPronunciationChunkProvider(
                            event.target.value as UiPronunciationChunkTtsProvider,
                          )
                        }
                      >
                        {pronunciationChunkProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>
                    {controller.form.rerunPronunciationChunkProvider === 'edge-tts' ? (
                      <label className="minimal-field">
                        <span>Edge voice</span>
                        <input
                          value={controller.form.rerunPronunciationChunkEdgeVoice}
                          onChange={(event) =>
                            controller.setFormField(
                              'rerunPronunciationChunkEdgeVoice',
                              event.target.value,
                            )
                          }
                          placeholder="e.g. en-US-AriaNeural"
                        />
                      </label>
                    ) : (
                      <>
                        <label className="minimal-field">
                          <span>Pronunciation chunk model</span>
                          <select
                            value={controller.form.rerunPronunciationChunkModel}
                            onChange={(event) =>
                              controller.setFormField(
                                'rerunPronunciationChunkModel',
                                event.target.value,
                              )
                            }
                          >
                            {(controller.form.rerunPronunciationChunkProvider === 'google'
                              ? googleTtsModelOptions
                              : elevenlabsStandardModelOptions
                            ).map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="minimal-field">
                          <span>Pronunciation chunk voice ID</span>
                          <input
                            value={controller.form.rerunPronunciationChunkVoiceId}
                            onChange={(event) =>
                              controller.setFormField(
                                'rerunPronunciationChunkVoiceId',
                                event.target.value,
                              )
                            }
                            placeholder="voice id override"
                          />
                        </label>
                        <label className="minimal-field">
                          <span>Pronunciation chunk accent</span>
                          <input
                            value={controller.form.rerunPronunciationChunkVoiceAccent}
                            onChange={(event) =>
                              controller.setFormField(
                                'rerunPronunciationChunkVoiceAccent',
                                event.target.value,
                              )
                            }
                            placeholder="accent override"
                          />
                        </label>
                      </>
                    )}
                  </div>
                ) : null}
                <div className="minimal-inline">
                  <button
                    type="button"
                    className="minimal-primary"
                    onClick={() => void controller.handleCustomRerun()}
                    disabled={!controller.rerunEnabled || !controller.customRerunHasSelection}
                  >
                    {controller.actionBusy === 'rerun' ? 'Queuing rerun...' : 'Queue custom rerun'}
                  </button>
                </div>
                <p className="minimal-help">
                  `eleven_v3` is dialogue-only. `eleven_flash_v2` is the only ElevenLabs model that
                  supports IPA. `eleven_flash_v2_5` is the fast, cheap pronunciation option.
                </p>
              </div>
            ) : null}
          </div>

          <div className="minimal-stage-panel">
            <div className="minimal-stage-panel-title">
              <h3>Cancel and inspect</h3>
              <p>
                Use these tools when you need to stop a job or trace exactly how the current output
                was made.
              </p>
            </div>
            <div className="minimal-block">
              <div className="minimal-inline">
                <label className="minimal-field grow">
                  <span>Cancel reason (optional)</span>
                  <input
                    value={controller.cancelReason}
                    onChange={(event) => controller.setCancelReason(event.target.value)}
                    placeholder="reason for cancellation"
                  />
                </label>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void controller.handleCancelJob()}
                  disabled={!controller.cancelEnabled}
                >
                  {controller.actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel job'}
                </button>
              </div>
              {!controller.cancelAllowedState && jobStatus ? (
                <p className="minimal-muted">
                  Cancel is only available for queued or running jobs.
                </p>
              ) : null}
            </div>
            {jobOptionsError ? <p className="minimal-error">{jobOptionsError}</p> : null}
            {!controller.rerunImplemented || !controller.cancelImplemented ? (
              <p className="minimal-muted">
                Some actions are unavailable because backend capability metadata does not mark them
                as implemented.
              </p>
            ) : null}
            {controller.actionError ? (
              <p className="minimal-error">{controller.actionError}</p>
            ) : null}
            {controller.actionSuccess ? (
              <p className="minimal-success">{controller.actionSuccess}</p>
            ) : null}
            <details className="minimal-details" open>
              <summary>Assignment lineage</summary>
              <div className="minimal-section-header">
                <p className="minimal-help">
                  See which prompt, draft, profile snapshot, and audio chain produced this
                  assignment.
                </p>
                <button
                  type="button"
                  className="minimal-secondary"
                  onClick={() => void controller.refreshLineage()}
                  disabled={controller.jobProvenanceLoading}
                >
                  {controller.jobProvenanceLoading ? 'Refreshing...' : 'Refresh lineage'}
                </button>
              </div>
              {controller.jobProvenanceError ? (
                <p className="minimal-error">{controller.jobProvenanceError}</p>
              ) : null}
              {controller.jobProvenance ? (
                <>
                  <div className="minimal-meta">
                    <span>Source job: {controller.jobProvenance.job.sourceJobId ?? 'none'}</span>
                    <span>
                      Prompt package: {controller.jobProvenance.promptPackage?.id ?? 'none'}
                    </span>
                    <span>Draft: {controller.jobProvenance.draft?.id ?? 'none'}</span>
                  </div>
                  {controller.jobProvenance.tts ? (
                    <div className="minimal-meta">
                      <span>
                        TTS provider: {controller.jobProvenance.tts.provider ?? 'unknown'}
                      </span>
                      <span>
                        Generated chars: {controller.jobProvenance.tts.generatedCharacters ?? 0}{' '}
                        (cached: {controller.jobProvenance.tts.cachedCharacters ?? 0})
                      </span>
                      <span>
                        Estimated spend:{' '}
                        {typeof controller.jobProvenance.tts.estimatedSpendUsd === 'number'
                          ? `$${controller.jobProvenance.tts.estimatedSpendUsd.toFixed(4)}`
                          : 'n/a'}
                      </span>
                    </div>
                  ) : null}
                  {controller.jobProvenance.lineage?.profile?.snapshot?.revisionId ||
                  controller.jobProvenance.lineage?.template?.snapshot?.revisionId ? (
                    <div className="minimal-meta">
                      <span>
                        Profile revision:{' '}
                        {controller.jobProvenance.lineage?.profile?.snapshot?.revisionId ??
                          'unknown'}
                      </span>
                      <span>
                        Template revision:{' '}
                        {controller.jobProvenance.lineage?.template?.snapshot?.revisionId ??
                          'unknown'}
                      </span>
                    </div>
                  ) : null}
                  {controller.jobProvenance.lineage?.bindingAtCreation ? (
                    <div className="minimal-meta">
                      <span>
                        Bound profile at creation:{' '}
                        {controller.jobProvenance.lineage.bindingAtCreation.profileId}
                      </span>
                      <span>
                        Bound from:{' '}
                        {new Date(
                          controller.jobProvenance.lineage.bindingAtCreation.effectiveFrom,
                        ).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {controller.jobProvenance.actions.length > 0 ? (
                    <div className="minimal-list">
                      {controller.jobProvenance.actions.slice(0, 6).map((event) => (
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
                <p className="minimal-muted">Lineage details will appear once loaded.</p>
              )}
            </details>
          </div>
        </div>
      ) : (
        <p className="minimal-help">
          Advanced actions are available, but currently tucked away until you open them.
        </p>
      )}
    </StageSection>
  );
}
