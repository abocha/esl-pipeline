import { ArrowRight, BookOpen, CalendarDays } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import {
  getStudentScheduleBillingSurface,
  type LessonMemoryRecord,
  listUserJobs,
  type StudentScheduleBillingSurface,
} from '../../utils/api';
import { formatTutorTime } from '../../utils/tutor-time';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { LessonTranscriptDisclosure } from './LessonTranscriptDisclosure';
import './LearningLessonContext.css';

type Lesson = Pick<
  LessonMemoryRecord,
  | 'id'
  | 'recordingId'
  | 'transcriptId'
  | 'lessonTitle'
  | 'sourceContentHash'
  | 'assignmentSessionId'
>;

export function LearningLessonContext({
  studentId,
  latestLesson,
}: {
  studentId: string;
  latestLesson: Lesson | null;
}) {
  const timezone = useWorkspaceTimezone();
  const [nextLesson, setNextLesson] = useState<
    StudentScheduleBillingSurface['nextLesson'] | undefined
  >();
  const [scheduleError, setScheduleError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [latestJobId, setLatestJobId] = useState<string | null>(null);
  const [jobError, setJobError] = useState(false);
  const [jobRetry, setJobRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setNextLesson(undefined);
    setScheduleError(false);
    void getStudentScheduleBillingSurface(studentId)
      .then((surface) => {
        if (request === generation.current) setNextLesson(surface.nextLesson);
      })
      .catch(() => {
        if (request === generation.current) setScheduleError(true);
      });
    return () => {
      generation.current++;
    };
  }, [studentId, retry]);
  useEffect(() => {
    let current = true;
    setLatestJobId(null);
    setJobError(false);
    if (!latestLesson?.assignmentSessionId) {
      void listUserJobs({ studentId, limit: 1, order: 'desc' })
        .then((result) => {
          if (current) setLatestJobId(result.jobs[0]?.jobId ?? null);
        })
        .catch(() => {
          if (current) setJobError(true);
        });
    }
    return () => {
      current = false;
    };
  }, [studentId, latestLesson?.assignmentSessionId, jobRetry]);
  const workHref = latestLesson?.assignmentSessionId
    ? `/?sessionId=${encodeURIComponent(latestLesson.assignmentSessionId)}`
    : latestJobId
      ? `/?jobId=${encodeURIComponent(latestJobId)}`
      : null;
  return (
    <section className="learning-lesson-context" aria-label="Lesson context">
      <div className="learning-next-lesson">
        {scheduleError ? (
          <span role="status">
            Schedule unavailable.{' '}
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Retry next lesson
            </button>
          </span>
        ) : nextLesson === undefined ? (
          <LoadingPlaceholder label="Loading next lesson" kind="inline" count={1} />
        ) : nextLesson ? (
          <>
            <span>Next lesson</span>
            <strong>
              {formatTutorTime(nextLesson.startsAt, timezone, {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </strong>
          </>
        ) : (
          <span>No upcoming lesson</span>
        )}
        {(nextLesson !== undefined || scheduleError) && (
          <Link
            to={`/students/${encodeURIComponent(studentId)}/schedule${nextLesson === null ? '#teaching-calendar' : ''}`}
          >
            <CalendarDays size={16} aria-hidden="true" />
            {nextLesson === null ? 'Schedule lesson' : 'View schedule'}
          </Link>
        )}
      </div>
      {latestLesson && <LessonTranscriptDisclosure lesson={latestLesson} />}
      {jobError && (
        <p role="status">
          Assignment unavailable.{' '}
          <button type="button" onClick={() => setJobRetry((value) => value + 1)}>
            Retry assignment link
          </button>
        </p>
      )}
      {workHref && (
        <Link className="learning-latest-work" to={workHref}>
          <BookOpen size={17} aria-hidden="true" />
          {latestLesson?.assignmentSessionId ? 'Open lesson work' : 'Latest assignment'}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
