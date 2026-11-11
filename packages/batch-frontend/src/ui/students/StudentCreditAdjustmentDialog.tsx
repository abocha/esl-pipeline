import { useRef, useState } from 'react';

import type { AdjustStudentCreditsRequest } from '@esl-pipeline/contracts';

import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';

export function StudentCreditAdjustmentDialog({
  balance,
  saving,
  error,
  onClose,
  onSave,
}: {
  balance: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (adjustment: AdjustStudentCreditsRequest) => Promise<void>;
}) {
  const [direction, setDirection] = useState(1);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const submitting = useRef(false);
  const amount = Number(quantity);
  const validAmount = Number.isInteger(amount) && amount >= 1 && amount <= 500;
  const canSave = validAmount && note.trim().length > 0;
  const newBalance = balance + amount * direction;

  return (
    <StudioV2Dialog title="Adjust lesson credits" onClose={onClose} closeDisabled={saving}>
      <form
        className="student-schedule-billing-form studio-v2-dialog__body"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSave || saving || submitting.current) return;
          submitting.current = true;
          try {
            await onSave({ quantityDelta: amount * direction, note: note.trim() });
          } finally {
            submitting.current = false;
          }
        }}
      >
        <label>
          Change
          <select
            value={direction}
            disabled={saving}
            onChange={(event) => setDirection(Number(event.target.value))}
          >
            <option value={1}>Add credits</option>
            <option value={-1}>Remove credits</option>
          </select>
        </label>
        <label>
          Credits
          <input
            type="number"
            min={1}
            max={500}
            required
            disabled={saving}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="student-schedule-billing-wide">
          Reason
          <textarea
            required
            maxLength={2000}
            disabled={saving}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="student-billing-entry__calculation student-schedule-billing-wide">
          <span>
            Current balance <strong>{balance}</strong>
          </span>
          {validAmount && (
            <span>
              After adjustment <strong>{newBalance}</strong>
            </span>
          )}
        </p>
        {error && (
          <p className="student-schedule-billing-error" role="alert">
            {error}
          </p>
        )}
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
            {saving ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </form>
    </StudioV2Dialog>
  );
}
