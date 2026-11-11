import { ArrowUpRight, CalendarDays, ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import type { StudentCreditEventDto, StudentPaymentRecordDto } from '@esl-pipeline/contracts';

import { dateInputInTimezone } from '../../utils/scheduling-time';
import { formatPlainDate, formatTutorTime } from '../../utils/tutor-time';
import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';

type Entry = {
  id: string;
  title: string;
  date: string;
  recordedAt: string;
  payment: StudentPaymentRecordDto | null;
  credits: StudentCreditEventDto[];
};

const creditTitles: Record<StudentCreditEventDto['eventType'], string> = {
  credit_added: 'Credits added',
  credit_consumed: 'Lesson charged',
  credit_adjusted: 'Credit adjustment',
};
const filters = [
  { key: 'all', label: 'All' },
  { key: 'payments', label: 'Payments' },
  { key: 'credits', label: 'Credits' },
] as const;

function billingEntries(
  payments: StudentPaymentRecordDto[],
  credits: StudentCreditEventDto[],
  timezone: string,
): Entry[] {
  const entries = new Map<string, Entry>();
  for (const payment of payments) {
    entries.set(`payment:${payment.id}`, {
      id: `payment:${payment.id}`,
      title: 'Payment',
      date: payment.receivedAt,
      recordedAt: payment.createdAt,
      payment,
      credits: [],
    });
  }
  for (const credit of credits) {
    const linked = credit.sourcePaymentId && entries.get(`payment:${credit.sourcePaymentId}`);
    if (linked) {
      linked.credits.push(credit);
      linked.title = 'Lesson package';
    } else {
      entries.set(`credit:${credit.id}`, {
        id: `credit:${credit.id}`,
        title: creditTitles[credit.eventType],
        date: dateInputInTimezone(new Date(credit.createdAt), timezone),
        recordedAt: credit.createdAt,
        payment: null,
        credits: [credit],
      });
    }
  }
  return [...entries.values()].sort(
    (left, right) =>
      right.date.localeCompare(left.date) || right.recordedAt.localeCompare(left.recordedAt),
  );
}

function paymentLabel(payment: StudentPaymentRecordDto) {
  return `${payment.currency} ${(payment.amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedCredits(delta: number) {
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

export function StudentBillingActivity({
  payments,
  creditEvents,
  timezone,
  studentId,
  lessonTitles,
}: {
  payments: StudentPaymentRecordDto[];
  creditEvents: StudentCreditEventDto[];
  timezone: string;
  studentId: string;
  lessonTitles: Map<string, string>;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]['key']>('all');
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const { search } = useLocation();
  const entries = billingEntries(payments, creditEvents, timezone);
  const shown = entries.filter(
    (entry) =>
      filter === 'all' ||
      (filter === 'payments' ? entry.payment !== null : entry.credits.length > 0),
  );
  const selected = entries.find((entry) => entry.id === openEntryId);
  const paymentLink = selected?.payment?.externalUrl;
  const studentPath = `/students/${encodeURIComponent(studentId)}`;
  const historyParams = new URLSearchParams(search);
  historyParams.set('activity', 'billing');
  historyParams.delete('from');
  historyParams.delete('to');

  return (
    <section className="student-billing-activity" aria-label="Recent billing activity">
      <header>
        <h2>Billing activity</h2>
        <div
          className="student-billing-activity__filters"
          role="group"
          aria-label="Show billing activity"
        >
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <table className="student-billing-activity__table" aria-label="Billing activity">
        <thead>
          <tr>
            <th scope="col">Entry</th>
            <th scope="col">Payment</th>
            <th scope="col">Credits</th>
            <th scope="col" aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {shown.map((entry) => {
            const delta = entry.credits.reduce((total, credit) => total + credit.quantityDelta, 0);
            const note = entry.payment?.note ?? entry.credits.find((credit) => credit.note)?.note;
            const lessonId = entry.credits[0]?.sourceLessonId;
            const detail = entry.payment?.method ?? (lessonId ? lessonTitles.get(lessonId) : null);
            return (
              <tr key={entry.id}>
                <td>
                  <strong>{entry.title}</strong>
                  <small>
                    <time dateTime={entry.date}>{formatPlainDate(entry.date)}</time>
                    {detail && <> · {detail}</>}
                  </small>
                  {note && <small className="student-billing-activity__note">{note}</small>}
                </td>
                <td>{entry.payment ? paymentLabel(entry.payment) : '—'}</td>
                <td data-credit-change={delta > 0 ? 'added' : undefined}>
                  {entry.credits.length ? signedCredits(delta) : '—'}
                </td>
                <td>
                  <button
                    className="product-button product-button--quiet student-billing-activity__details"
                    type="button"
                    aria-label={`View ${entry.title.toLowerCase()} details, ${formatPlainDate(entry.date)}`}
                    onClick={() => setOpenEntryId(entry.id)}
                  >
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr>
              <td colSpan={4}>
                {filter === 'payments'
                  ? 'No recent payments.'
                  : filter === 'credits'
                    ? 'No recent credit activity.'
                    : 'No billing entries yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Link
        className="student-billing-activity__history"
        to={{ pathname: `${studentPath}/history`, search: `?${historyParams}` }}
      >
        <History size={16} aria-hidden="true" /> Full billing history
      </Link>
      {selected && (
        <StudioV2Dialog title={selected.title} onClose={() => setOpenEntryId(null)}>
          <div className="studio-v2-dialog__body student-billing-activity__entry">
            {selected.payment && (
              <section aria-label="Payment details">
                <h3>Payment</h3>
                <p>
                  <strong>{paymentLabel(selected.payment)}</strong> ·{' '}
                  {formatPlainDate(selected.payment.receivedAt)}{' '}
                  {selected.payment.receivedAt.slice(0, 4)}
                </p>
                {selected.payment.method && <p>{selected.payment.method}</p>}
                {selected.payment.note && <p>{selected.payment.note}</p>}
                {paymentLink && /^https?:\/\//i.test(paymentLink) && (
                  <a href={paymentLink} target="_blank" rel="noreferrer">
                    Open payment link <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                )}
              </section>
            )}
            {selected.credits.length > 0 && (
              <section aria-label="Credit details">
                <h3>Lesson credits</h3>
                {selected.credits.map((credit) => (
                  <div key={credit.id}>
                    <p>
                      <strong>{signedCredits(credit.quantityDelta)}</strong> ·{' '}
                      {formatTutorTime(credit.createdAt, timezone)}
                    </p>
                    {credit.sourceLessonId && lessonTitles.get(credit.sourceLessonId) && (
                      <p>{lessonTitles.get(credit.sourceLessonId)}</p>
                    )}
                    {credit.note && credit.note !== selected.payment?.note && <p>{credit.note}</p>}
                    {credit.sourcePaymentId && !selected.payment && (
                      <p>Linked payment is outside this list.</p>
                    )}
                  </div>
                ))}
                {selected.credits.some((credit) => credit.sourceLessonId) && (
                  <Link
                    to={{ pathname: `${studentPath}/schedule`, search }}
                    onClick={() => setOpenEntryId(null)}
                  >
                    <CalendarDays size={16} aria-hidden="true" /> View schedule
                  </Link>
                )}
              </section>
            )}
          </div>
        </StudioV2Dialog>
      )}
    </section>
  );
}
