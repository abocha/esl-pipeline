import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import type { JobConfigOverrides, JobState } from '../../utils/api';
import { approveJob, editJobMetadata, materializeDraft } from '../../utils/api';
import { WizardStep } from './WizardStep';
import { Icons } from '../shared/Icons';

interface Step5PublishProps {
  draftId: string | null;
  jobId: string | null;
  jobState: JobState | null;
  jobMd: string | null;
  overrides: JobConfigOverrides;
  completedJobId: string | null;
  transcriptSkipped: boolean;
  autoPublishEnabled: boolean;
  onAutomationChange: (updates: { autoPublish?: boolean }) => void;
  onOverridesChange: (updates: Partial<JobConfigOverrides>) => void;
  onJobPublished: (jobId: string) => void;
  onStartNew: () => void;
  onBack: () => void;
}

export const Step5Publish: React.FC<Step5PublishProps> = ({
  draftId,
  jobId,
  jobState,
  jobMd,
  overrides,
  completedJobId,
  transcriptSkipped,
  autoPublishEnabled,
  onAutomationChange,
  onOverridesChange,
  onJobPublished,
  onStartNew,
  onBack,
}) => {
  const { options, settings } = useJobSettings();
  const { jobMap, registerJob, trackJob, logLedgerEntries } = useJobMonitor();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showAutoPublishConfirm, setShowAutoPublishConfirm] = useState(false);
  const autoPublishAvailable = false; // Backend auto-publish endpoint not yet available

  // Track the completed job for Notion URL updates
  useEffect(() => {
    if (completedJobId) {
      void trackJob(completedJobId);
    }
  }, [completedJobId, trackJob]);

  const completedJob = completedJobId ? jobMap[completedJobId] : null;
  const notionUrl = completedJob?.notionUrl ?? null;

  const canPublish = !!draftId && !loading;
  const publishWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (transcriptSkipped) {
      warnings.push('Transcript review was skipped. Publishing without transcript edits.');
    }
    return warnings;
  }, [transcriptSkipped]);

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

  const handleCopyLink = useCallback(() => {
    if (notionUrl) {
      void navigator.clipboard.writeText(notionUrl);
      setLinkCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [notionUrl]);

  const handleViewJobs = useCallback(() => {
    void navigate('/jobs');
  }, [navigate]);

  const handleResetOverrides = () => {
    onOverridesChange({
      preset: settings.preset,
      notionDatabase: settings.notionDatabase,
      withTts: settings.withTts,
      forceTts: settings.forceTts,
      ttsStrategy: settings.ttsStrategy,
      upload: 'auto',
      voiceId: undefined,
      voiceAccent: undefined,
    });
  };

  // Render completion panel when job is published
  if (completedJobId) {
    return (
      <div className="completion-panel glass-panel animate-in">
        <div className="completion-icon">
          <Icons.Check />
        </div>
        <h2>Assignment published!</h2>
        <p className="completion-subtitle">Your job is now queued for processing.</p>
        <p className="job-id">Job ID: {completedJobId}</p>

        <div className="notion-link-section">
          {notionUrl ? (
            <div className="notion-link-ready">
              <a href={notionUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                Open in Notion
              </a>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCopyLink}
              >
                {linkCopied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          ) : (
            <div className="notion-link-pending">
              <div className="completion-spinner" />
              <span>Link pending... We&apos;ll update this when the job finishes.</span>
            </div>
          )}
        </div>

        <div className="completion-actions">
          <button type="button" className="btn-primary" onClick={onStartNew}>
            Start new assignment
          </button>
          <button type="button" className="btn-secondary" onClick={handleViewJobs}>
            View jobs
          </button>
        </div>

        <style>{`
          .completion-panel {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: var(--space-8);
            gap: var(--space-4);
            max-width: 500px;
            margin: 0 auto;
          }

          .completion-icon {
            width: 64px;
            height: 64px;
            background: var(--color-success-500);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
          }

          .completion-icon svg {
            width: 32px;
            height: 32px;
          }

          .completion-panel h2 {
            margin: 0;
            font-size: var(--text-2xl);
            color: var(--text-primary);
          }

          .completion-subtitle {
            margin: 0;
            color: var(--text-secondary);
            font-size: var(--text-base);
          }

          .job-id {
            margin: 0;
            font-size: var(--text-xs);
            color: var(--text-tertiary);
            font-family: var(--font-mono);
          }

          .notion-link-section {
            width: 100%;
            padding: var(--space-4);
            background: var(--bg-secondary);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-light);
          }

          .notion-link-ready {
            display: flex;
            gap: var(--space-3);
            justify-content: center;
            flex-wrap: wrap;
          }

          .notion-link-pending {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-3);
            color: var(--text-secondary);
            font-size: var(--text-sm);
          }

          .completion-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--border-medium);
            border-top-color: var(--color-primary-500);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          .completion-actions {
            display: flex;
            gap: var(--space-3);
            margin-top: var(--space-4);
            flex-wrap: wrap;
            justify-content: center;
          }

          .completion-panel .btn-primary {
            padding: var(--space-3) var(--space-5);
            background: var(--gradient-primary);
            border: none;
            border-radius: var(--radius-lg);
            color: white;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            transition: transform var(--transition-fast), box-shadow var(--transition-fast);
          }

          .completion-panel .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
          }

          .completion-panel .btn-secondary {
            padding: var(--space-3) var(--space-5);
            background: var(--bg-secondary);
            border: 1px solid var(--border-medium);
            border-radius: var(--radius-lg);
            color: var(--text-primary);
            font-weight: 500;
            cursor: pointer;
            transition: background var(--transition-fast), border-color var(--transition-fast);
          }

          .completion-panel .btn-secondary:hover {
            background: var(--bg-tertiary);
            border-color: var(--border-hover);
          }
        `}</style>
      </div>
    );
  }

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
      {publishWarnings.length > 0 ? (
        <div className="publish-warning">
          <div>
            <h4>Publish warnings</h4>
            <ul>
              {publishWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="automation-card">
        <div className="automation-header">
          <div>
            <span className="automation-eyebrow">Automation</span>
            <h4>Auto-publish</h4>
            <p>Automatically publish when all prerequisites are ready.</p>
          </div>
          <label className="automation-toggle">
            <input
              type="checkbox"
              checked={autoPublishEnabled}
              disabled={!autoPublishAvailable}
              onChange={(event) => {
                onAutomationChange({ autoPublish: event.target.checked });
                if (event.target.checked) {
                  logLedgerEntries([
                    {
                      type: 'automation_auto_publish_enabled',
                      severity: 'info',
                      objectType: 'job',
                      objectId: jobId ?? 'pending',
                      message: 'Auto-publish enabled for this job.',
                      source: 'session',
                    },
                  ]);
                }
              }}
            />
            <span className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {autoPublishAvailable ? (
          autoPublishEnabled ? (
            <div className="automation-active">
              <p className="automation-note">
                <strong>Review required:</strong> Auto-publish will prompt for confirmation before submitting.
              </p>
              {showAutoPublishConfirm && (
                <div className="automation-confirm">
                  <p>Ready to auto-publish. Confirm to proceed?</p>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      onClick={() => {
                        setShowAutoPublishConfirm(false);
                        void handlePublish();
                      }}
                    >
                      Confirm publish
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-small"
                      onClick={() => {
                        setShowAutoPublishConfirm(false);
                        onAutomationChange({ autoPublish: false });
                        logLedgerEntries([
                          {
                            type: 'automation_auto_publish_cancelled',
                            severity: 'info',
                            objectType: 'job',
                            objectId: jobId ?? 'pending',
                            message: 'Auto-publish cancelled by user.',
                            source: 'session',
                          },
                        ]);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="automation-muted">Enable to auto-publish when ready.</p>
          )
        ) : (
          <p className="automation-muted">
            Auto-publish requires backend support. This will be enabled once the auto-publish endpoint is available.
          </p>
        )}
      </div>

      <div className="publish-grid">
        <div className="publish-panel">
          <div className="publish-panel-header">
            <h3>Job settings</h3>
            <button type="button" className="btn-ghost btn-small" onClick={handleResetOverrides}>
              Use defaults
            </button>
          </div>
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

      {error ? (
        <div className="publish-error">
          <div>
            <h4>Publish failed</h4>
            <p>{error}</p>
          </div>
          <div className="publish-error-actions">
            <button type="button" className="btn-primary" onClick={() => void handlePublish()}>
              Retry publish
            </button>
            <button type="button" className="btn-secondary" onClick={handleViewJobs}>
              View jobs
            </button>
          </div>
        </div>
      ) : null}

      <style>{`
        .automation-card {
          border-radius: var(--radius-lg);
          border: 1px dashed var(--border-light);
          padding: var(--space-3);
          background: rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }

        .automation-header {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
          align-items: flex-start;
        }

        .automation-eyebrow {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          font-weight: 600;
        }

        .automation-card h4 {
          margin: var(--space-1) 0 0;
          font-size: var(--text-base);
        }

        .automation-card p {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .automation-toggle {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          cursor: pointer;
        }

        .automation-toggle input {
          position: absolute;
          opacity: 0;
          width: 1px;
          height: 1px;
        }

        .automation-toggle .toggle-track {
          width: 42px;
          height: 24px;
          border-radius: 999px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          position: relative;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .automation-toggle .toggle-track::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--text-secondary);
          transition: transform var(--transition-fast), background var(--transition-fast);
        }

        .automation-toggle input:checked + .toggle-track {
          background: rgba(16, 185, 129, 0.16);
          border-color: rgba(16, 185, 129, 0.35);
        }

        .automation-toggle input:checked + .toggle-track::after {
          transform: translateX(18px);
          background: var(--color-success-600);
        }

        .automation-toggle input:disabled + .toggle-track {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .automation-muted {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .automation-active {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .automation-note {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          background: rgba(99, 102, 241, 0.08);
          padding: var(--space-2);
          border-radius: var(--radius-md);
        }

        .automation-confirm {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-3);
        }

        .confirm-actions {
          display: flex;
          gap: var(--space-2);
          margin-top: var(--space-2);
        }

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

        .publish-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
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

        .publish-warning {
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          border: 1px solid rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.08);
          color: var(--color-warning-600);
        }

        .publish-warning h4 {
          margin: 0 0 var(--space-2);
          font-size: var(--text-sm);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .publish-warning ul {
          margin: 0;
          padding-left: var(--space-4);
          display: grid;
          gap: var(--space-1);
          font-size: var(--text-sm);
        }

        .publish-error {
          margin-top: var(--space-4);
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          border: 1px solid rgba(239, 68, 68, 0.3);
          background: rgba(239, 68, 68, 0.08);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .publish-error h4 {
          margin: 0 0 var(--space-2);
          font-size: var(--text-sm);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .publish-error p {
          margin: 0;
          color: var(--text-secondary);
        }

        .publish-error-actions {
          display: flex;
          gap: var(--space-2);
          flex-wrap: wrap;
        }
      `}</style>
    </WizardStep>
  );
};
