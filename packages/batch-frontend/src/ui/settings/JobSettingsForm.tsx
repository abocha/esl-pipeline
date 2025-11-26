import React from 'react';

import { useJobSettings } from '../../context/JobSettingsContext';
import type { JobSettings as JobSettingsValue } from '../../context/JobSettingsContext';

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

  // const notionOptions = options.notionDatabases; // Temporarily unused

  return (
    <section style={cardStyle}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={eyebrowStyle}>Job defaults</p>
          <h2 style={{ margin: 0, fontSize: '22px' }}>Submission settings</h2>
        </div>
        <button type="button" onClick={resetSettings} style={resetButtonStyle}>
          Reset
        </button>
      </header>

      {isLoading && (
        <div style={infoBannerStyle}>
          Fetching backend options… Using safe defaults until the response arrives.
        </div>
      )}
      {!isLoading && isUsingFallback && (
        <div style={warningBannerStyle}>
          Unable to reach `/config/job-options`. You can still submit jobs with fallback presets.
        </div>
      )}
      {errorMessage && !isLoading && (
        <div style={errorBannerStyle}>Metadata error: {errorMessage}</div>
      )}

      <div style={formGridStyle}>
        <label style={fieldStyle}>
          Preset
          <select
            value={settings.preset}
            onChange={(event) => updateSettings({ preset: event.target.value })}
            style={selectStyle}
          >
            {options.presets.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </label>

        {/* Notion database selector temporarily hidden - using default from env */}
        {/* <label style={fieldStyle}>
          Notion database
          <select
            value={settings.notionDatabase}
            onChange={(event) => updateSettings({ notionDatabase: event.target.value })}
            style={selectStyle}
          >
            {notionOptions.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name}
              </option>
            ))}
          </select>
        </label> */}

        <label style={fieldStyle}>
          Upload destination
          <div style={radioGroupStyle}>
            {options.uploadOptions.map((option) => (
              <label key={option} style={radioOptionStyle}>
                <input
                  type="radio"
                  name="upload-option"
                  value={option}
                  checked={settings.upload === option}
                  onChange={() => updateSettings({ upload: option })}
                />
                {uploadLabel(option)}
              </label>
            ))}
          </div>
        </label>

        <label style={fieldStyle}>
          Mode
          <select
            value={settings.mode}
            onChange={(event) =>
              updateSettings({ mode: event.target.value as JobSettingsValue['mode'] })
            }
            style={selectStyle}
          >
            {options.modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <span style={helperTextStyle}>
            Auto lets the backend decide; use dialogue for multi-speaker lessons or monologue for
            single voices.
          </span>
        </label>

        <ToggleField
          label="Generate TTS"
          description="Control if ElevenLabs audio should be generated for each job."
          checked={settings.withTts}
          onChange={(value) => updateSettings({ withTts: value })}
        />

        <ToggleField
          label="Force regenerate TTS"
          description="Even if audio exists, re-run TTS with freshly generated audio."
          checked={settings.forceTts}
          onChange={(value) => updateSettings({ forceTts: value })}
          disabled={!settings.withTts}
        />
      </div>

      <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={settings.applyToPending}
          onChange={(event) => updateSettings({ applyToPending: event.target.checked })}
        />
        Apply these settings to pending uploads
      </label>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
          {description && (
            <p style={{ margin: '2px 0 0', color: '#475569', fontSize: '13px' }}>{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          disabled={disabled}
          style={{
            ...toggleStyle,
            background: checked ? '#4F46E5' : '#E2E8F0',
            justifyContent: checked ? 'flex-end' : 'flex-start',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <span
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '999px',
              background: '#fff',
              display: 'inline-block',
            }}
          />
        </button>
      </div>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  padding: '28px',
  borderRadius: '20px',
  boxShadow: '0 25px 70px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '18px',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  color: '#475569',
  fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  borderRadius: '12px',
  border: '1px solid #cbd5f5',
  padding: '10px 12px',
  fontSize: '14px',
  background: '#fff',
};

const radioGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  background: '#f8fafc',
  padding: '8px',
  borderRadius: '12px',
};

const radioOptionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
};

const helperTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
};

const toggleStyle: React.CSSProperties = {
  width: '44px',
  height: '22px',
  borderRadius: '999px',
  border: 'none',
  padding: '3px',
  display: 'flex',
  alignItems: 'center',
};

const resetButtonStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '999px',
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 600,
  background: '#fff',
  cursor: 'pointer',
};

const infoBannerStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '10px 12px',
  fontSize: '13px',
  color: '#475569',
};

const warningBannerStyle: React.CSSProperties = {
  background: '#fff7ed',
  border: '1px solid #fed7aa',
  borderRadius: '12px',
  padding: '10px 12px',
  fontSize: '13px',
  color: '#9a3412',
};

const errorBannerStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '12px',
  padding: '10px 12px',
  fontSize: '13px',
  color: '#b91c1c',
};

function uploadLabel(option: JobSettingsValue['upload']): string {
  switch (option) {
    case 's3': {
      return 'Force S3 upload';
    }
    case 'none': {
      return 'Skip upload';
    }
    default: {
      return 'Auto (backend decides)';
    }
  }
}
