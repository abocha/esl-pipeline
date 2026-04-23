import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';

import { getStudentProfile, type StudentProfile } from '../../utils/api';
import { formatStudentShortId } from './studentIdentity';

function formatStudentSubtitle(student: StudentProfile | null): string {
  if (!student) return 'Loading student record';
  return formatStudentShortId(student.id);
}

export const StudentAreaShell: React.FC = () => {
  const { studentId = '' } = useParams<{ studentId: string }>();
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [studentLoading, setStudentLoading] = useState(true);
  const [studentError, setStudentError] = useState<string | null>(null);
  const latestStudentRequestRef = useRef(0);

  const loadStudent = useCallback(async () => {
    const requestId = latestStudentRequestRef.current + 1;
    latestStudentRequestRef.current = requestId;

    if (!studentId) {
      if (latestStudentRequestRef.current === requestId) {
        setStudent(null);
        setStudentLoading(false);
        setStudentError('Student ID is required.');
      }
      return;
    }

    setStudentLoading(true);
    setStudentError(null);
    try {
      const response = await getStudentProfile(studentId);
      if (latestStudentRequestRef.current !== requestId) {
        return;
      }
      setStudent(response);
    } catch (error) {
      if (latestStudentRequestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to load the student.';
      setStudent(null);
      setStudentError(message);
    } finally {
      if (latestStudentRequestRef.current === requestId) {
        setStudentLoading(false);
      }
    }
  }, [studentId]);

  useEffect(() => {
    void loadStudent();
    return () => {
      latestStudentRequestRef.current += 1;
    };
  }, [loadStudent]);

  return (
    <section className="student-area-shell">
      <header className="student-area-header card">
        <div>
          <span className="student-area-eyebrow">Student area</span>
          <h1>{student?.student ?? 'Student record'}</h1>
          <p>{studentError ?? formatStudentSubtitle(student)}</p>
        </div>
        <nav aria-label="Student area navigation" className="student-area-nav">
          <NavLink to={`/students/${studentId}/overview`}>Overview</NavLink>
          <NavLink to={`/students/${studentId}/learning`}>Learning</NavLink>
          <NavLink to={`/students/${studentId}/history`}>History</NavLink>
          <NavLink to={`/students/${studentId}/schedule-billing`}>Schedule & Billing</NavLink>
        </nav>
      </header>

      <Outlet
        context={{
          student,
          studentId,
          studentLoading,
          studentError,
          refreshStudent: loadStudent,
        }}
      />

      <style>{`
        .student-area-shell {
          display: grid;
          gap: 1.5rem;
        }

        .student-area-header {
          display: grid;
          gap: 1rem;
        }

        .student-area-header h1 {
          margin: 0.25rem 0;
        }

        .student-area-header p {
          margin: 0;
          color: var(--text-secondary, #52606d);
        }

        .student-area-eyebrow {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b7280);
        }

        .student-area-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .student-area-nav a {
          padding: 0.65rem 0.95rem;
          border-radius: 999px;
          text-decoration: none;
          background: rgba(15, 23, 42, 0.04);
          color: inherit;
          font-weight: 600;
        }

        .student-area-nav a.active {
          background: var(--color-primary-500, #2563eb);
          color: white;
        }
      `}</style>
    </section>
  );
};
