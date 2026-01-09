import React, { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import { useWizard } from '../../context/WizardContext';
import type { JobStatus } from '../../utils/api';
import { getJobStatus } from '../../utils/api';
import { Step1SelectStudent } from './Step1SelectStudent';
import { Step2ReviewTranscript } from './Step2ReviewTranscript';
import { Step3AddNotes } from './Step3AddNotes';
import { Step4ReviewDraft } from './Step4ReviewDraft';
import { Step5Publish } from './Step5Publish';
import { StepIndicator } from './StepIndicator';
import { Icons } from '../shared/Icons';

const STEPS = [
  { key: 'select', label: 'Select & Upload', icon: <Icons.CloudArrowUp /> },
  { key: 'transcript', label: 'Transcript', icon: <Icons.DocumentText /> },
  { key: 'notes', label: 'Notes', icon: <Icons.PencilSquare /> },
  { key: 'review', label: 'Review Draft', icon: <Icons.Check /> },
  { key: 'publish', label: 'Publish', icon: <Icons.RocketLaunch /> },
];

const parseStepParam = (value: string | null): number => {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  const index = STEPS.findIndex((step) => step.key === normalized);
  if (index !== -1) return index;
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= STEPS.length) {
    return numeric - 1;
  }
  if (normalized === 'review') return 3;
  return 0;
};

