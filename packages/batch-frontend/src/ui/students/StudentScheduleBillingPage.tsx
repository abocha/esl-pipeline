import React, { useEffect, useState } from 'react';

import {
  addStudentPackage,
  createStudentLesson,
  getStudentScheduleBillingSurface,
  type StudentScheduleBillingSurface,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';
import {
  StudentAreaActionLink,
  StudentAreaEmptyState,
  StudentAreaMetricCard,
  StudentAreaPanel,
  StudentAreaSectionLabel,
  StudentAreaStatusPill,
} from './StudentAreaDesignSystem';
import './StudentScheduleBillingPage.css';

const DEFAULT_LESSON_START = '2026-05-07T10:00';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

function formatDateTime(value?: string | null): string {
  if (!value) return 'Not scheduled yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not scheduled yet' : DATE_TIME_FORMATTER.format(date);
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded yet' : DATE_FORMATTER.format(date);
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatCredits(value: number): string {
  return `${value} lesson credit${Math.abs(value) === 1 ? '' : 's'}`;
}

function toIsoFromDateTimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export const StudentScheduleBillingPage: React.FC = () => {
  const { student, studentId } = useStudentAreaContext();
  const studentName = student?.student ?? 'this student';
  const [surface, setSurface] = useState<StudentScheduleBillingSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({
    timezone: 'UTC',
    defaultDurationMinutes: '60',
    cadence: '',
    preferredTimes: '',
    schedulingNotes: '',
  });
  const [packageForm, setPackageForm] = useState({
    lessons: '8',
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [lessonForm, setLessonForm] = useState({
    startsAt: DEFAULT_LESSON_START,
    durationMinutes: '60',
    timezone: 'UTC',
    title: '',
    notes: '',
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!studentId) return;
      setLoading(true);
      setError(null);
      try {
        const nextSurface = await getStudentScheduleBillingSurface(studentId);
        if (!active) return;
        setSurface(nextSurface);
        setPlanForm({
          timezone: nextSurface.lessonPlan.timezone,
          defaultDurationMinutes: String(nextSurface.lessonPlan.defaultDurationMinutes),
          cadence: nextSurface.lessonPlan.cadence ?? '',
          preferredTimes: nextSurface.lessonPlan.preferredTimes ?? '',
          schedulingNotes: nextSurface.lessonPlan.schedulingNotes ?? '',
        });
        setLessonForm((current) => ({
          ...current,
          timezone: nextSurface.lessonPlan.timezone,
          durationMinutes: String(nextSurface.lessonPlan.defaultDurationMinutes),
        }));
      } catch (loadError: unknown) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Schedule and billing failed.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [studentId]);

  const runAction = async (
    key: string,
    action: () => Promise<StudentScheduleBillingSurface>,
  ): Promise<void> => {
    setSaving(key);
    setError(null);
    try {
      setSurface(await action());
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed.');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <section className="student-schedule-billing-page student-area-theme">
        <StudentAreaEmptyState>Loading schedule and billing...</StudentAreaEmptyState>
      </section>
    );
  }

  if (!surface) {
    return (
      <section className="student-schedule-billing-page student-area-theme">
        <StudentAreaEmptyState>
          {error ?? 'Schedule and billing is unavailable.'}
        </StudentAreaEmptyState>
      </section>
    );
  }

  const creditTone = surface.creditSummary.isNegative
    ? 'warning'
    : surface.creditSummary.isLow
      ? 'attention'
      : 'success';

  return (
    <section className="student-schedule-billing-page student-area-theme">
      {error ? (
        <p className="student-schedule-billing-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="student-schedule-billing-grid">
        <StudentAreaMetricCard
          eyebrow="Next lesson"
          value={surface.nextLesson ? formatDateTime(surface.nextLesson.startsAt) : 'Not scheduled'}
          detail={
            surface.nextLesson ? `${surface.nextLesson.durationMinutes} min` : 'Add a lesson below.'
          }
        />
        <StudentAreaMetricCard
          eyebrow="Lesson credits"
          value={formatCredits(surface.creditSummary.remaining)}
          detail={`${surface.creditSummary.purchased} purchased, ${surface.creditSummary.consumed} used`}
          tone={creditTone}
        />
        <StudentAreaMetricCard
          eyebrow="Reminders"
          value={surface.reminders.length === 0 ? 'Clear' : `${surface.reminders.length} ready`}
          detail="Copyable text only for now."
          tone={surface.reminders.length === 0 ? 'success' : 'attention'}
        />
        <StudentAreaMetricCard
          eyebrow="Latest payment"
          value={
            surface.payments[0]
              ? formatMoney(surface.payments[0].amountMinor, surface.payments[0].currency)
              : 'Not tracked'
          }
          detail={
            surface.payments[0]
              ? formatDate(surface.payments[0].receivedAt)
              : 'Record payment with a package.'
          }
        />
      </div>

      <div className="student-schedule-billing-columns">
        <StudentAreaPanel className="student-schedule-billing-panel">
          <header>
            <StudentAreaSectionLabel>Lesson Planning</StudentAreaSectionLabel>
            <p>Keep the next lesson and recurring preferences separate from the learner profile.</p>
          </header>
          <form
            className="student-schedule-billing-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction('plan', () =>
                updateStudentLessonPlan(studentId, {
                  timezone: planForm.timezone,
                  defaultDurationMinutes: Number(planForm.defaultDurationMinutes),
                  cadence: planForm.cadence || null,
                  preferredTimes: planForm.preferredTimes || null,
                  schedulingNotes: planForm.schedulingNotes || null,
                }),
              );
            }}
          >
            <label>
              Timezone
              <input
                value={planForm.timezone}
                onChange={(event) => setPlanForm({ ...planForm, timezone: event.target.value })}
              />
            </label>
            <label>
              Default duration
              <input
                min="1"
                type="number"
                value={planForm.defaultDurationMinutes}
                onChange={(event) =>
                  setPlanForm({ ...planForm, defaultDurationMinutes: event.target.value })
                }
              />
            </label>
            <label>
              Cadence
              <input
                placeholder="Weekly"
                value={planForm.cadence}
                onChange={(event) => setPlanForm({ ...planForm, cadence: event.target.value })}
              />
            </label>
            <label>
              Preferred times
              <input
                placeholder="Tue or Thu mornings"
                value={planForm.preferredTimes}
                onChange={(event) =>
                  setPlanForm({ ...planForm, preferredTimes: event.target.value })
                }
              />
            </label>
            <label className="student-schedule-billing-wide">
              Scheduling notes
              <textarea
                value={planForm.schedulingNotes}
                onChange={(event) =>
                  setPlanForm({ ...planForm, schedulingNotes: event.target.value })
                }
              />
            </label>
            <button type="submit" disabled={saving === 'plan'}>
              Save plan
            </button>
          </form>
        </StudentAreaPanel>

        <StudentAreaPanel className="student-schedule-billing-panel">
          <header>
            <StudentAreaSectionLabel>Package And Payment</StudentAreaSectionLabel>
            <p>Add paid lesson credits and optionally record the matching payment.</p>
          </header>
          <form
            className="student-schedule-billing-form"
            onSubmit={(event) => {
              event.preventDefault();
              const amountMajor = packageForm.amountMajor.trim();
              void runAction('package', () =>
                addStudentPackage(studentId, {
                  lessons: Number(packageForm.lessons),
                  note: packageForm.note || null,
                  payment: amountMajor
                    ? {
                        amountMinor: Math.round(Number(amountMajor) * 100),
                        currency: packageForm.currency.toUpperCase(),
                        method: packageForm.method || null,
                        note: packageForm.note || null,
                      }
                    : null,
                }),
              );
            }}
          >
            <label>
              Lessons
              <input
                min="1"
                type="number"
                value={packageForm.lessons}
                onChange={(event) =>
                  setPackageForm({ ...packageForm, lessons: event.target.value })
                }
              />
            </label>
            <label>
              Amount
              <input
                inputMode="decimal"
                placeholder="120.00"
                value={packageForm.amountMajor}
                onChange={(event) =>
                  setPackageForm({ ...packageForm, amountMajor: event.target.value })
                }
              />
            </label>
            <label>
              Currency
              <input
                maxLength={3}
                value={packageForm.currency}
                onChange={(event) =>
                  setPackageForm({ ...packageForm, currency: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Method
              <input
                placeholder="Bank transfer"
                value={packageForm.method}
                onChange={(event) => setPackageForm({ ...packageForm, method: event.target.value })}
              />
            </label>
            <label className="student-schedule-billing-wide">
              Note
              <textarea
                value={packageForm.note}
                onChange={(event) => setPackageForm({ ...packageForm, note: event.target.value })}
              />
            </label>
            <button type="submit" disabled={saving === 'package'}>
              Add package
            </button>
          </form>
        </StudentAreaPanel>
      </div>

      <StudentAreaPanel className="student-schedule-billing-panel">
        <header>
          <StudentAreaSectionLabel>Lessons</StudentAreaSectionLabel>
          <p>Credits are consumed only when a completed lesson is marked chargeable.</p>
        </header>
        <form
          className="student-schedule-billing-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction('lesson', () =>
              createStudentLesson(studentId, {
                startsAt: toIsoFromDateTimeLocal(lessonForm.startsAt),
                timezone: lessonForm.timezone,
                durationMinutes: Number(lessonForm.durationMinutes),
                title: lessonForm.title || null,
                notes: lessonForm.notes || null,
              }),
            );
          }}
        >
          <label>
            Starts
            <input
              type="datetime-local"
              value={lessonForm.startsAt}
              onChange={(event) => setLessonForm({ ...lessonForm, startsAt: event.target.value })}
            />
          </label>
          <label>
            Duration
            <input
              min="1"
              type="number"
              value={lessonForm.durationMinutes}
              onChange={(event) =>
                setLessonForm({ ...lessonForm, durationMinutes: event.target.value })
              }
            />
          </label>
          <label>
            Timezone
            <input
              value={lessonForm.timezone}
              onChange={(event) => setLessonForm({ ...lessonForm, timezone: event.target.value })}
            />
          </label>
          <label>
            Title
            <input
              value={lessonForm.title}
              onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })}
            />
          </label>
          <label className="student-schedule-billing-wide">
            Notes
            <textarea
              value={lessonForm.notes}
              onChange={(event) => setLessonForm({ ...lessonForm, notes: event.target.value })}
            />
          </label>
          <button type="submit" disabled={saving === 'lesson'}>
            Add lesson
          </button>
        </form>

        {surface.lessons.length === 0 ? (
          <StudentAreaEmptyState>No lessons tracked for {studentName} yet.</StudentAreaEmptyState>
        ) : (
          <div className="student-schedule-billing-list">
            {surface.lessons.map((lesson) => (
              <article key={lesson.id} className="student-schedule-billing-list-row">
                <span>
                  <strong>{lesson.title || formatDateTime(lesson.startsAt)}</strong>
                  <small>
                    {formatDateTime(lesson.startsAt)} · {lesson.durationMinutes} min
                  </small>
                </span>
                <StudentAreaStatusPill
                  tone={
                    lesson.status === 'completed'
                      ? 'success'
                      : lesson.status === 'scheduled'
                        ? 'quiet'
                        : 'attention'
                  }
                >
                  {lesson.status.replace('_', ' ')}
                </StudentAreaStatusPill>
                {lesson.status === 'scheduled' ? (
                  <button
                    type="button"
                    disabled={saving === lesson.id}
                    onClick={() => {
                      void runAction(lesson.id, () =>
                        updateStudentLesson(studentId, lesson.id, {
                          status: 'completed',
                          consumesCredit: true,
                        }),
                      );
                    }}
                  >
                    Complete
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </StudentAreaPanel>

      <StudentAreaPanel className="student-schedule-billing-panel">
        <header>
          <StudentAreaSectionLabel>Reminders</StudentAreaSectionLabel>
          <p>Delivery is not connected yet; use copyable text for manual follow-up.</p>
        </header>
        {surface.reminders.length === 0 ? (
          <StudentAreaEmptyState>No operational reminders are needed.</StudentAreaEmptyState>
        ) : (
          <div className="student-schedule-billing-list">
            {surface.reminders.map((reminder) => (
              <article key={reminder.type} className="student-schedule-billing-reminder">
                <StudentAreaStatusPill
                  tone={reminder.severity === 'urgent' ? 'warning' : 'attention'}
                >
                  {reminder.channel}
                </StudentAreaStatusPill>
                <span>
                  <strong>{reminder.title}</strong>
                  <small>{reminder.message}</small>
                </span>
                <textarea readOnly value={reminder.copyText} />
              </article>
            ))}
          </div>
        )}
        <StudentAreaActionLink to={`/students/${encodeURIComponent(studentId)}/overview`}>
          Back to overview
        </StudentAreaActionLink>
      </StudentAreaPanel>
    </section>
  );
};
