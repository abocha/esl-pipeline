import { ArrowRight, BookOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import { fetchStudentOptions, listAssignmentSessions } from '../../utils/api';
import type { RecentAssignmentItem } from '../minimal/MinimalAssignment.entry-state';
import { buildRecentAssignmentItems } from '../minimal/MinimalAssignment.resume-presentation';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';

export function ContinueAssignments() {
  const timezone = useWorkspaceTimezone();
  const [items, setItems] = useState<RecentAssignmentItem[] | null>(null);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    setError(false);
    try {
      const [sessions, students] = await Promise.all([
        listAssignmentSessions(4),
        fetchStudentOptions(),
      ]);
      if (request !== requestId.current) return;
      setItems(
        buildRecentAssignmentItems(
          sessions.sessions.filter((session) => session.confirmedStep !== 'share'),
          [],
          '',
          new Map(students.students.map((student) => [student.id, student.name])),
          timezone,
        ),
      );
    } catch {
      if (request === requestId.current) setError(true);
    }
  }, [timezone]);
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    return () => {
      requestId.current++;
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  return (
    <section className="studio-v2-continue" aria-labelledby="continue-assignments-title">
      <header>
        <h2 id="continue-assignments-title">Continue working</h2>
        <Link to="/">
          All assignments <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>
      {error && (
        <p role="alert">
          Assignments unavailable.{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {!items && !error && <LoadingPlaceholder label="Loading assignments" count={2} />}
      {items?.length === 0 && <p>No unfinished assignments.</p>}
      <ul>
        {items?.map((item) => (
          <li key={item.id}>
            <Link to={`/?sessionId=${encodeURIComponent(item.id.slice('session:'.length))}`}>
              <BookOpen size={19} aria-hidden="true" />
              <span>
                <strong>{item.learnerName}</strong>
                <span>{item.activityLabel}</span>
              </span>
              <span>
                {item.statusLabel}
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
