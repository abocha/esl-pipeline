import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  type BusinessSettings,
  getBusinessSettings,
  updateBusinessSettings,
} from '../../utils/api';
import { TIMEZONE_OPTIONS } from '../../utils/timezones';
import { BusinessInfoHint } from './BusinessInfoHint';

export const BusinessSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [form, setForm] = useState({
    defaultCurrency: 'USD',
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
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Settings</h2>
        </header>
        <p className="business-empty">Loading business settings...</p>
      </section>
    );
  }
  if (!settings) {
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Settings</h2>
        </header>
        <div className="business-empty">
          <p className="business-dashboard-error" role="alert">
            {error ?? 'Business settings failed.'}
          </p>
          <button type="button" onClick={() => void loadSettings()}>
            Retry
          </button>
        </div>
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
      <article className="business-panel business-panel-wide">
        <header className="business-agenda-heading">
          <h2>Settings</h2>
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
          <div className="business-setting">
            <div className="business-setting-label">
              <label htmlFor="business-currency">Default currency</label>
              <BusinessInfoHint id="business-currency-hint" label="default currency">
                Selects the payments included in monthly stats. Other currencies are listed
                separately.
              </BusinessInfoHint>
            </div>
            <input
              id="business-currency"
              aria-describedby="business-currency-hint"
              maxLength={3}
              value={form.defaultCurrency}
              onChange={(event) =>
                setForm({ ...form, defaultCurrency: event.target.value.toUpperCase() })
              }
            />
          </div>
          <div className="business-setting">
            <div className="business-setting-label">
              <label htmlFor="business-timezone">Timezone</label>
              <BusinessInfoHint id="business-timezone-hint" label="timezone">
                Controls manual lesson entry and schedule display. Existing weekly plans keep their
                saved timezone.
              </BusinessInfoHint>
            </div>
            <select
              id="business-timezone"
              aria-describedby="business-timezone-hint"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            >
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="business-setting">
            <div className="business-setting-label">
              <label htmlFor="business-horizon">Planning horizon (days)</label>
              <BusinessInfoHint id="business-horizon-hint" label="planning horizon">
                How far ahead Stats looks for scheduled workload and credit watch, starting today.
              </BusinessInfoHint>
            </div>
            <input
              id="business-horizon"
              aria-describedby="business-horizon-hint"
              min="7"
              max="180"
              type="number"
              value={form.forecastHorizonDays}
              onChange={(event) => setForm({ ...form, forecastHorizonDays: event.target.value })}
            />
          </div>
          <div className="business-setting">
            <div className="business-setting-label">
              <label htmlFor="business-threshold">Top-up threshold (credits)</label>
              <BusinessInfoHint id="business-threshold-hint" label="top-up threshold">
                Flags lesson balances at or below this number. Low credits do not establish that a
                payment is due.
              </BusinessInfoHint>
            </div>
            <input
              id="business-threshold"
              aria-describedby="business-threshold-hint"
              min="0"
              type="number"
              value={form.topUpThreshold}
              onChange={(event) => setForm({ ...form, topUpThreshold: event.target.value })}
            />
          </div>
          <div className="business-settings-actions">
            <button type="submit" className="business-primary-button" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            <p className="business-dashboard-success" role="status">
              {success}
            </p>
          </div>
        </form>
      </article>
    </section>
  );
};
function setFormFromSettings(
  settings: BusinessSettings,
  setForm: React.Dispatch<
    React.SetStateAction<{
      defaultCurrency: string;
      timezone: string;
      forecastHorizonDays: string;
      topUpThreshold: string;
    }>
  >,
) {
  setForm({
    defaultCurrency: settings.defaultCurrency,
    timezone: settings.timezone,
    forecastHorizonDays: String(settings.forecastHorizonDays),
    topUpThreshold: String(settings.topUpThreshold),
  });
}
