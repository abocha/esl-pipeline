import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import type { JobConfigOverrides, JobState, JobStatus } from '../../utils/api';
import { getJobStatus } from '../../utils/api';
import { Step1SelectStudent } from './Step1SelectStudent';
import { Step2ReviewTranscript } from './Step2ReviewTranscript';
import { Step3AddNotes } from './Step3AddNotes';
import { Step4ReviewDraft } from './Step4ReviewDraft';
import { Step5Publish } from './Step5Publish';

const STEPS = [
  { key: 'select', label: 'Select & Upload' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'notes', label: 'Notes' },
  { key: 'review', label: 'Review Draft' },
  { key: 'publish', label: 'Publish' },
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

const buildOverrides = (base: JobConfigOverrides): JobConfigOverrides => ({
  preset: base.preset,
  notionDatabase: base.notionDatabase,
  withTts: base.withTts,
  forceTts: base.forceTts,
  ttsStrategy: base.ttsStrategy,
  upload: base.upload,
  voiceId: base.voiceId,
  voiceAccent: base.voiceAccent,
});

export const AssignmentWizard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobMap } = useJobMonitor();
  const { settings } = useJobSettings();

  const stepParam = searchParams.get('step');
  const jobParam = searchParams.get('jobId');
  const derivedStep = parseStepParam(stepParam);

  const [currentStep, setCurrentStep] = useState(derivedStep);
  const [activeJobId, setActiveJobId] = useState(jobParam || null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [jobMd, setJobMd] = useState<string | null>(null);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [promptPackageId, setPromptPackageId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [profileId, setProfileId] = useState('');

  const [overrides, setOverrides] = useState<JobConfigOverrides>(() => ({
    preset: settings.preset,
    notionDatabase: settings.notionDatabase,
    withTts: settings.withTts,
    forceTts: settings.forceTts,
    ttsStrategy: settings.ttsStrategy,
    upload: 'auto',
    voiceId: undefined,
    voiceAccent: undefined,
  }));

  const jobFetchRef = useRef<string | null>(null);

  useEffect(() => {
    if (derivedStep !== currentStep) {
      setCurrentStep(derivedStep);
    }
  }, [derivedStep, currentStep]);

  useEffect(() => {
    setOverrides((prev) => ({
      ...prev,
      preset: prev.preset ?? settings.preset,
      notionDatabase: prev.notionDatabase ?? settings.notionDatabase,
      withTts: prev.withTts ?? settings.withTts,
      forceTts: prev.forceTts ?? settings.forceTts,
      ttsStrategy: prev.ttsStrategy ?? settings.ttsStrategy,
    }));
  }, [settings]);

  useEffect(() => {
    if (jobParam !== activeJobId) {
      setActiveJobId(jobParam || null);
    }
  }, [jobParam, activeJobId]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const stepKey = STEPS[currentStep]?.key ?? STEPS[0]?.key ?? 'select';
    if (params.get('step') !== stepKey) {
      params.set('step', stepKey);
    }
    if (activeJobId) {
      params.set('jobId', activeJobId);
    } else {
      params.delete('jobId');
    }
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [currentStep, activeJobId, searchParams, setSearchParams]);

  const applyJobSnapshot = (job: JobStatus) => {
    setJobState(job.state ?? null);
    setJobMd(job.md ?? null);
    setRecordingId((prev) => prev ?? job.recordingId ?? null);
    setTranscriptId((prev) => prev ?? job.transcriptId ?? null);
    setPromptPackageId((prev) => prev ?? job.promptPackageId ?? null);
    setDraftId((prev) => prev ?? job.draftId ?? null);
    setOverrides((prev) => ({
      ...prev,
      preset: job.preset ?? prev.preset,
      notionDatabase: job.notionDatabase ?? prev.notionDatabase,
      withTts: job.withTts ?? prev.withTts,
      forceTts: job.forceTts ?? prev.forceTts,
      ttsStrategy: job.ttsStrategy ?? prev.ttsStrategy,
      upload: job.upload ?? prev.upload,
      voiceId: job.voiceId ?? prev.voiceId,
      voiceAccent: job.voiceAccent ?? prev.voiceAccent,
    }));
  };

  useEffect(() => {
    if (!activeJobId) return;
    const jobEntry = jobMap[activeJobId];
    if (jobEntry) {
      applyJobSnapshot(jobEntry);
      return;
    }
    if (jobFetchRef.current === activeJobId) return;
    jobFetchRef.current = activeJobId;
    const loadJob = async () => {
      try {
        const response = await getJobStatus(activeJobId);
        applyJobSnapshot(response);
      } catch (error) {
        console.warn('Failed to load job details', error);
      }
    };
    void loadJob();
  }, [activeJobId, jobMap]);

  const goToStep = (index: number) => {
    const nextIndex = Math.max(0, Math.min(STEPS.length - 1, index));
    setCurrentStep(nextIndex);
  };

  const handleRecordingReady = useCallback(
    (recording: { recordingId: string; transcriptId: string | null }) => {
      setRecordingId(recording.recordingId);
      setTranscriptId(recording.transcriptId ?? null);
    },
    [],
  );

  const handleTranscriptReady = useCallback(
    (response: { transcriptId: string; text: string }, text: string) => {
      setTranscriptId(response.transcriptId ?? null);
      setTranscriptText(text);
    },
    [],
  );

  const handlePromptReady = useCallback((promptPackage: { id: string }) => {
    setPromptPackageId(promptPackage.id);
  }, []);

  const handleDraftReady = useCallback((draft: { id: string; text: string }) => {
    setDraftId(draft.id);
    setDraftText(draft.text ?? '');
  }, []);

  const handlePublish = useCallback((jobId: string) => {
    setActiveJobId(jobId);
    setJobState('queued');
  }, []);

  let stepContent: React.ReactNode = null;
  switch (STEPS[currentStep]?.key) {
    case 'select': {
      stepContent = (
        <Step1SelectStudent
          recordingId={recordingId}
          onRecordingReady={handleRecordingReady}
          onNext={() => goToStep(1)}
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
          onNext={() => goToStep(2)}
          onBack={() => goToStep(0)}
          onSkip={() => goToStep(2)}
        />
      );
      break;
    }
    case 'notes': {
      stepContent = (
        <Step3AddNotes
          recordingId={recordingId}
          notes={notes}
          setNotes={setNotes}
          templateId={templateId}
          setTemplateId={setTemplateId}
          profileId={profileId}
          setProfileId={setProfileId}
          promptPackageId={promptPackageId}
          onPromptReady={handlePromptReady}
          onNext={() => goToStep(3)}
          onBack={() => goToStep(1)}
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
          setDraftText={setDraftText}
          onDraftReady={handleDraftReady}
          onNext={() => goToStep(4)}
          onBack={() => goToStep(2)}
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
          overrides={buildOverrides(overrides)}
          onOverridesChange={(updates) =>
            setOverrides((prev) => ({
              ...prev,
              ...updates,
            }))
          }
          onJobPublished={handlePublish}
          onBack={() => goToStep(3)}
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
      <header className="wizard-header card-glass">
        <div>
          <p className="wizard-eyebrow">Assignment Wizard</p>
          <h1>Build a new assignment</h1>
          <p>Guide your recording through transcript, drafting, and approval.</p>
        </div>
        <div className="wizard-progress">
          {STEPS.map((step, index) => (
            <button
              key={step.key}
              type="button"
              className={`wizard-stepper ${index === currentStep ? 'active' : ''}`}
              onClick={() => goToStep(index)}
            >
              <span>{index + 1}</span>
              <span>{step.label}</span>
            </button>
          ))}
        </div>
      </header>

      {stepContent}

      <style>{`
        .wizard-shell {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .wizard-header {
          padding: var(--space-5) var(--space-6);
          border-radius: var(--radius-2xl);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-5);
          flex-wrap: wrap;
        }

        .wizard-header h1 {
          margin: 0;
          font-size: var(--text-3xl);
          font-family: var(--font-display);
        }

        .wizard-header p {
          margin: var(--space-2) 0 0;
          color: var(--text-tertiary);
        }

        .wizard-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-primary-500);
          margin-bottom: var(--space-2);
        }

        .wizard-progress {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          align-items: center;
        }

        .wizard-stepper {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          border-radius: var(--radius-full);
          border: 1px solid var(--border-light);
          padding: var(--space-2) var(--space-3);
          background: var(--bg-secondary);
          cursor: pointer;
          font-size: var(--text-xs);
          font-weight: 600;
          color: var(--text-secondary);
          transition: all var(--transition-fast);
        }

        .wizard-stepper span:first-child {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-primary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
        }

        .wizard-stepper.active {
          background: var(--bg-primary);
          border-color: rgba(99, 102, 241, 0.4);
          color: var(--text-primary);
          box-shadow: var(--shadow-md);
        }

        @media (max-width: 768px) {
          .wizard-header {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};
