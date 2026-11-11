import { ProductButton } from '../../ui/system/ProductButton';
import { displayDate, type Learner, type Lesson } from './fixtures';
import { StudioDialog } from './StudioDialog';

export function CalendarEventDialog({
  learner,
  lesson,
  onChange,
  onClose,
}: {
  learner: Learner;
  lesson: Lesson;
  onChange: (lesson: Lesson) => void;
  onClose: () => void;
}) {
  return (
    <StudioDialog title="Google Calendar event · simulated" onClose={onClose}>
      <form
        className="cs2-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onChange({
            ...lesson,
            date: String(data.get('date')),
            time: String(data.get('time')),
            duration: Number(data.get('duration')),
          });
          onClose();
        }}
      >
        <h3>{learner.name} · English lesson</h3>
        <p className="cs2-muted">
          Teaching calendar · {displayDate(lesson.date)} · {lesson.time} · {lesson.state}
        </p>
        {lesson.state === 'Scheduled' ? (
          <>
            <div className="cs2-form-grid">
              <label>
                Date
                <input required type="date" name="date" defaultValue={lesson.date} />
              </label>
              <label>
                Time
                <input required type="time" name="time" defaultValue={lesson.time} />
              </label>
            </div>
            <label>
              Duration
              <select name="duration" defaultValue={String(lesson.duration)}>
                {[30, 45, 60, 90].map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
            <p className="cs2-muted cs2-small">
              This represents an event change received from Google. Only the sandbox event changes;
              no Google account is accessed.
            </p>
            <footer className="cs2-form-footer">
              <ProductButton
                type="button"
                variant="quiet"
                onClick={() => {
                  onChange({ ...lesson, state: 'Canceled' });
                  onClose();
                }}
              >
                Cancel event in sandbox
              </ProductButton>
              <ProductButton type="submit">Apply simulated Calendar change</ProductButton>
            </footer>
          </>
        ) : (
          <p>
            Recorded lesson history is retained. Use notes & charge in the lesson to correct its
            operational outcome.
          </p>
        )}
      </form>
    </StudioDialog>
  );
}
