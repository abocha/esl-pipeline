import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  type BusinessSettings,
  getBusinessSettings,
  updateBusinessSettings,
} from '../../utils/api';
import { TIMEZONE_OPTIONS } from '../../utils/timezones';

export const BusinessSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [form, setForm] = useState({
    defaultCurrency: 'USD',
    defaultLessonRateMajor: '0',
    timezone: 'UTC',
    forecastHorizonDays: '45',
    topUpThreshold: '2',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mounted = useRef(true);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSettings = await getBusinessSettings();
      if (!mounted.current) return;
      setSettings(nextSettings);
      setFormFromSettings(nextSettings, setForm);
    } catch (loadError: unknown) {
      if (mounted.current) {
        setError(loadError instanceof Error ? loadError.message : 'Business settings failed.');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadSettings();
    return () => {
      mounted.current = false;
    };
  }, [loadSettings]);

  if (loading) {
    return <section className="business-empty">Loading business settings...</section>;
  }

  if (!settings) {
    return (
      <section className="business-empty">
        <p className="business-dashboard-error" role="alert">
          {error ?? 'Business settings failed.'}
        </p>
        <button type="button" onClick={() => void loadSettings()}>
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="business-dashboard-surface">
      {error ? (
        <p className="business-dashboard-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="business-dashboard-success">{success}</p> : null}

      <article className="business-panel business-panel-wide">
        <header>
          <span className="business-dashboard-kicker">Business Settings</span>
          <h2>Business defaults</h2>
        </header>
        <form
          className="business-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            setSuccess(null);
            void updateBusinessSettings({
              defaultCurrency: form.defaultCurrency.toUpperCase(),
              defaultLessonRateMinor: Math.round(Number(form.defaultLessonRateMajor) * 100),
              timezone: form.timezone,
              forecastHorizonDays: Number(form.forecastHorizonDays),
              topUpThreshold: Number(form.topUpThreshold),
            })
              .then((nextSettings) => {
                setSettings(nextSettings);
                setFormFromSettings(nextSettings, setForm);
                setSuccess('Business settings saved.');
              })
              .catch((saveError: unknown) => {
                setError(
                  saveError instanceof Error ? saveError.message : 'Unable to save settings.',
                );
              })
              .finally(() => setSaving(false));
          }}
        >
          <label>
            Default currency
            <input
              maxLength={3}
              value={form.defaultCurrency}
              onChange={(event) =>
                setForm({ ...form, defaultCurrency: event.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Default lesson rate
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.defaultLessonRateMajor}
              onChange={(event) => setForm({ ...form, defaultLessonRateMajor: event.target.value })}
            />
          </label>
          <label>
            Timezone
            <select
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            >
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Planning horizon
            <input
              min="7"
              max="180"
              type="number"
              value={form.forecastHorizonDays}
              onChange={(event) => setForm({ ...form, forecastHorizonDays: event.target.value })}
            />
          </label>
          <label>
            Top-up threshold
            <input
              min="0"
              type="number"
              value={form.topUpThreshold}
              onChange={(event) => setForm({ ...form, topUpThreshold: event.target.value })}
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </form>
        {settings?.defaultLessonRateMinor === 0 ? (
          <p className="business-muted">
            Set a default lesson rate to show completed and scheduled lesson values.
          </p>
        ) : null}
      </article>
    </section>
  );
};

function setFormFromSettings(
  settings: BusinessSettings,
  setForm: React.Dispatch<
    React.SetStateAction<{
      defaultCurrency: string;
      defaultLessonRateMajor: string;
      timezone: string;
      forecastHorizonDays: string;
      topUpThreshold: string;
    }>
  >,
) {
  setForm({
    defaultCurrency: settings.defaultCurrency,
    defaultLessonRateMajor: String(settings.defaultLessonRateMinor / 100),
    timezone: settings.timezone,
    forecastHorizonDays: String(settings.forecastHorizonDays),
    topUpThreshold: String(settings.topUpThreshold),
  });
}
