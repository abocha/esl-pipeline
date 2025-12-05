import React from 'react';

import { useJobSettings } from '../../context/JobSettingsContext';
import type { JobSettings } from '../../context/JobSettingsContext';

// Icons
const SettingsIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const JobSettingsForm: React.FC = () => {
  const {
    settings,
    updateSettings,
    resetSettings,
    options,
    isLoading,
    errorMessage,
    isUsingFallback,
  } = useJobSettings();

  return (
    <section className="settings-form card animate-fade-in-up">
      <header className="settings-header">
        <div className="settings-title">
          <div className="settings-icon">
            <SettingsIcon />
          </div>
          <div>
            <span className="eyebrow">Configuration</span>
            <h2>Job Settings</h2>
          </div>
        </div>
        <button type="button" onClick={resetSettings} className="btn-reset">
          <RefreshIcon />
          Reset
        </button>
      </header>

      {isLoading && (
        <div className="settings-banner info">
          <div className="spinner-small" />
          <span>Loading options from backend…</span>
        </div>
      )}

      {!isLoading && isUsingFallback && (
        <div className="settings-banner warning">
          <span className="banner-icon">⚠️</span>
          <span>Unable to reach backend. Using fallback options.</span>
        </div>
      )}

      {errorMessage && !isLoading && (
        <div className="settings-banner error">
          <span className="banner-icon">❌</span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="settings-grid">
        {/* Preset */}
        <div className="form-field">
          <label className="field-label">
            <span>Preset</span>
            <span className="field-hint">Controls level and default settings</span>
          </label>
          <select
            value={settings.preset}
            onChange={(e) => updateSettings({ preset: e.target.value })}
            className="field-select"
          >
            {options.presets.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </div>

        {/* Mode */}
        <div className="form-field">
          <label className="field-label">
            <span>TTS Mode</span>
            <span className="field-hint">Auto detects speaker count</span>
          </label>
          <select
            value={settings.mode}
            onChange={(e) => updateSettings({ mode: e.target.value as JobSettings['mode'] })}
            className="field-select"
          >
            {options.modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* TTS Toggle */}
        <div className="form-field">
          <ToggleField
            label="Generate TTS"
            description="Create audio with ElevenLabs"
            checked={settings.withTts}
            onChange={(value) => updateSettings({ withTts: value })}
          />
        </div>

        {/* Force TTS Toggle */}
        <div className="form-field">
          <ToggleField
            label="Force Regenerate"
            description="Recreate even if audio exists"
            checked={settings.forceTts}
            onChange={(value) => updateSettings({ forceTts: value })}
            disabled={!settings.withTts}
          />
        </div>
      </div>

      {/* Apply to Pending */}
      <div className="apply-pending">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.applyToPending}
            onChange={(e) => updateSettings({ applyToPending: e.target.checked })}
          />
          <span className="checkbox-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span>Apply these settings to pending uploads</span>
        </label>
      </div>

      <style>{`
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-4);
        }

        .settings-title {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .settings-icon {
          width: 44px;
          height: 44px;
          background: var(--gradient-primary);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .settings-title .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .settings-title h2 {
          font-size: var(--text-lg);
          margin: 0;
        }

        .btn-reset {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-full);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-reset:hover {
          background: var(--bg-tertiary);
          border-color: var(--border-medium);
        }

        .settings-banner {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
        }

        .settings-banner.info {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          color: var(--text-secondary);
        }

        .settings-banner.warning {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: var(--color-warning-600);
        }

        .settings-banner.error {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.3);
          color: var(--color-error-600);
        }

        .spinner-small {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border-light);
          border-top-color: var(--color-primary-500);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--space-5);
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .field-full {
          grid-column: 1 / -1;
        }

        .field-label {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .field-label > span:first-child {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .field-hint {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .field-select {
          padding: var(--space-3) var(--space-4);
          padding-right: var(--space-10);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-light);
          background: var(--bg-primary);
          font-size: var(--text-sm);
          color: var(--text-primary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .field-select:hover {
          border-color: var(--border-medium);
        }

        .field-select:focus {
          border-color: var(--color-primary-400);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        .apply-pending {
          padding-top: var(--space-4);
          border-top: 1px solid var(--border-light);
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          font-size: var(--text-sm);
          color: var(--text-secondary);
          cursor: pointer;
        }

        .checkbox-label input {
          display: none;
        }

        .checkbox-box {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border-medium);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }

        .checkbox-box svg {
          width: 14px;
          height: 14px;
          stroke: white;
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        .checkbox-label input:checked + .checkbox-box {
          background: var(--color-primary-500);
          border-color: var(--color-primary-500);
        }

        .checkbox-label input:checked + .checkbox-box svg {
          opacity: 1;
        }
      `}</style>
    </section>
  );
};

interface ToggleFieldProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

const ToggleField: React.FC<ToggleFieldProps> = ({
  label,
  description,
  checked,
  disabled,
  onChange,
}) => {
  return (
    <div className={`toggle-field ${disabled ? 'disabled' : ''}`}>
      <div className="toggle-info">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`toggle-switch ${checked ? 'active' : ''}`}
      >
        <span className="toggle-thumb" />
      </button>

      <style>{`
        .toggle-field {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          transition: all var(--transition-fast);
        }

        .toggle-field:hover:not(.disabled) {
          border-color: var(--border-medium);
        }

        .toggle-field.disabled {
          opacity: 0.5;
        }

        .toggle-info {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .toggle-label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .toggle-desc {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .toggle-switch {
          position: relative;
          width: 48px;
          height: 26px;
          background: var(--color-gray-300);
          border: none;
          border-radius: var(--radius-full);
          padding: 0;
          cursor: pointer;
          transition: background var(--transition-fast);
          flex-shrink: 0;
        }

        .toggle-switch:disabled {
          cursor: not-allowed;
        }

        .toggle-switch.active {
          background: var(--color-primary-500);
        }

        .toggle-switch .toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          display: block;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          box-shadow: var(--shadow-sm);
          transition: transform var(--transition-fast);
        }

        .toggle-switch.active .toggle-thumb {
          transform: translateX(22px);
        }
      `}</style>
    </div>
  );
};
