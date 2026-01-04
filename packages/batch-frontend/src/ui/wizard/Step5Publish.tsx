import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import type { JobConfigOverrides, JobState } from '../../utils/api';
import { approveJob, editJobMetadata, materializeDraft } from '../../utils/api';
import { WizardStep } from './WizardStep';

interface Step5PublishProps {
  draftId: string | null;
  jobId: string | null;
  jobState: JobState | null;
  jobMd: string | null;
  overrides: JobConfigOverrides;
  onOverridesChange: (updates: Partial<JobConfigOverrides>) => void;
  onJobPublished: (jobId: string) => void;
  onBack: () => void;
}

export const Step5Publish: React.FC<Step5PublishProps> = ({
  draftId,
  jobId,
  jobState,
  jobMd,
  overrides,
  onOverridesChange,
  onJobPublished,
  onBack,
}) => {
  const { options } = useJobSettings();
  const { registerJob, trackJob } = useJobMonitor();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPublish = !!draftId && !loading;

  const publishLabel = useMemo(() => {
    if (jobState === 'awaiting_approval') return 'Update and approve';
    return 'Publish job';
  }, [jobState]);

  const handlePublish = async () => {
    if (!draftId) {
      setError('Save a draft first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (jobId && jobState === 'awaiting_approval') {
        await editJobMetadata(jobId, overrides);
        if (!jobMd) {
          throw new Error('Missing draft path for approval.');
        }
        await approveJob(jobId, jobMd);
        registerJob({ jobId, md: jobMd });
        await trackJob(jobId);
        onJobPublished(jobId);
        toast.success('Job approved');
        return;
      }

      const materialized = await materializeDraft(draftId, { jobOverrides: overrides });
      await approveJob(materialized.jobId, materialized.mdPath);
      registerJob({ jobId: materialized.jobId, md: materialized.mdPath });
      await trackJob(materialized.jobId);
      onJobPublished(materialized.jobId);
      toast.success('Job approved');
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : 'Unable to publish job';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardStep
      title="Publish"
      subtitle="Finalize output settings, then approve the job for processing."
      onBack={onBack}
      onNext={() => void handlePublish()}
      nextLabel={publishLabel}
      isNextDisabled={!canPublish}
      isBusy={loading}
    >
      <div className="publish-grid">
        <div className="publish-panel">
          <h3>Job settings</h3>
          <label>
            Preset
            <select
              value={overrides.preset ?? ''}
              onChange={(event) => onOverridesChange({ preset: event.target.value })}
            >
              {options.presets.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notion database
            <select
              value={overrides.notionDatabase ?? ''}
              onChange={(event) => onOverridesChange({ notionDatabase: event.target.value })}
            >
              {options.notionDatabases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Upload target
            <select
              value={overrides.upload ?? 'auto'}
              onChange={(event) =>
                onOverridesChange({ upload: event.target.value as JobConfigOverrides['upload'] })
              }
            >
              <option value="auto">Auto</option>
              <option value="s3">S3</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>

        <div className="publish-panel">
          <h3>Text-to-speech</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={overrides.withTts ?? false}
              onChange={(event) => onOverridesChange({ withTts: event.target.checked })}
            />
            Enable TTS
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={overrides.forceTts ?? false}
              onChange={(event) => onOverridesChange({ forceTts: event.target.checked })}
            />
            Force regenerate audio
          </label>
          <label>
            Strategy
            <select
              value={overrides.ttsStrategy ?? 'auto'}
              onChange={(event) =>
                onOverridesChange({
                  ttsStrategy: event.target.value as JobConfigOverrides['ttsStrategy'],
                })
              }
            >
              {options.ttsStrategies.map((strategy) => (
                <option key={strategy} value={strategy}>
                  {strategy}
                </option>
              ))}
            </select>
          </label>
          <label>
            Voice
            <select
              value={overrides.voiceId ?? ''}
              onChange={(event) => onOverridesChange({ voiceId: event.target.value || undefined })}
            >
              <option value="">Auto</option>
              {options.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Accent
            <select
              value={overrides.voiceAccent ?? ''}
              onChange={(event) =>
                onOverridesChange({ voiceAccent: event.target.value || undefined })
              }
            >
              <option value="">Auto</option>
              {options.voiceAccents.map((accent) => (
                <option key={accent} value={accent}>
                  {accent}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <style>{`
        .publish-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: var(--space-4);
        }

        .publish-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .publish-panel h3 {
          margin: 0;
        }

        .publish-panel label {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .publish-panel select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-primary);
        }

        .toggle {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: var(--space-2);
        }
      `}</style>
    </WizardStep>
  );
};
