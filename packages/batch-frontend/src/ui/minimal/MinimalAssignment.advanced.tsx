/* eslint-disable react-refresh/only-export-components */

import type { Ref } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { JobOptionsResponse, JobProvenanceResponse, JobStatus } from '../../utils/api';
import { cancelJob, fetchJobProvenance, getJobStatus, rerunJob } from '../../utils/api';
import { ProductButton } from '../system/ProductButton';
import {
  buildCustomRerunPayload,
  buildPresetRerunPayload,
  type CustomRerunInput,
  getPresetRerunActions,
  type PresetRerunKind,
} from './MinimalAssignment.logic';
import { StageSection, type WorkflowStage } from './MinimalAssignment.stages';

type UiTtsProvider = CustomRerunInput['rerunStudyTextProvider'];
type UiPronunciationChunkTtsProvider = CustomRerunInput['rerunPronunciationChunkProvider'];
type UiStudyTextStrategy = CustomRerunInput['rerunStudyTextStrategy'];
type ActionBusyState = 'rerun' | 'cancel' | null;
type TtsModelOptionsByProvider = Partial<Record<UiTtsProvider, readonly string[]>>;

function createDefaultCustomRerunInput(
  selectedTtsProvider: UiTtsProvider,
  jobStatus: JobStatus | null,
): CustomRerunInput {
  const persistedStudyTextModel = jobStatus?.ttsModel ?? '';

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
    rerunPronunciationMainModel:
      selectedTtsProvider === 'google' || selectedTtsProvider === 'inworld'
        ? persistedStudyTextModel
        : '',
    rerunPronunciationMainVoiceId: '',
    rerunPronunciationMainVoiceAccent: '',
    rerunPronunciationChunkProvider: 'google',
    rerunPronunciationChunkModel: '',
    rerunPronunciationChunkVoiceId: '',
    rerunPronunciationChunkVoiceAccent: '',
  };
}

