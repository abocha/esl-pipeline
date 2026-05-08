import React, { useEffect, useState } from 'react';

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
    defaultLessonDurationMinutes: '60',
    timezone: 'UTC',
    forecastHorizonDays: '45',
    noShowRatePercent: '0',
    cancellationRatePercent: '0',
    topUpThreshold: '2',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextSettings = await getBusinessSettings();
        if (!active) return;
        setSettings(nextSettings);
        setFormFromSettings(nextSettings, setForm);
      } catch (loadError: unknown) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Business settings failed.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <section className="business-empty">Loading business settings...</section>;
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
          <h2>Forecast defaults</h2>
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
              defaultLessonDurationMinutes: Number(form.defaultLessonDurationMinutes),
              timezone: form.timezone,
              forecastHorizonDays: Number(form.forecastHorizonDays),
              noShowRateBasisPoints: Math.round(Number(form.noShowRatePercent) * 100),
              cancellationRateBasisPoints: Math.round(Number(form.cancellationRatePercent) * 100),
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
            Lesson rate
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.defaultLessonRateMajor}
              onChange={(event) => setForm({ ...form, defaultLessonRateMajor: event.target.value })}
            />
          </label>
          <label>
            Default duration
            <input
              min="1"
              type="number"
              value={form.defaultLessonDurationMinutes}
              onChange={(event) =>
                setForm({ ...form, defaultLessonDurationMinutes: event.target.value })
              }
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
            Forecast horizon
            <input
              min="7"
              max="180"
              type="number"
              value={form.forecastHorizonDays}
              onChange={(event) => setForm({ ...form, forecastHorizonDays: event.target.value })}
            />
          </label>
          <label>
            No-show correction %
            <input
              min="0"
              max="100"
              step="0.1"
              type="number"
              value={form.noShowRatePercent}
              onChange={(event) => setForm({ ...form, noShowRatePercent: event.target.value })}
            />
          </label>
          <label>
            Cancellation correction %
            <input
              min="0"
              max="100"
              step="0.1"
              type="number"
              value={form.cancellationRatePercent}
              onChange={(event) =>
                setForm({ ...form, cancellationRatePercent: event.target.value })
              }
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
          <p className="business-muted">Set a lesson rate to unlock money forecasts.</p>
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
      defaultLessonDurationMinutes: string;
      timezone: string;
      forecastHorizonDays: string;
      noShowRatePercent: string;
      cancellationRatePercent: string;
      topUpThreshold: string;
    }>
  >,
) {
  setForm({
    defaultCurrency: settings.defaultCurrency,
    defaultLessonRateMajor: String(settings.defaultLessonRateMinor / 100),
    defaultLessonDurationMinutes: String(settings.defaultLessonDurationMinutes),
    timezone: settings.timezone,
    forecastHorizonDays: String(settings.forecastHorizonDays),
    noShowRatePercent: String(settings.noShowRateBasisPoints / 100),
    cancellationRatePercent: String(settings.cancellationRateBasisPoints / 100),
    topUpThreshold: String(settings.topUpThreshold),
  });
}
