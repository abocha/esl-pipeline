import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ProductButton } from '../../ui/system/ProductButton';
import {
  displayDate,
  learners as fixtureLearners,
  type Learner,
  type Lesson,
  today,
} from './fixtures';
import { StudioDialog } from './StudioDialog';

export function SchedulingDrawer({
  learner: initialLearner,
  outcome,
  onCreate,
  onClose,
  chooseLearner = false,
  learners = fixtureLearners,
}: {
  learner: Learner;
  outcome: 'success' | 'partial' | 'failure';
  onCreate: (lessons: Lesson[]) => void;
  onClose: () => void;
  chooseLearner?: boolean;
  learners?: readonly Learner[];
}) {
  const [learnerId, setLearnerId] = useState<string>(initialLearner.id);
  const learner = learners.find((item) => item.id === learnerId)!;
  const [email, setEmail] = useState<string>(initialLearner.email);
  const [capturedEmail, setCapturedEmail] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [rows, setRows] = useState([{ id: 1, day: 'Monday', time: '16:00' }]);
  const [invite, setInvite] = useState(false);
  const [results, setResults] = useState<{ lesson: Lesson; ok: boolean; label: string }[] | null>(
    null,
  );
  const [capturedInvite, setCapturedInvite] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get('date'));
    const candidates = (weekly ? rows : [{ id: 0, day: '', time: String(form.get('time')) }]).map(
      (row, index) => {
        let occurrenceDate = date;
        if (weekly) {
          const start = new Date(`${date}T12:00:00+07:00`);
          const targetDay = [
            'Sunday',
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
          ].indexOf(row.day);
          const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
          start.setUTCDate(start.getUTCDate() + ((targetDay - weekday + 7) % 7));
          occurrenceDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(start);
        }
        return {
          label: weekly ? `Every ${row.day} · ${row.time}` : `${displayDate(date)} · ${row.time}`,
          ok: outcome === 'success' || (outcome === 'partial' && index === 0 && rows.length > 1),
          lesson: {
            id: crypto.randomUUID(),
            learnerId: learner.id,
            date: occurrenceDate,
            time: row.time,
            duration: Number(form.get('duration')),
            state: 'Scheduled' as const,
            notes: '',
            charge: true,
          },
        };
      },
    );
    setCapturedInvite(invite);
    setCapturedEmail(email);
    onCreate(candidates.filter((item) => item.ok).map((item) => item.lesson));
    setResults(candidates);
  }

  return (
    <StudioDialog title="Schedule lesson" drawer onClose={onClose}>
      <div className="cs2-dialog-context">
        <span className="cs2-avatar">{learner.initials}</span>
        <div>
          {chooseLearner && !results ? (
            <label>
              Learner
              <select
                value={learnerId}
                onChange={(event) => {
                  setLearnerId(event.target.value);
                  setEmail(learners.find((item) => item.id === event.target.value)!.email);
                  setInvite(false);
                }}
              >
                {learners.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <strong>{learner.name}</strong>
          )}
          <span>Teaching calendar · Ho Chi Minh City, UTC+07:00</span>
        </div>
      </div>
      {results ? (
        <div className="cs2-dialog-body">
          <h3>
            {results.every((item) => item.ok)
              ? 'Schedule created in this preview'
              : 'Some work needs attention'}
          </h3>
          <p className="cs2-muted">
            {capturedInvite
              ? `Invitation to ${capturedEmail} simulated. No email was sent.`
              : 'No student invitations selected.'}
          </p>
          <div className="cs2-results">
            {results.map((item) => (
              <div key={item.lesson.id}>
                <span className={item.ok ? 'cs2-success' : 'cs2-error'}>
                  {item.ok ? <Check size={17} /> : <RotateCcw size={17} />}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.ok ? 'Created' : 'Creation not confirmed · retained for recovery'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {results.some((item) => !item.ok) && (
            <>
              <p>
                Check the retained operation before trying again. Confirmed events will stay in
                place.
              </p>
              <ProductButton
                variant="secondary"
                onClick={() => {
                  onCreate(results.filter((item) => !item.ok).map((item) => item.lesson));
                  setResults(results.map((item) => ({ ...item, ok: true })));
                }}
              >
                Check retained operation
              </ProductButton>
              <p className="cs2-muted cs2-small">
                Preview recovery confirms these same event identities. It does not create a new
                request or resend invitations.
              </p>
            </>
          )}
          <footer className="cs2-form-footer">
            <ProductButton onClick={onClose}>Return to schedule</ProductButton>
          </footer>
        </div>
      ) : (
        <form onSubmit={submit} className="cs2-dialog-body">
          <fieldset className="cs2-choice">
            <legend>Schedule</legend>
            <label>
              <input type="radio" name="kind" checked={!weekly} onChange={() => setWeekly(false)} />{' '}
              One-off lesson
            </label>
            <label>
              <input type="radio" name="kind" checked={weekly} onChange={() => setWeekly(true)} />{' '}
              Weekly
            </label>
          </fieldset>
          <div className="cs2-form-grid">
            <label>
              {weekly ? 'Start on or after' : 'Date'}
              <input required name="date" type="date" defaultValue={today} min={today} />
            </label>
            <label>
              Duration
              <select name="duration" defaultValue="60">
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </label>
          </div>
          {weekly ? (
            <fieldset>
              <legend>Weekly times</legend>
              {rows.map((row) => (
                <div className="cs2-weekly-row" key={row.id}>
                  <label>
                    Day
                    <select
                      value={row.day}
                      onChange={(event) =>
                        setRows(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, day: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      {[
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                        'Sunday',
                      ].map((day) => (
                        <option key={day}>{day}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Time
                    <input
                      required
                      type="time"
                      value={row.time}
                      onChange={(event) =>
                        setRows(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, time: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="cs2-icon-button"
                      aria-label={`Remove ${row.day} time`}
                      onClick={() => setRows(rows.filter((item) => item.id !== row.id))}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              ))}
              <ProductButton
                type="button"
                variant="quiet"
                icon={<Plus />}
                onClick={() =>
                  setRows([
                    ...rows,
                    {
                      id: Math.max(...rows.map((row) => row.id)) + 1,
                      day: 'Thursday',
                      time: '16:00',
                    },
                  ])
                }
              >
                Add weekly time
              </ProductButton>
              <p className="cs2-muted cs2-small">
                Each time creates an independent weekly series. This preview shows its first
                occurrence.
              </p>
            </fieldset>
          ) : (
            <label>
              Time
              <input required type="time" name="time" defaultValue="16:00" />
            </label>
          )}
          <div className="cs2-invitation">
            <label className="cs2-check">
              <input
                type="checkbox"
                checked={invite}
                onChange={(event) => setInvite(event.target.checked)}
              />{' '}
              Invite student by email
            </label>
            {invite ? (
              <label className="cs2-profile-field">
                Invitation email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <span className="cs2-muted cs2-small">
                  Used only for this simulated invitation; no student contact record is changed.
                </span>
              </label>
            ) : (
              <p className="cs2-muted cs2-small">
                {learner.email || 'An email is optional unless you invite the student.'}
              </p>
            )}
          </div>
          <p className="cs2-muted cs2-small">
            Timing, recurrence and guests can be changed in Google Calendar after creation.
          </p>
          <footer className="cs2-form-footer">
            <ProductButton type="button" variant="quiet" onClick={onClose}>
              Cancel
            </ProductButton>
            <ProductButton type="submit">
              {weekly
                ? invite
                  ? 'Create weekly schedule & invite'
                  : 'Create weekly schedule'
                : invite
                  ? 'Create lesson & invite'
                  : 'Create lesson'}
            </ProductButton>
          </footer>
        </form>
      )}
    </StudioDialog>
  );
}
