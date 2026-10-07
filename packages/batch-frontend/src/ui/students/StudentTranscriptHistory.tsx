import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { type AssignmentSession, listAssignmentSessions } from '../../utils/api';
import { isTranscriptOnlyCompleted } from '../minimal/MinimalAssignment.no-homework';

export function StudentTranscriptHistory({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<AssignmentSession[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const load = useCallback(
    async (offset: number) => {
      const request = ++latestRequest.current;
      setLoading(true);
      setError(null);
      try {
        const response = await listAssignmentSessions(20, 'history', offset);
        if (request !== latestRequest.current) return;
        setItems((current) => {
          const combined = [
            ...current,
            ...response.sessions.filter(
              (session) => session.studentId === studentId && isTranscriptOnlyCompleted(session),
            ),
          ];
          return [...new Map(combined.map((session) => [session.id, session])).values()];
        });
        setTotal(response.total);
        setNextOffset(offset + response.sessions.length);
        setLoaded(true);
      } catch {
        if (request !== latestRequest.current) return;
        setError('Transcript results could not be loaded. Try again.');
      } finally {
        if (request === latestRequest.current) setLoading(false);
      }
    },
    [studentId],
  );

  useEffect(() => {
    setItems([]);
    setNextOffset(0);
    setTotal(0);
    setLoaded(false);
    void load(0);
    return () => {
      latestRequest.current += 1;
    };
  }, [load]);

  return (
    <section
      className="student-area-panel student-transcript-history"
      aria-label="Lesson transcripts"
      aria-busy={loading}
    >
      <h2>Lesson transcripts</h2>
      {loading ? <p role="status">Loading transcripts…</p> : null}
      {loaded && !loading && !error && items.length === 0 ? (
        <p>
          {nextOffset < total
            ? 'No transcripts in the results loaded so far.'
            : 'No completed transcripts for this student yet.'}
        </p>
      ) : null}
      <ul>
        {items.map((session) => (
          <li key={session.id}>
            <div>
              <time dateTime={session.transcriptCompletedAt ?? session.updatedAt}>
                {new Date(session.transcriptCompletedAt ?? session.updatedAt).toLocaleString()}
              </time>
              <span>No homework planned</span>
            </div>
            <Link to={`/?sessionId=${encodeURIComponent(session.id)}`}>View transcript</Link>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={loading} onClick={() => void load(nextOffset)}>
            Retry
          </button>
        </p>
      ) : null}
      {loaded && !error && nextOffset < total ? (
        <button type="button" disabled={loading} onClick={() => void load(nextOffset)}>
          Show older transcripts
        </button>
      ) : null}
    </section>
  );
}
