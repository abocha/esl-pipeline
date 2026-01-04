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
import { StepIndicator } from './StepIndicator';

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
            labels={STEPS.map(s => s.label)}
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
          align-items: flex-start; /* Changed from center to allow side-by-side */
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