export const AssignmentWizard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobMap } = useJobMonitor();
  const { settings } = useJobSettings();
  const { state, dispatch, actions } = useWizard();

  const stepParam = searchParams.get('step');
  const jobParam = searchParams.get('jobId');
  const derivedStep = parseStepParam(stepParam);

  const {
    currentStep,
    activeJobId,
    recordingId,
    transcriptId,
    transcriptText,
    promptPackageId,
    draftId,
    draftText,
    notes,
    templateId,
    profileId,
    overrides,
    jobState,
    jobMd,
  } = state;

  // Initialize overrides from settings globally once if not set?
  // Actually, we should sync default settings if job overrides are empty/undefined.
  // The original code did this in an effect.
  useEffect(() => {
    // Only set if we haven't modified them yet? Or strictly sync defaults?
    // Let's rely on the user manually changing them, but seed with settings.
    // We can do a smart check: update undefined fields.
    const updates: Partial<typeof overrides> = {};
    let needsUpdate = false;

    if (!overrides.preset && settings.preset) {
      updates.preset = settings.preset;
      needsUpdate = true;
    }
    if (!overrides.notionDatabase && settings.notionDatabase) {
      updates.notionDatabase = settings.notionDatabase;
      needsUpdate = true;
    }
    if (overrides.withTts === undefined && settings.withTts !== undefined) {
      updates.withTts = settings.withTts;
      needsUpdate = true;
    }
    if (overrides.forceTts === undefined && settings.forceTts !== undefined) {
      updates.forceTts = settings.forceTts;
      needsUpdate = true;
    }
    if (overrides.ttsStrategy === undefined && settings.ttsStrategy !== undefined) {
      updates.ttsStrategy = settings.ttsStrategy;
      needsUpdate = true;
    }

    if (needsUpdate) {
      actions.updateOverrides(updates);
    }
  }, [settings, overrides, actions]);

  // Sync URL -> Context (Step)
  useEffect(() => {
    if (derivedStep !== currentStep) {
      actions.goToStep(derivedStep);
    }
    // Only react to URL changes, not internal state changes, to avoid race conditions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedStep, actions]);

  // Sync URL -> Context (Job ID)
  useEffect(() => {
    if (jobParam !== activeJobId) {
      actions.setJob(jobParam || null);
    }
    // Only react to URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam, actions]);

  // Sync Context -> URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const stepKey = STEPS[currentStep]?.key ?? STEPS[0]?.key ?? 'select';

    let changed = false;
    if (params.get('step') !== stepKey) {
      params.set('step', stepKey);
      changed = true;
    }

    if (activeJobId) {
      if (params.get('jobId') !== activeJobId) {
        params.set('jobId', activeJobId);
        changed = true;
      }
    } else if (params.has('jobId')) {
      params.delete('jobId');
      changed = true;
    }

    if (changed) {
      setSearchParams(params, { replace: true });
    }
  }, [currentStep, activeJobId, searchParams, setSearchParams]);

  // Job Hydration Logic
  const jobFetchRef = useRef<string | null>(null);

  const hydrateJob = useCallback((job: JobStatus) => {
    dispatch({
      type: 'HYDRATE_JOB',
      payload: {
        jobState: job.state ?? null,
        jobMd: job.md ?? null,
        recordingId: job.recordingId ?? null,
        transcriptId: job.transcriptId ?? null,
        promptPackageId: job.promptPackageId ?? null,
        draftId: job.draftId ?? null,
        overrides: {
          preset: job.preset ?? undefined,
          notionDatabase: job.notionDatabase ?? undefined,
          withTts: job.withTts ?? undefined,
          forceTts: job.forceTts ?? undefined,
          ttsStrategy: job.ttsStrategy ?? undefined,
          upload: job.upload ?? undefined,
          voiceId: job.voiceId ?? undefined,
          voiceAccent: job.voiceAccent ?? undefined,
        },
      },
    });
  }, [dispatch]);

  useEffect(() => {
    if (!activeJobId) return;

    // Check JobMonitor first
    const jobEntry = jobMap[activeJobId];
    if (jobEntry) {
      hydrateJob(jobEntry);
      return;
    }

    // Fetch if needed
    if (jobFetchRef.current === activeJobId) return;
    jobFetchRef.current = activeJobId;

    const loadJob = async () => {
      try {
        const response = await getJobStatus(activeJobId);
        hydrateJob(response);
      } catch (error) {
        console.warn('Failed to load job details', error);
      }
    };
    void loadJob();
  }, [activeJobId, jobMap, hydrateJob]);

  // Handlers
  const handleRecordingReady = useCallback(
    (recording: { recordingId: string; transcriptId: string | null }) => {
      dispatch({ type: 'SET_RECORDING', payload: recording });
    },
    [dispatch],
  );

  const handleTranscriptReady = useCallback(
    (response: { transcriptId: string; text: string }, text: string) => {
      dispatch({ type: 'SET_TRANSCRIPT', payload: { transcriptId: response.transcriptId, text } });
    },
    [dispatch],
  );

  const handlePromptReady = useCallback((promptPackage: { id: string }) => {
    dispatch({ type: 'SET_PROMPT_PACKAGE', payload: promptPackage.id });
  }, [dispatch]);

  const handleDraftReady = useCallback((draft: { id: string; text: string }) => {
    dispatch({ type: 'SET_DRAFT', payload: { draftId: draft.id, text: draft.text } });
  }, [dispatch]);

  const handlePublish = useCallback((jobId: string) => {
    actions.setJob(jobId, 'queued');
  }, [actions]);

  let stepContent: React.ReactNode = null;
  switch (STEPS[currentStep]?.key) {
    case 'select': {
      stepContent = (
        <Step1SelectStudent
          recordingId={recordingId}
          onRecordingReady={handleRecordingReady}
          onNext={() => actions.goToStep(1)}
        />
      );
      break;
    }
    case 'transcript': {
      stepContent = (
        <Step2ReviewTranscript
          recordingId={recordingId}
          transcriptId={transcriptId}
          transcriptText={transcriptText}
          onTranscriptReady={handleTranscriptReady}
          onNext={() => actions.goToStep(2)}
          onBack={() => actions.goToStep(0)}
          onSkip={() => actions.goToStep(2)}
        />
      );
      break;
    }
    case 'notes': {
      stepContent = (
        <Step3AddNotes
          recordingId={recordingId}
          notes={notes}
          setNotes={(val) => dispatch({ type: 'SET_NOTES', payload: val })}
          templateId={templateId}
          setTemplateId={(val) => dispatch({ type: 'SET_TEMPLATE', payload: val })}
          profileId={profileId}
          setProfileId={(val) => dispatch({ type: 'SET_PROFILE', payload: val })}
          promptPackageId={promptPackageId}
          onPromptReady={handlePromptReady}
          onNext={() => actions.goToStep(3)}
          onBack={() => actions.goToStep(1)}
        />
      );
      break;
    }
    case 'review': {
      stepContent = (
        <Step4ReviewDraft
          promptPackageId={promptPackageId}
          draftId={draftId}
          draftText={draftText}
          setDraftText={(val) => dispatch({ type: 'SET_DRAFT_TEXT', payload: val })}
          onDraftReady={handleDraftReady}
          onNext={() => actions.goToStep(4)}
          onBack={() => actions.goToStep(2)}
        />
      );
      break;
    }
    case 'publish': {
      stepContent = (
        <Step5Publish
          draftId={draftId}
          jobId={activeJobId}
          jobState={jobState}
          jobMd={jobMd}
          overrides={overrides}
          onOverridesChange={actions.updateOverrides}
          onJobPublished={handlePublish}
          onBack={() => actions.goToStep(3)}
        />
      );
      break;
    }
    default: {
      stepContent = null;
    }
  }

  return (
    <div className="wizard-shell">
      <header className="wizard-header glass-panel animate-in">
        <div className="header-content">
          <p className="wizard-eyebrow">Assignment Wizard</p>
          <h1>Build a new assignment</h1>
          <p className="header-desc">Guide your recording through transcript, drafting, and approval.</p>
        </div>

        <div className="wizard-progress">
          <StepIndicator
            currentStep={currentStep + 1}
            totalSteps={STEPS.length}
            steps={STEPS.map((step) => ({ label: step.label, icon: step.icon }))}
          />
        </div>
      </header>

      <main className="wizard-content animate-in" style={{ animationDelay: '100ms' }}>
        {stepContent}
      </main>

      <style>{`
        .wizard-shell {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
        }

        .wizard-header {
          padding: var(--space-6) var(--space-8);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-8);
          position: relative;
          overflow: hidden;
        }
        
        /* Subtle background decoration */
        .wizard-header::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -10%;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, rgba(0,0,0,0) 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        .header-content {
          flex: 1;
          max-width: 600px;
          position: relative;
          z-index: 1;
        }

        .wizard-header h1 {
          margin: var(--space-2) 0;
          font-size: var(--text-3xl);
          font-family: var(--font-display);
          letter-spacing: -0.02em;
          background: linear-gradient(to right, var(--text-primary), var(--text-secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .header-desc {
          margin: 0;
          color: var(--text-secondary);
          font-size: var(--text-lg);
        }

        .wizard-eyebrow {
          font-size: var(--text-xs);
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-primary-500);
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
        
        .wizard-eyebrow::before {
          content: '';
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--color-primary-500);
          display: inline-block;
        }

        .wizard-progress {
          flex-shrink: 0;
          min-width: 200px;
        }
        
        .wizard-content {
          /* No container styles needed, steps handle their own layout */
        }

        @media (max-width: 768px) {
          .wizard-header {
            flex-direction: column;
            gap: var(--space-6);
            padding: var(--space-5);
            align-items: stretch;
          }
          
          .wizard-progress {
            width: 100%;
            min-width: 0;
            border-top: 1px solid var(--border-light);
            padding-top: var(--space-4);
          }
        }
      `}</style>
    </div>
  );
};
