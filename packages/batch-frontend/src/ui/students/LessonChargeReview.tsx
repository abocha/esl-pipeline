import { useCallback, useEffect, useRef, useState } from 'react';

import type { StudentLessonDto } from '@esl-pipeline/contracts';

import {
  getStudentLesson,
  StudentLessonConflictApiError,
  updateStudentLesson,
} from '../../utils/api';
import './LessonChargeReview.css';

export const lessonChargeLabel = (
  lesson: Pick<StudentLessonDto, 'status' | 'plannedCharge' | 'consumesCredit'>,
) =>
  (lesson.status === 'scheduled' ? (lesson.plannedCharge ?? true) : lesson.consumesCredit)
    ? '1 lesson credit'
    : 'No charge';

export function lessonHasEnded(lesson: Pick<StudentLessonDto, 'startsAt' | 'durationMinutes'>) {
  return new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60_000 <= Date.now();
}

/** First-use review never infers a teacher's intent from a legacy billing flag. */
export function useLessonChargeReview(scopeKey?: string) {
  const [pending, setPending] = useState<{ studentId: string; lesson: StudentLessonDto } | null>(
    null,
  );
  const [charge, setCharge] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{
    studentId: string;
    lessonId: string;
    promise: Promise<StudentLessonDto | null>;
    resolve: (lesson: StudentLessonDto | null) => void;
  } | null>(null);
  const active = useRef(true);
  const scope = useRef(0);
  const reviewRef = useRef<HTMLElement>(null);
  const freshReview = useRef(new Set<string>());
  useEffect(() => {
    if (pending) reviewRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [pending]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A learner scope change cancels the pending review and its asynchronous result.
  useEffect(() => {
    active.current = true;
    freshReview.current.clear();
    setPending(null);
    setSaving(false);
    setError(null);
    return () => {
      scope.current += 1;
      active.current = false;
      request.current?.resolve(null);
      request.current = null;
    };
  }, [scopeKey]);
  const requestChargeReview = useCallback(
    (studentId: string, lesson: StudentLessonDto, force = false) => {
      if (request.current) {
        return request.current.studentId === studentId && request.current.lessonId === lesson.id
          ? request.current.promise
          : Promise.resolve(null);
      }
      if (lesson.status !== 'scheduled' || (lesson.plannedCharge != null && !force))
        return Promise.resolve(lesson);
      let resolve!: (lesson: StudentLessonDto | null) => void;
      const promise = new Promise<StudentLessonDto | null>((finish) => {
        resolve = finish;
      });
      request.current = { studentId, lessonId: lesson.id, promise, resolve };
      setPending({ studentId, lesson });
      setCharge(lesson.plannedCharge ?? true);
      setError(null);
      return promise;
    },
    [],
  );
  const finish = (lesson: StudentLessonDto | null) => {
    request.current?.resolve(lesson);
    request.current = null;
    setPending(null);
  };
  const save = async () => {
    if (!pending || !request.current || saving) return;
    setSaving(true);
    setError(null);
    const currentRequest = request.current;
    try {
      await updateStudentLesson(pending.studentId, pending.lesson.id, {
        plannedCharge: charge,
        expectedStatus: 'scheduled',
        expectedPlannedCharge: pending.lesson.plannedCharge,
      });
      const saved = await getStudentLesson(pending.studentId, pending.lesson.id);
      if (active.current && request.current === currentRequest) {
        freshReview.current.delete(saved.id);
        finish(saved);
      }
    } catch (failure) {
      if (
        failure instanceof StudentLessonConflictApiError &&
        active.current &&
        request.current === currentRequest
      ) {
        setError('Lesson changed. Cancel and reopen it to review the current charge.');
      } else if (active.current && request.current === currentRequest)
        setError(failure instanceof Error ? failure.message : 'Unable to save lesson charge.');
    } finally {
      if (active.current && (request.current === currentRequest || request.current === null))
        setSaving(false);
    }
  };
  const reviewLinkedLessonCharge = useCallback(
    async (studentId: string, lessonId: string) => {
      const currentScope = scope.current;
      const lesson = await getStudentLesson(studentId, lessonId);
      if (!active.current || currentScope !== scope.current) return null;
      return requestChargeReview(studentId, lesson, freshReview.current.has(lesson.id));
    },
    [requestChargeReview],
  );
  const requireFreshLessonChargeReview = useCallback((lessonId: string) => {
    freshReview.current.add(lessonId);
  }, []);
  return {
    requestChargeReview,
    reviewLinkedLessonCharge,
    requireFreshLessonChargeReview,
    chargeReview: pending ? (
      <section ref={reviewRef} className="lesson-charge-review" aria-label="Review lesson charge">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving}>
            <legend>Lesson charge</legend>
            <label>
              <input
                type="radio"
                name="lesson-charge"
                checked={charge}
                onChange={() => setCharge(true)}
              />
              1 lesson credit
            </label>
            <label>
              <input
                type="radio"
                name="lesson-charge"
                checked={!charge}
                onChange={() => setCharge(false)}
              />
              No charge
            </label>
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Confirm charge'}
          </button>
          <button type="button" disabled={saving} onClick={() => finish(null)}>
            Cancel
          </button>
        </form>
      </section>
    ) : null,
  };
}
