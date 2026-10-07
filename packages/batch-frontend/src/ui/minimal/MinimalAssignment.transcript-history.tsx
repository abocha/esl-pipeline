import { useState } from 'react';

import { type AssignmentSession, listAssignmentSessions } from '../../utils/api';
import { isTranscriptOnlyCompleted } from './MinimalAssignment.no-homework';

export function TranscriptHistory({
  onOpen,
  studentNames,
}: {
  onOpen: (id: string) => void;
  studentNames: { id: string; name: string }[];
}) {
  const [items, setItems] = useState<AssignmentSession[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(offset: number) {
    setLoading(true);
    setError(null);
    try {
      const response = await listAssignmentSessions(20, 'history', offset);
      setItems((current) => {
        const combined = [...current, ...response.sessions.filter(isTranscriptOnlyCompleted)];
        return [...new Map(combined.map((session) => [session.id, session])).values()];
      });
      setTotal(response.total);
      setNextOffset(offset + response.sessions.length);
      setLoaded(true);
    } catch {
      setError('Transcript results could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <details
      className="minimal-transcript-history"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !loading) void load(nextOffset);
      }}
    >
      <summary>Confirmed transcript results</summary>
      {loading ? <p role="status">Loading transcript results…</p> : null}
      {loaded && items.length === 0 ? (
        <p>No completed transcript-only lessons in these results.</p>
      ) : null}
      <ul>
        {items.map((session) => (
          <li key={session.id}>
            <button type="button" onClick={() => onOpen(session.id)}>
              View transcript ·{' '}
              {new Date(session.transcriptCompletedAt ?? session.updatedAt).toLocaleString()}
            </button>
            <span>
              {' '}
              Lesson for{' '}
              {studentNames.find((student) => student.id === session.studentId)?.name ??
                'selected student'}{' '}
              · No homework planned
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load(nextOffset)}>
            Retry
          </button>
        </p>
      ) : null}
      {loaded && nextOffset < total ? (
        <button type="button" disabled={loading} onClick={() => void load(nextOffset)}>
          Show older results
        </button>
      ) : null}
    </details>
  );
}