export interface AdvancedActionsController {
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
  form: CustomRerunInput;
  toggleCustomRerun: () => void;
  setFormField: <K extends keyof CustomRerunInput>(field: K, value: CustomRerunInput[K]) => void;
  setPronunciationChunkProvider: (provider: UiPronunciationChunkTtsProvider) => void;
  refreshLineage: () => Promise<void>;
  handlePresetRerun: (kind: PresetRerunKind) => Promise<void>;
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
  ttsModelOptionsByProvider: TtsModelOptionsByProvider;
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
  ttsModelOptionsByProvider,
  elevenlabsStandardModelOptions,
  defaultPronunciationChunkProvider,
  applyJobStatusTransition,
  refreshResumeJobs,
}: UseAdvancedActionsControllerParams): AdvancedActionsController {
  const [showCustomRerun, setShowCustomRerun] = useState(false);
  const [actionBusy, setActionBusy] = useState<ActionBusyState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [jobProvenance, setJobProvenance] = useState<JobProvenanceResponse | null>(null);
  const [jobProvenanceLoading, setJobProvenanceLoading] = useState(false);
  const [jobProvenanceError, setJobProvenanceError] = useState<string | null>(null);
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

  const getTtsModelOptions = useCallback(
    (provider: UiTtsProvider): readonly string[] => ttsModelOptionsByProvider[provider] ?? [],
    [ttsModelOptionsByProvider],
  );

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
      setRerunPronunciationChunkProviderDirty(false);
      setForm(createDefaultCustomRerunInput(selectedTtsProvider, jobStatus));
      return;
    }

    preserveAdvancedActionsOnNextJobSwitchRef.current = null;
    setActionBusy(null);
    setActionError(null);
    setActionSuccess(null);
    setShowCustomRerun(false);
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
      form.rerunPronunciationChunkProvider !== 'elevenlabs' &&
      form.rerunPronunciationChunkProvider !== 'google' &&
      form.rerunPronunciationChunkProvider !== 'inworld'
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
    if (form.rerunStudyTextProvider !== 'elevenlabs') {
      const providerModelOptions = getTtsModelOptions(form.rerunStudyTextProvider);
      if (!form.rerunStudyTextModel || !providerModelOptions.includes(form.rerunStudyTextModel)) {
        setForm((current) => ({
          ...current,
          rerunStudyTextModel: providerModelOptions[0] ?? '',
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
    getTtsModelOptions,
  ]);

  useEffect(() => {
    if (form.rerunPronunciationMainProvider !== 'elevenlabs') {
      const providerModelOptions = getTtsModelOptions(form.rerunPronunciationMainProvider);
      if (
        !form.rerunPronunciationMainModel ||
        !providerModelOptions.includes(form.rerunPronunciationMainModel)
      ) {
        setForm((current) => ({
          ...current,
          rerunPronunciationMainModel: providerModelOptions[0] ?? '',
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
    getTtsModelOptions,
  ]);

  useEffect(() => {
    if (form.rerunPronunciationChunkProvider !== 'elevenlabs') {
      const providerModelOptions = getTtsModelOptions(form.rerunPronunciationChunkProvider);
      if (
        !form.rerunPronunciationChunkModel ||
        !providerModelOptions.includes(form.rerunPronunciationChunkModel)
      ) {
        setForm((current) => ({
          ...current,
          rerunPronunciationChunkModel: providerModelOptions[0] ?? '',
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
    getTtsModelOptions,
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

  const handlePresetRerun = useCallback(
    async (kind: PresetRerunKind) => {
      await queueRerun(buildPresetRerunPayload(kind, form), 'Rerun queued.');
    },
    [form, queueRerun],
  );

  const handleRepublishCurrentDraft = useCallback(async () => {
    await handlePresetRerun('republish');
  }, [handlePresetRerun]);

  const handleRegeneratePronunciationAudio = useCallback(async () => {
    await handlePresetRerun('pronunciation');
  }, [handlePresetRerun]);

  const handleRegenerateStudyTextAudio = useCallback(async () => {
    await handlePresetRerun('studyText');
  }, [handlePresetRerun]);

  const handleRegenerateAllAudio = useCallback(async () => {
    await handlePresetRerun('allAudio');
  }, [handlePresetRerun]);

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

    setActionBusy('cancel');
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await cancelJob(jobStatus.jobId);
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
  }, [applyJobStatusTransition, jobStatus?.jobId, loadJobProvenance, refreshResumeJobs]);

  const refreshLineage = useCallback(async () => {
    if (!jobStatus?.jobId) return;
    await loadJobProvenance(jobStatus.jobId);
  }, [jobStatus?.jobId, loadJobProvenance]);

  return {
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
    form,
    toggleCustomRerun: () => setShowCustomRerun((current) => !current),
    setFormField,
    setPronunciationChunkProvider,
    refreshLineage,
    handlePresetRerun,
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
  sectionRef?: Ref<HTMLElement>;
  headingRef?: Ref<HTMLHeadingElement>;
  jobReady: boolean;
  jobStatus: JobStatus | null;
  controller: AdvancedActionsController;
  onRefreshActions: () => void;
  jobOptionsError: string | null;
  ttsProviders: readonly UiTtsProvider[];
  ttsModelOptionsByProvider: TtsModelOptionsByProvider;
  elevenlabsStandardModelOptions: readonly string[];
  pronunciationChunkProviders: readonly UiPronunciationChunkTtsProvider[];
  studyTextStrategies: readonly UiStudyTextStrategy[];
}

export function AdvancedActionsStage({
  stage,
  sectionRef,
  headingRef,
  jobReady,
  jobStatus,
  controller,
  onRefreshActions,
  jobOptionsError,
  ttsProviders,
  ttsModelOptionsByProvider,
  elevenlabsStandardModelOptions,
  pronunciationChunkProviders,
  studyTextStrategies,
}: AdvancedActionsStageProps) {
  const presetRerunActions = getPresetRerunActions();
  const modelOptionsForProvider = (provider: UiTtsProvider): readonly string[] =>
    ttsModelOptionsByProvider[provider] ?? [];

  return (
    <StageSection stage={stage} sectionRef={sectionRef} headingRef={headingRef}>
      {!jobReady ? (
        <p className="minimal-help">
          Share the assignment once to unlock updates, audio refreshes, cancellation, and support
          details.
        </p>
      ) : (
        <div className="minimal-stage-layout">
          <div className="minimal-stage-panel assignment-advanced-actions">
            <div className="minimal-stage-panel-header">
              <div className="minimal-stage-panel-title">
                <h3>Republish and rerun</h3>
              </div>
              <ProductButton type="button" variant="quiet" onClick={onRefreshActions}>
                Refresh actions
              </ProductButton>
            </div>
            <section
              className="minimal-rerun-actions assignment-advanced-actions__quick"
              aria-label="Quick reruns"
            >
              {presetRerunActions.map((action) => (
                <ProductButton
                  key={action.kind}
                  type="button"
                  variant="secondary"
                  onClick={() => void controller.handlePresetRerun(action.kind)}
                  disabled={!controller.rerunEnabled}
                  busy={controller.actionBusy === 'rerun'}
                >
                  {controller.actionBusy === 'rerun' ? 'Queuing rerun...' : action.label}
                </ProductButton>
              ))}
            </section>
            <div className="minimal-inline">
              <ProductButton
                type="button"
                variant="quiet"
                onClick={controller.toggleCustomRerun}
                disabled={!controller.rerunEnabled}
              >
                {controller.showCustomRerun ? 'Hide custom rerun' : 'Custom rerun'}
              </ProductButton>
            </div>
            {controller.showCustomRerun ? (
              <section className="minimal-custom-rerun" aria-label="Custom rerun selection">
                <div className="minimal-list-heading">
                  <strong>Custom rerun</strong>
                </div>
                <div className="minimal-rerun-picker-grid">
                  <label
                    className={`minimal-rerun-picker${
                      controller.form.rerunStudyTextAudio ? ' is-selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={controller.form.rerunStudyTextAudio}
                      onChange={(event) =>
                        controller.setFormField('rerunStudyTextAudio', event.target.checked)
                      }
                    />
                    <span className="minimal-rerun-picker-copy">
                      <span>Study-text audio</span>
                    </span>
                  </label>
                  <label
                    className={`minimal-rerun-picker${
                      controller.form.rerunPronunciationMainAudio ? ' is-selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={controller.form.rerunPronunciationMainAudio}
                      onChange={(event) =>
                        controller.setFormField('rerunPronunciationMainAudio', event.target.checked)
                      }
                    />
                    <span className="minimal-rerun-picker-copy">
                      <span>Main pronunciation audio</span>
                    </span>
                  </label>
                  <label
                    className={`minimal-rerun-picker${
                      controller.form.rerunPronunciationChunkAudio ? ' is-selected' : ''
                    }`}
                  >
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
                    <span className="minimal-rerun-picker-copy">
                      <span>Pronunciation chunk audio</span>
                    </span>
                  </label>
                </div>
                <p className="minimal-help">{controller.customRerunSummary.join(' • ')}</p>
                {controller.form.rerunStudyTextAudio ? (
                  <div className="minimal-rerun-control-group">
                    <div className="minimal-rerun-control-heading">
                      <span>Study-text settings</span>
                      <span>Narration voice and dialogue overrides</span>
                    </div>
                    <div className="minimal-rerun-control-grid">
                      <label className="minimal-field minimal-rerun-field">
                        <span>Provider</span>
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
                      <label className="minimal-field minimal-rerun-field">
                        <span>Model</span>
                        <select
                          value={controller.form.rerunStudyTextModel}
                          onChange={(event) =>
                            controller.setFormField('rerunStudyTextModel', event.target.value)
                          }
                        >
                          {controller.form.rerunStudyTextProvider !== 'elevenlabs' ? (
                            modelOptionsForProvider(controller.form.rerunStudyTextProvider).map(
                              (model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ),
                            )
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
                      <label className="minimal-field minimal-rerun-field">
                        <span>Voice ID</span>
                        <input
                          value={controller.form.rerunStudyTextVoiceId}
                          onChange={(event) =>
                            controller.setFormField('rerunStudyTextVoiceId', event.target.value)
                          }
                          placeholder="voice id override"
                        />
                      </label>
                      <label className="minimal-field minimal-rerun-field">
                        <span>Accent</span>
                        <input
                          value={controller.form.rerunStudyTextVoiceAccent}
                          onChange={(event) =>
                            controller.setFormField('rerunStudyTextVoiceAccent', event.target.value)
                          }
                          placeholder="accent override"
                        />
                      </label>
                      <label className="minimal-field minimal-rerun-field">
                        <span>Strategy</span>
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
                      <label className="minimal-field minimal-rerun-field">
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
                      <label className="minimal-field minimal-rerun-field">
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
                      <label className="minimal-field minimal-rerun-field">
                        <span>Dialogue seed (integer)</span>
                        <input
                          value={controller.form.rerunStudyTextDialogueSeed}
                          onChange={(event) =>
                            controller.setFormField(
                              'rerunStudyTextDialogueSeed',
                              event.target.value,
                            )
                          }
                          placeholder="7"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
                {controller.form.rerunPronunciationMainAudio ? (
                  <div className="minimal-rerun-control-group">
                    <div className="minimal-rerun-control-heading">
                      <span>Main pronunciation settings</span>
                      <span>Primary sentence pronunciation audio</span>
                    </div>
                    <div className="minimal-rerun-control-grid">
                      <label className="minimal-field minimal-rerun-field">
                        <span>Provider</span>
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
                      <label className="minimal-field minimal-rerun-field">
                        <span>Model</span>
                        <select
                          value={controller.form.rerunPronunciationMainModel}
                          onChange={(event) =>
                            controller.setFormField(
                              'rerunPronunciationMainModel',
                              event.target.value,
                            )
                          }
                        >
                          {(controller.form.rerunPronunciationMainProvider === 'google'
                            ? modelOptionsForProvider(
                                controller.form.rerunPronunciationMainProvider,
                              )
                            : controller.form.rerunPronunciationMainProvider === 'inworld'
                              ? modelOptionsForProvider(
                                  controller.form.rerunPronunciationMainProvider,
                                )
                              : elevenlabsStandardModelOptions
                          ).map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="minimal-field minimal-rerun-field">
                        <span>Voice ID</span>
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
                      <label className="minimal-field minimal-rerun-field">
                        <span>Accent</span>
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
                  </div>
                ) : null}
                {controller.form.rerunPronunciationChunkAudio ? (
                  <div className="minimal-rerun-control-group">
                    <div className="minimal-rerun-control-heading">
                      <span>Pronunciation chunk settings</span>
                      <span>Word, phrase, and chunk pronunciation clips</span>
                    </div>
                    <div className="minimal-rerun-control-grid">
                      <label className="minimal-field minimal-rerun-field">
                        <span>Provider</span>
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
                      <>
                        <label className="minimal-field minimal-rerun-field">
                          <span>Model</span>
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
                              ? modelOptionsForProvider(
                                  controller.form.rerunPronunciationChunkProvider,
                                )
                              : controller.form.rerunPronunciationChunkProvider === 'inworld'
                                ? modelOptionsForProvider(
                                    controller.form.rerunPronunciationChunkProvider,
                                  )
                                : elevenlabsStandardModelOptions
                            ).map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="minimal-field minimal-rerun-field">
                          <span>Voice ID</span>
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
                        <label className="minimal-field minimal-rerun-field">
                          <span>Accent</span>
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
                    </div>
                  </div>
                ) : null}
                <div className="minimal-inline">
                  <ProductButton
                    type="button"
                    variant="secondary"
                    onClick={() => void controller.handleCustomRerun()}
                    disabled={!controller.rerunEnabled || !controller.customRerunHasSelection}
                    busy={controller.actionBusy === 'rerun'}
                  >
                    {controller.actionBusy === 'rerun' ? 'Queuing rerun...' : 'Queue custom rerun'}
                  </ProductButton>
                </div>
              </section>
            ) : null}
            {jobOptionsError ? <p className="minimal-error">{jobOptionsError}</p> : null}
            {!controller.rerunImplemented ? (
              <p className="minimal-muted">
                Reruns are unavailable because backend capability metadata does not mark them as
                implemented.
              </p>
            ) : null}
            {controller.actionError ? (
              <p className="minimal-error">{controller.actionError}</p>
            ) : null}
            {controller.actionSuccess ? (
              <p className="minimal-success">{controller.actionSuccess}</p>
            ) : null}
          </div>
        </div>
      )}
    </StageSection>
  );
}

export interface AssignmentDiagnosticsProps {
  jobStatus: JobStatus | null;
  controller: AdvancedActionsController;
}

export function AssignmentDiagnostics({ jobStatus, controller }: AssignmentDiagnosticsProps) {
  return (
    <>
      <div className="minimal-section-header">
        <p className="minimal-help">
          See the job, template, profile, memory, and audio chain behind this assignment.
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
            <span>Job ID: {jobStatus?.jobId}</span>
            <span>State: {jobStatus?.state}</span>
          </div>
          <div className="minimal-meta">
            <span>Source job: {controller.jobProvenance.job.sourceJobId ?? 'none'}</span>
            <span>Prompt package: {controller.jobProvenance.promptPackage?.id ?? 'none'}</span>
            <span>Draft: {controller.jobProvenance.draft?.id ?? 'none'}</span>
          </div>
          {controller.jobProvenance.tts ? (
            <div className="minimal-meta">
              <span>TTS provider: {controller.jobProvenance.tts.provider ?? 'unknown'}</span>
              <span>
                Generated chars: {controller.jobProvenance.tts.generatedCharacters ?? 0} (cached:{' '}
                {controller.jobProvenance.tts.cachedCharacters ?? 0})
              </span>
              <span>
                Estimated spend:{' '}
                {typeof controller.jobProvenance.tts.estimatedSpendUsd === 'number'
                  ? `$${controller.jobProvenance.tts.estimatedSpendUsd.toFixed(4)}`
                  : 'n/a'}
              </span>
            </div>
          ) : null}
          {(controller.jobProvenance.pronunciationWarnings ?? []).length ? (
            <div className="minimal-alert warning" role="status" aria-live="polite">
              <strong>Audio notices</strong>
              <p className="minimal-help">
                This rerun completed with fallback audio resolution details worth checking.
              </p>
              <ul>
                {(controller.jobProvenance.pronunciationWarnings ?? []).map((warning) => (
                  <li key={warning.code}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {controller.jobProvenance.lineage?.profile?.snapshot?.revisionId ||
          controller.jobProvenance.lineage?.template?.snapshot?.revisionId ? (
            <div className="minimal-meta">
              <span>
                Profile revision:{' '}
                {controller.jobProvenance.lineage?.profile?.snapshot?.revisionId ?? 'unknown'}
              </span>
              <span>
                Template revision:{' '}
                {controller.jobProvenance.lineage?.template?.snapshot?.revisionId ?? 'unknown'}
              </span>
            </div>
          ) : null}
          {controller.jobProvenance.lineage?.bindingAtCreation ? (
            <div className="minimal-meta">
              <span>
                Learner profile at creation:{' '}
                {controller.jobProvenance.lineage.bindingAtCreation.profileId}
              </span>
              <span>
                Active from:{' '}
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
        <p className="minimal-muted">Support details will appear once loaded.</p>
      )}
    </>
  );
}
