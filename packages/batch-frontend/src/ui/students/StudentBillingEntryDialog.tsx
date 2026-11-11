import { useRef, useState } from 'react';

import type {
  AddStudentPackageRequest,
  RecordStudentPaymentRequest,
} from '@esl-pipeline/contracts';

import { dateInputInTimezone } from '../../utils/scheduling-time';
import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';

type EntryMode = 'both' | 'payment' | 'credits';
type CalculationBasis = 'lessons' | 'payment';
const modes: { value: EntryMode; label: string }[] = [
  { value: 'both', label: 'Payment + credits' },
  { value: 'payment', label: 'Payment only' },
  { value: 'credits', label: 'Credits only' },
];
const maxAmountMinor = 2_147_483_647;
const maxLessons = 500;

export type StudentBillingEntry =
  | { kind: 'package'; body: AddStudentPackageRequest }
  | { kind: 'payment'; body: RecordStudentPaymentRequest };

function emptyDraft(currency: string) {
  return {
    lessons: '',
    rate: '',
    amount: '',
    currency,
    receivedAt: null as string | null,
    method: '',
    note: '',
  };
}

function parseAmountMinor(value: string): number | null {
  const decimal = value.trim();
  if (!/^(?:\d+(?:[.,]\d{0,2})?|[.,]\d{1,2})$/.test(decimal)) return null;
  const [whole, fraction = ''] = decimal.split(/[.,]/);
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return amount > 0 && amount <= maxAmountMinor ? amount : null;
}

