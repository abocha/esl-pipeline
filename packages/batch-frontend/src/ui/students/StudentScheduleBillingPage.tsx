import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  addStudentPackage,
  getBusinessSettings,
  getStudentScheduleBillingSurface,
  hideStudentLessonFollowupReminder,
  recordStudentPayment,
  type StudentScheduleBillingSurface,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../../utils/api';
import { CalendarSchedulingPanel } from '../calendar/CalendarSchedulingPanel';
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

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function formatDateTime(value: string | null | undefined, timezone: string): string {
  if (!value) return 'Not scheduled yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not scheduled yet'
    : date.toLocaleString('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded yet' : DATE_FORMATTER.format(date);
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatCredits(value: number): string {
  return `${value} lesson credit${Math.abs(value) === 1 ? '' : 's'}`;
}

function formatReminderLessonDetail(
  summary: StudentScheduleBillingSurface['reminders'][number]['lessonSummary'] | null | undefined,
  timezone: string,
): string {
  if (!summary) return 'Lesson no longer available';
  const topic = summary.title?.trim() ? summary.title.trim() : 'Untitled lesson';
  const date = formatDateTime(summary.startsAt, timezone);
  return `${date} · ${topic} · Lesson ${summary.lessonId}`;
}

export const StudentScheduleBillingPage: React.FC = () => {
  const { student, studentId } = useStudentAreaContext();
  const navigate = useNavigate();
  const studentName = student?.student ?? 'this student';
  const [surface, setSurface] = useState<StudentScheduleBillingSurface | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({
    timezone: 'UTC',
    defaultDurationMinutes: '60',
    schedulingNotes: '',
  });
  const [packageForm, setPackageForm] = useState({
    lessons: '8',
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonEditForm, setLessonEditForm] = useState({
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
        const [nextSurface, settings] = await Promise.all([
          getStudentScheduleBillingSurface(studentId),
          getBusinessSettings(),
        ]);
        if (!active) return;
        setSurface(nextSurface);
        setWorkspaceTimezone(settings.timezone);
        setPlanForm({
          timezone: settings.timezone,
          defaultDurationMinutes: String(nextSurface.lessonPlan.defaultDurationMinutes),
          schedulingNotes: nextSurface.lessonPlan.schedulingNotes ?? '',
        });
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

  const navigateToLessonAssignment = (lessonId: string) => {
    navigate(
      `/?studentId=${encodeURIComponent(studentId)}&lessonId=${encodeURIComponent(lessonId)}`,
    );
  };

  const canAddHomeworkForLesson = (lesson: StudentScheduleBillingSurface['lessons'][number]) => {
    if (lesson.homework.status !== 'not_started') return false;
    if (lesson.status === 'completed') return true;
    if (lesson.status !== 'scheduled') return false;
    const endsAt = new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60 * 1000;
    return Number.isFinite(endsAt) && endsAt <= Date.now();
  };

  const startHomeworkForLesson = async (
    lessonId: string,
  ): Promise<StudentScheduleBillingSurface> => {
    if (!lessonId) {
      throw new Error('Lesson follow-up is missing lesson context.');
    }
    if (!surface) {
      throw new Error('Schedule surface is not loaded.');
    }
    navigateToLessonAssignment(lessonId);
    return surface;
  };

  const startHomeworkFromReminder = async (
    reminder: StudentScheduleBillingSurface['reminders'][number],
  ): Promise<StudentScheduleBillingSurface> => {
    return startHomeworkForLesson(reminder.lessonId ?? '');
  };

  const hideReminder = async (
    reminder: StudentScheduleBillingSurface['reminders'][number],
  ): Promise<StudentScheduleBillingSurface> => {
    if (!reminder.lessonId) {
      throw new Error('Lesson follow-up is missing lesson context.');
    }
    return hideStudentLessonFollowupReminder(studentId, reminder.lessonId);
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
          value={
            surface.nextLesson
              ? formatDateTime(surface.nextLesson.startsAt, workspaceTimezone)
              : 'Not scheduled'
          }
          detail={
            surface.nextLesson
              ? `${surface.nextLesson.durationMinutes} min`
              : 'Check Google Calendar setup and sync below.'
          }
        />
        <StudentAreaMetricCard
          eyebrow="Lesson credits"
          value={formatCredits(surface.creditSummary.remaining)}
          detail={`${surface.creditSummary.purchased} purchased, ${surface.creditSummary.consumed} used`}
          tone={creditTone}
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

      {surface.workspaceId ? (
        <CalendarSchedulingPanel
          key={studentId}
          workspaceId={surface.workspaceId}
          studentId={studentId}
          studentName={studentName}
          email={student?.email ?? null}
          timezone={workspaceTimezone}
          defaultDurationMinutes={surface.lessonPlan.defaultDurationMinutes}
          onLedgerRefresh={async () =>
            setSurface(await getStudentScheduleBillingSurface(studentId))
          }
        />
      ) : null}
      <div className="student-schedule-billing-columns">
        <StudentAreaPanel className="student-schedule-billing-panel">
          <StudentAreaSectionLabel>Lesson defaults and notes</StudentAreaSectionLabel>
          <form
            className="student-schedule-billing-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction('plan', () =>
                updateStudentLessonPlan(studentId, {
                  timezone: workspaceTimezone,
                  defaultDurationMinutes: Number(planForm.defaultDurationMinutes),
                  schedulingNotes: planForm.schedulingNotes || null,
                }),
              );
            }}
          >
            <label>
              Default duration
              <input
                type="number"
                min="1"
                max="1440"
                value={planForm.defaultDurationMinutes}
                onChange={(event) =>
                  setPlanForm({ ...planForm, defaultDurationMinutes: event.target.value })
                }
              />
            </label>
            <label>
              Operational notes
              <textarea
                value={planForm.schedulingNotes}
                onChange={(event) =>
                  setPlanForm({ ...planForm, schedulingNotes: event.target.value })
                }
              />
            </label>
            <button type="submit" disabled={saving === 'plan'}>
              Save defaults
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
          <p>Lesson times: {workspaceTimezone}. Change the timezone in Business settings.</p>
        </header>
        {surface.lessons.length === 0 ? (
          <StudentAreaEmptyState>No lessons tracked for {studentName} yet.</StudentAreaEmptyState>
        ) : (
          <div className="student-schedule-billing-list">
            {surface.lessons.map((lesson) => (
              <article key={lesson.id} className="student-schedule-billing-list-row">
                <span>
                  <strong>
                    {lesson.title || formatDateTime(lesson.startsAt, workspaceTimezone)}
                  </strong>
                  <small>
                    {formatDateTime(lesson.startsAt, workspaceTimezone)} · {lesson.durationMinutes}{' '}
                    min
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
                <StudentAreaStatusPill tone="quiet">
                  {lesson.schedulingSource === 'calendar'
                    ? 'Google Calendar'
                    : 'Historical / unmanaged'}
                </StudentAreaStatusPill>
                <StudentAreaStatusPill
                  tone={
                    lesson.homework.status === 'published' ||
                    lesson.homework.status === 'memory_ready'
                      ? 'success'
                      : lesson.homework.status === 'not_started' ||
                          lesson.homework.status === 'not_planned'
                        ? 'quiet'
                        : 'attention'
                  }
                >
                  {lesson.homework.status === 'not_planned'
                    ? 'No homework planned'
                    : `homework ${lesson.homework.status.replaceAll('_', ' ')}`}
                </StudentAreaStatusPill>
                <div className="student-schedule-billing-actions">
                  {lesson.homework.transcriptResultSessionId ? (
                    <Link
                      to={`/?sessionId=${encodeURIComponent(lesson.homework.transcriptResultSessionId)}`}
                    >
                      View transcript
                    </Link>
                  ) : null}
                  {lesson.homework.htmlUrl ? (
                    <a href={lesson.homework.htmlUrl} target="_blank" rel="noreferrer">
                      Open homework
                    </a>
                  ) : null}
                  {canAddHomeworkForLesson(lesson) ? (
                    <button
                      type="button"
                      disabled={saving === lesson.id}
                      onClick={() => {
                        void runAction(lesson.id, () => startHomeworkForLesson(lesson.id));
                      }}
                    >
                      Add homework
                    </button>
                  ) : null}
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
                    </>
                  ) : null}
                  {lesson.calendarEventUrl ? (
                    <a href={lesson.calendarEventUrl} target="_blank" rel="noreferrer">
                      Open in Google
                    </a>
                  ) : null}
                  <button
                    type="button"
                    disabled={saving === lesson.id}
                    onClick={() => {
                      setEditingLessonId(lesson.id);
                      setLessonEditForm({
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
                      Operational notes
                      <textarea
                        value={lessonEditForm.notes}
                        onChange={(event) =>
                          setLessonEditForm({ ...lessonEditForm, notes: event.target.value })
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
          <p>Manual follow-ups; some include actions.</p>
        </header>
        {surface.reminders.length === 0 ? (
          <StudentAreaEmptyState>No operational reminders are needed.</StudentAreaEmptyState>
        ) : (
          <div className="student-schedule-billing-list">
            {surface.reminders.map((reminder) => (
              <article
                key={`${reminder.type}-${reminder.lessonId ?? 'none'}`}
                className="student-schedule-billing-reminder"
              >
                <StudentAreaStatusPill
                  tone={reminder.severity === 'urgent' ? 'warning' : 'attention'}
                >
                  {reminder.channel}
                </StudentAreaStatusPill>
                <span>
                  <strong>{reminder.title}</strong>
                  <small>{reminder.message}</small>
                  {reminder.lessonSummary ? (
                    <small className="student-schedule-billing-reminder-detail">
                      {formatReminderLessonDetail(reminder.lessonSummary, workspaceTimezone)}
                    </small>
                  ) : null}
                </span>
                {reminder.actionIntent === 'complete_lesson_and_start_assignment' &&
                reminder.lessonId ? (
                  <>
                    <button
                      type="button"
                      aria-label="Add homework from reminder"
                      disabled={saving === reminder.lessonId}
                      onClick={() => {
                        void runAction(reminder.lessonId ?? reminder.type, () =>
                          startHomeworkFromReminder(reminder),
                        );
                      }}
                    >
                      Add homework
                    </button>
                    <button
                      type="button"
                      disabled={saving === `hide-${reminder.lessonId}`}
                      onClick={() => {
                        void runAction(`hide-${reminder.lessonId}`, () => hideReminder(reminder));
                      }}
                    >
                      Hide
                    </button>
                  </>
                ) : (
                  <textarea
                    aria-label={`Reminder copy for ${studentName}`}
                    readOnly
                    value={reminder.copyText}
                  />
                )}
              </article>
            ))}
          </div>
        )}
        {surface.latestHiddenReminder ? (
          <div className="student-schedule-billing-hidden-reminder">
            <span>
              Hidden:{' '}
              {formatReminderLessonDetail(
                surface.latestHiddenReminder.lessonSummary,
                workspaceTimezone,
              )}
            </span>
            <button
              type="button"
              disabled={saving === 'undo-hidden-reminder'}
              onClick={() => {
                void runAction('undo-hidden-reminder', () =>
                  undoLatestHiddenStudentReminder(studentId),
                );
              }}
            >
              Undo hide
            </button>
          </div>
        ) : null}
        <StudentAreaActionLink to={`/students/${encodeURIComponent(studentId)}/overview`}>
          Back to overview
        </StudentAreaActionLink>
      </StudentAreaPanel>
    </section>
  );
};
