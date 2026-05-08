import React, { useEffect, useState } from 'react';

import {
  addStudentPackage,
  createStudentLesson,
  getStudentScheduleBillingSurface,
  recordStudentPayment,
  type StudentScheduleBillingSurface,
  updateStudentLesson,
  updateStudentLessonPlan,
  upsertPrimaryStudentLessonRecurrence,
} from '../../utils/api';
import { TIMEZONE_OPTIONS } from '../../utils/timezones';
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
const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];
interface RecurrenceSlotForm {
  isoWeekday: number;
  localStartTime: string;
  durationMinutes: string;
}

interface RecurrenceFormState {
  timezone: string;
  startsOn: string;
  status: 'active' | 'paused';
  generationHorizonDays: string;
  localStartTime: string;
  durationMinutes: string;
  slots: RecurrenceSlotForm[];
}

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

function todayInput(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DEFAULT_LESSON_START;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  const [recurrenceForm, setRecurrenceForm] = useState({
    timezone: 'UTC',
    startsOn: todayInput(),
    status: 'active' as 'active' | 'paused',
    generationHorizonDays: '56',
    localStartTime: '11:00',
    durationMinutes: '60',
    slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: '60' }],
  } satisfies RecurrenceFormState);
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
  const [paymentForm, setPaymentForm] = useState({
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonEditForm, setLessonEditForm] = useState({
    startsAt: DEFAULT_LESSON_START,
    durationMinutes: '60',
    timezone: 'UTC',
    title: '',
    notes: '',
    consumesCredit: true,
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
        setRecurrenceFormFromSurface(nextSurface, setRecurrenceForm);
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
                  cadence: null,
                  preferredTimes: null,
                  schedulingNotes: planForm.schedulingNotes || null,
                }).then(() =>
                  upsertPrimaryStudentLessonRecurrence(studentId, {
                    timezone: recurrenceForm.timezone,
                    startsOn: recurrenceForm.startsOn,
                    status: recurrenceForm.status,
                    generationHorizonDays: Number(recurrenceForm.generationHorizonDays),
                    slots: recurrenceForm.slots.map((slot) => ({
                      isoWeekday: slot.isoWeekday,
                      localStartTime: slot.localStartTime,
                      durationMinutes: Number(slot.durationMinutes),
                    })),
                  }),
                ),
              );
            }}
          >
            <label>
              Timezone
              <select
                value={recurrenceForm.timezone}
                onChange={(event) => {
                  setRecurrenceForm({ ...recurrenceForm, timezone: event.target.value });
                  setPlanForm({ ...planForm, timezone: event.target.value });
                }}
              >
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default duration
              <input
                min="1"
                type="number"
                value={recurrenceForm.durationMinutes}
                onChange={(event) => {
                  setRecurrenceForm({
                    ...recurrenceForm,
                    durationMinutes: event.target.value,
                    slots: recurrenceForm.slots.map((slot) => ({
                      ...slot,
                      durationMinutes: event.target.value,
                    })),
                  });
                  setPlanForm({ ...planForm, defaultDurationMinutes: event.target.value });
                }}
              />
            </label>
            <label>
              Starts on
              <input
                type="date"
                value={recurrenceForm.startsOn}
                onChange={(event) =>
                  setRecurrenceForm({ ...recurrenceForm, startsOn: event.target.value })
                }
              />
            </label>
            <label>
              Time
              <input
                type="time"
                value={recurrenceForm.localStartTime}
                onChange={(event) =>
                  setRecurrenceForm({
                    ...recurrenceForm,
                    localStartTime: event.target.value,
                    slots: recurrenceForm.slots.map((slot) => ({
                      ...slot,
                      localStartTime: event.target.value,
                    })),
                  })
                }
              />
            </label>
            <label>
              Generate ahead
              <input
                min="7"
                max="366"
                type="number"
                value={recurrenceForm.generationHorizonDays}
                onChange={(event) =>
                  setRecurrenceForm({
                    ...recurrenceForm,
                    generationHorizonDays: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Rule status
              <select
                value={recurrenceForm.status}
                onChange={(event) =>
                  setRecurrenceForm({
                    ...recurrenceForm,
                    status: event.target.value as 'active' | 'paused',
                  })
                }
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
            <fieldset className="student-schedule-billing-weekdays">
              <legend>Repeats weekly</legend>
              {WEEKDAYS.map((weekday) => {
                const selected = recurrenceForm.slots.some(
                  (slot) => slot.isoWeekday === weekday.value,
                );
                return (
                  <button
                    key={weekday.value}
                    type="button"
                    className={selected ? 'selected' : ''}
                    onClick={() => {
                      const slots = selected
                        ? recurrenceForm.slots.filter((slot) => slot.isoWeekday !== weekday.value)
                        : [
                            ...recurrenceForm.slots,
                            {
                              isoWeekday: weekday.value,
                              localStartTime: recurrenceForm.localStartTime,
                              durationMinutes: recurrenceForm.durationMinutes,
                            },
                          ].sort((left, right) => left.isoWeekday - right.isoWeekday);
                      setRecurrenceForm({
                        ...recurrenceForm,
                        slots: slots.length
                          ? slots
                          : [
                              {
                                isoWeekday: weekday.value,
                                localStartTime: recurrenceForm.localStartTime,
                                durationMinutes: recurrenceForm.durationMinutes,
                              },
                            ],
                      });
                    }}
                  >
                    {weekday.label}
                  </button>
                );
              })}
            </fieldset>
            <div className="student-schedule-billing-slot-grid student-schedule-billing-wide">
              {recurrenceForm.slots.map((slot) => {
                const weekday = WEEKDAYS.find((item) => item.value === slot.isoWeekday);
                const label = weekday?.label ?? `Day ${slot.isoWeekday}`;
                return (
                  <div className="student-schedule-billing-slot-row" key={slot.isoWeekday}>
                    <strong>{label}</strong>
                    <label>
                      Time
                      <input
                        aria-label={`${label} time`}
                        type="time"
                        value={slot.localStartTime}
                        onChange={(event) =>
                          setRecurrenceForm({
                            ...recurrenceForm,
                            slots: recurrenceForm.slots.map((current) =>
                              current.isoWeekday === slot.isoWeekday
                                ? { ...current, localStartTime: event.target.value }
                                : current,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Duration
                      <input
                        aria-label={`${label} duration`}
                        min="1"
                        type="number"
                        value={slot.durationMinutes}
                        onChange={(event) =>
                          setRecurrenceForm({
                            ...recurrenceForm,
                            slots: recurrenceForm.slots.map((current) =>
                              current.isoWeekday === slot.isoWeekday
                                ? { ...current, durationMinutes: event.target.value }
                                : current,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>
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
                {lesson.recurrenceOrigin === 'generated' ? (
                  <StudentAreaStatusPill tone="quiet">generated</StudentAreaStatusPill>
                ) : null}
                <div className="student-schedule-billing-actions">
                  {lesson.status === 'scheduled' ? (
                    <>
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
                      <button
                        type="button"
                        disabled={saving === lesson.id}
                        onClick={() => {
                          void runAction(lesson.id, () =>
                            updateStudentLesson(studentId, lesson.id, {
                              status: 'no_show',
                              consumesCredit: false,
                            }),
                          );
                        }}
                      >
                        No-show
                      </button>
                      <button
                        type="button"
                        disabled={saving === lesson.id}
                        onClick={() => {
                          void runAction(lesson.id, () =>
                            updateStudentLesson(studentId, lesson.id, {
                              status: 'canceled',
                              consumesCredit: false,
                            }),
                          );
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={saving === lesson.id}
                      onClick={() => {
                        void runAction(lesson.id, () =>
                          updateStudentLesson(studentId, lesson.id, {
                            status: 'scheduled',
                            consumesCredit: false,
                          }),
                        );
                      }}
                    >
                      Restore
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving === lesson.id}
                    onClick={() => {
                      setEditingLessonId(lesson.id);
                      setLessonEditForm({
                        startsAt: toDateTimeLocal(lesson.startsAt),
                        durationMinutes: String(lesson.durationMinutes),
                        timezone: lesson.timezone,
                        title: lesson.title ?? '',
                        notes: lesson.notes ?? '',
                        consumesCredit: lesson.consumesCredit,
                      });
                    }}
                  >
                    Edit
                  </button>
                </div>
                {editingLessonId === lesson.id ? (
                  <form
                    className="student-schedule-billing-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runAction(lesson.id, () =>
                        updateStudentLesson(studentId, lesson.id, {
                          startsAt: toIsoFromDateTimeLocal(lessonEditForm.startsAt),
                          timezone: lessonEditForm.timezone,
                          durationMinutes: Number(lessonEditForm.durationMinutes),
                          title: lessonEditForm.title || null,
                          notes: lessonEditForm.notes || null,
                          consumesCredit: lessonEditForm.consumesCredit,
                        }).then((nextSurface) => {
                          setEditingLessonId(null);
                          return nextSurface;
                        }),
                      );
                    }}
                  >
                    <label>
                      Starts
                      <input
                        type="datetime-local"
                        value={lessonEditForm.startsAt}
                        onChange={(event) =>
                          setLessonEditForm({ ...lessonEditForm, startsAt: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Duration
                      <input
                        min="1"
                        type="number"
                        value={lessonEditForm.durationMinutes}
                        onChange={(event) =>
                          setLessonEditForm({
                            ...lessonEditForm,
                            durationMinutes: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Chargeable
                      <input
                        type="checkbox"
                        checked={lessonEditForm.consumesCredit}
                        onChange={(event) =>
                          setLessonEditForm({
                            ...lessonEditForm,
                            consumesCredit: event.target.checked,
                          })
                        }
                      />
                    </label>
                    <button type="submit" disabled={saving === lesson.id}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingLessonId(null)}>
                      Close
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </StudentAreaPanel>

      <StudentAreaPanel className="student-schedule-billing-panel">
        <header>
          <StudentAreaSectionLabel>Payment History</StudentAreaSectionLabel>
          <p>Recorded payments are factual ledger entries, separate from lesson-credit packages.</p>
        </header>
        <form
          className="student-schedule-billing-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction('payment', () =>
              recordStudentPayment(studentId, {
                amountMinor: Math.round(Number(paymentForm.amountMajor) * 100),
                currency: paymentForm.currency.toUpperCase(),
                method: paymentForm.method || null,
                note: paymentForm.note || null,
              }),
            );
          }}
        >
          <label>
            Amount
            <input
              inputMode="decimal"
              value={paymentForm.amountMajor}
              onChange={(event) =>
                setPaymentForm({ ...paymentForm, amountMajor: event.target.value })
              }
            />
          </label>
          <label>
            Currency
            <input
              maxLength={3}
              value={paymentForm.currency}
              onChange={(event) =>
                setPaymentForm({ ...paymentForm, currency: event.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Method
            <input
              value={paymentForm.method}
              onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}
            />
          </label>
          <label className="student-schedule-billing-wide">
            Note
            <textarea
              value={paymentForm.note}
              onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })}
            />
          </label>
          <button type="submit" disabled={saving === 'payment'}>
            Record payment
          </button>
        </form>
        <div className="student-schedule-billing-list">
          {surface.payments.map((payment) => (
            <article key={payment.id} className="student-schedule-billing-list-row compact">
              <span>
                <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
                <small>
                  {formatDate(payment.receivedAt)}
                  {payment.method ? ` · ${payment.method}` : ''}
                </small>
              </span>
              {payment.note ? <small>{payment.note}</small> : null}
            </article>
          ))}
        </div>
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

function setRecurrenceFormFromSurface(
  surface: StudentScheduleBillingSurface,
  setRecurrenceForm: React.Dispatch<React.SetStateAction<RecurrenceFormState>>,
) {
  const firstSlot = surface.recurrenceRule?.slots[0];
  const slots = surface.recurrenceRule?.slots.length
    ? surface.recurrenceRule.slots.map((slot) => ({
        isoWeekday: slot.isoWeekday,
        localStartTime: slot.localStartTime,
        durationMinutes: String(slot.durationMinutes),
      }))
    : [
        {
          isoWeekday: 1,
          localStartTime: '11:00',
          durationMinutes: String(surface.lessonPlan.defaultDurationMinutes),
        },
      ];
  setRecurrenceForm({
    timezone: surface.recurrenceRule?.timezone ?? surface.lessonPlan.timezone,
    startsOn: surface.recurrenceRule?.startsOn ?? todayInput(),
    status: surface.recurrenceRule?.status === 'paused' ? 'paused' : 'active',
    generationHorizonDays: String(surface.recurrenceRule?.generationHorizonDays ?? 56),
    localStartTime: firstSlot?.localStartTime ?? '11:00',
    durationMinutes: String(
      firstSlot?.durationMinutes ?? surface.lessonPlan.defaultDurationMinutes,
    ),
    slots,
  });
}