export function StudentBillingEntryDialog({
  open,
  initialCurrency,
  timezone,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  initialCurrency: string;
  timezone: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (entry: StudentBillingEntry) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<EntryMode>('both');
  const [basis, setBasis] = useState<CalculationBasis>('lessons');
  const [draft, setDraft] = useState(() => emptyDraft(initialCurrency));
  const submitting = useRef(false);
  const lessonInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const recordsPayment = mode !== 'credits';
  const addsCredits = mode !== 'payment';
  const lessonCount = Number(draft.lessons);
  const validLessons =
    Number.isInteger(lessonCount) && lessonCount >= 1 && lessonCount <= maxLessons;
  const amount = parseAmountMinor(draft.amount);
  const rate = parseAmountMinor(draft.rate);
  const currency = draft.currency.trim().toUpperCase();
  const receivedAt = draft.receivedAt ?? dateInputInTimezone(new Date(), timezone);
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  const money = (minor: number) => `${currency} ${(minor / 100).toFixed(2)}`;
  const canSave =
    (!recordsPayment || (amount !== null && validCurrency && Boolean(receivedAt))) &&
    (!addsCredits || validLessons);

  let calculation: { message: string; apply?: () => void; label?: string } | null = null;
  if (mode === 'both' && rate !== null && validCurrency) {
    if (amount !== null && (basis === 'payment' || !validLessons)) {
      const count = amount / rate;
      if (Number.isInteger(count) && count <= maxLessons) {
        calculation = {
          message: `${money(amount)} ÷ ${money(rate)} = ${count} ${count === 1 ? 'lesson' : 'lessons'}`,
        };
        if (count !== lessonCount) {
          calculation.label = 'Use lesson count';
          calculation.apply = () => {
            setDraft((current) => ({ ...current, lessons: String(count) }));
            lessonInput.current?.focus();
          };
        }
      } else {
        calculation = {
          message: Number.isInteger(count)
            ? 'A single entry can add up to 500 lessons.'
            : 'This amount does not buy a whole number of lessons at this rate. Enter the credits to add.',
        };
      }
    } else if (validLessons) {
      const total = lessonCount * rate;
      calculation = { message: `${lessonCount} × ${money(rate)} = ${money(total)}` };
      if (total <= maxAmountMinor && total !== amount) {
        calculation.label = 'Use amount';
        calculation.apply = () => {
          setDraft((current) => ({ ...current, amount: (total / 100).toFixed(2) }));
          amountInput.current?.focus();
        };
      }
    }
  }

  const submit = async () => {
    if (!canSave || saving || submitting.current) return;
    const note = draft.note.trim() || null;
    const payment =
      recordsPayment && amount !== null
        ? {
            amountMinor: amount,
            currency,
            receivedAt,
            method: draft.method.trim() || null,
            note,
          }
        : null;
    submitting.current = true;
    try {
      const saved = addsCredits
        ? await onSave({ kind: 'package', body: { lessons: lessonCount, note, payment } })
        : payment !== null && (await onSave({ kind: 'payment', body: payment }));
      if (saved) {
        setDraft(emptyDraft(payment?.currency ?? initialCurrency));
        setMode('both');
        setBasis('lessons');
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <StudioV2Dialog title="Add billing entry" onClose={onClose} closeDisabled={saving}>
      <form
        className="student-schedule-billing-form student-billing-entry studio-v2-dialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset
          className="student-billing-entry__modes student-schedule-billing-wide"
          disabled={saving}
        >
          <legend>Entry type</legend>
          {modes.map(({ value, label }) => (
            <label key={value}>
              <input
                type="radio"
                name="entry-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {addsCredits && (
          <label>
            Lessons
            <input
              ref={lessonInput}
              type="number"
              min="1"
              max={maxLessons}
              required
              disabled={saving}
              value={draft.lessons}
              onChange={(event) => {
                setBasis('lessons');
                setDraft({ ...draft, lessons: event.target.value });
              }}
            />
          </label>
        )}
        {mode === 'both' && (
          <label>
            Rate per lesson (optional)
            <input
              inputMode="decimal"
              disabled={saving}
              value={draft.rate}
              onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
            />
          </label>
        )}
        {recordsPayment && (
          <>
            <label>
              Amount received
              <input
                ref={amountInput}
                inputMode="decimal"
                required
                disabled={saving}
                value={draft.amount}
                aria-invalid={Boolean(draft.amount && amount === null)}
                onChange={(event) => {
                  setBasis('payment');
                  setDraft({ ...draft, amount: event.target.value });
                }}
              />
              {draft.amount && amount === null && (
                <small>Enter a positive amount with up to two decimal places.</small>
              )}
            </label>
            <label>
              Currency
              <input
                maxLength={3}
                required
                pattern="[A-Za-z]{3}"
                disabled={saving}
                value={draft.currency}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value.toUpperCase() })
                }
              />
            </label>
          </>
        )}
        {calculation && (
          <div className="student-billing-entry__calculation student-schedule-billing-wide">
            <span>{calculation.message}</span>
            {calculation.apply && (
              <button
                type="button"
                className="student-billing-entry__apply"
                disabled={saving}
                onClick={calculation.apply}
              >
                {calculation.label}
              </button>
            )}
          </div>
        )}
        {recordsPayment && (
          <>
            <label>
              Payment date
              <input
                type="date"
                required
                disabled={saving}
                value={receivedAt}
                onChange={(event) => setDraft({ ...draft, receivedAt: event.target.value })}
              />
            </label>
            <label>
              Method (optional)
              <input
                maxLength={100}
                disabled={saving}
                value={draft.method}
                onChange={(event) => setDraft({ ...draft, method: event.target.value })}
              />
            </label>
          </>
        )}
        <label className="student-schedule-billing-wide">
          Note (optional)
          <textarea
            rows={2}
            maxLength={2000}
            disabled={saving}
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </label>
        {error && (
          <p className="student-schedule-billing-error" role="alert">
            {error}
          </p>
        )}
        <div className="student-billing-entry__footer student-schedule-billing-wide">
          <p className="student-billing-entry__summary">
            {recordsPayment && amount !== null && validCurrency && (
              <span>{money(amount)} received</span>
            )}
            {addsCredits && validLessons && (
              <span>
                +{lessonCount} lesson {lessonCount === 1 ? 'credit' : 'credits'}
              </span>
            )}
          </p>
          <div className="studio-v2-dialog__actions">
            <button
              type="button"
              className="product-button product-button--quiet"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="product-button product-button--primary"
              disabled={!canSave || saving}
            >
              {saving ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </div>
      </form>
    </StudioV2Dialog>
  );
}
