import { ArrowRight, BookOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import { listUserJobs } from '../../utils/api';
import type { RecentAssignmentItem } from '../minimal/MinimalAssignment.entry-state';
import { buildRecentAssignmentItems } from '../minimal/MinimalAssignment.resume-presentation';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';

export function StudentRecentAssignments({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const timezone = useWorkspaceTimezone();
  const [items, setItems] = useState<RecentAssignmentItem[] | null>(null);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    setError(false);
    try {
      const result = await listUserJobs({ studentId, limit: 4, order: 'desc' });
      if (request !== requestId.current) return;
      setItems(
        buildRecentAssignmentItems(
          [],
          result.jobs,
          '',
          new Map([[studentId, studentName]]),
          timezone,
        ),
      );
    } catch {
      if (request === requestId.current) setError(true);
    }
  }, [studentId, studentName, timezone]);
  useEffect(() => {
    setItems(null);
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);
  return (
    <section
      className="student-v2-recent-assignments"
      aria-labelledby="recent-student-assignments-title"
    >
      <header>
        <h4 id="recent-student-assignments-title">Recent assignments</h4>
        <Link to={`/?student=${encodeURIComponent(studentId)}`}>
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
      {!items && !error && <LoadingPlaceholder label="Loading recent assignments" count={1} />}
      {items?.length === 0 && <p>No assignments yet.</p>}
      <ul>
        {items?.map((item) => (
          <li key={item.id}>
            <Link to={`/?jobId=${encodeURIComponent(item.id)}`}>
              <BookOpen size={19} aria-hidden="true" />
              <span>
                <strong>{item.activityLabel}</strong>
                <time>{item.timeLabel}</time>
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
