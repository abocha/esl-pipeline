import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';

import { getStudentProfile, type StudentProfile } from '../../utils/api';
import { StudentAreaDesignSystemStyles } from './StudentAreaDesignSystem';
import { formatStudentShortId, getStudentInitials } from './studentIdentity';

import './StudentAreaShell.css';

type StudentAreaPageKey = 'overview' | 'learning' | 'history' | 'schedule-billing';
type StudentAreaDensity = 'overview' | 'learning' | 'reading' | 'operations';

interface StudentAreaPageMeta {
  label: string;
  summary: string;
  density: StudentAreaDensity;
}

const STUDENT_AREA_PAGE_META: Record<StudentAreaPageKey, StudentAreaPageMeta> = {
  overview: {
    label: 'Overview',
    summary: 'A calm control surface for the current learning relationship.',
    density: 'overview',
  },
  learning: {
    label: 'Learning',
    summary: 'The canonical pedagogical home for profile truth and memory signals.',
    density: 'learning',
  },
  history: {
    label: 'History',
    summary: 'A chronological teaching ledger for lessons, materials, and profile changes.',
    density: 'reading',
  },
  'schedule-billing': {
    label: 'Schedule & Billing',
    summary: 'The future home for lessons, credits, reminders, invoices, and calendar state.',
    density: 'operations',
  },
};

const STUDENT_AREA_PAGE_ORDER: StudentAreaPageKey[] = [
  'overview',
  'learning',
  'history',
  'schedule-billing',
];

function getActivePage(pathname: string): StudentAreaPageKey {
  const activePage = STUDENT_AREA_PAGE_ORDER.find((page) => pathname.endsWith(`/${page}`));
  return activePage ?? 'overview';
}

function formatStudentSubtitle(student: StudentProfile | null): string {
  if (!student) return 'Loading student record';
  return formatStudentShortId(student.id);
}

export const StudentAreaShell: React.FC = () => {
  const { studentId = '' } = useParams<{ studentId: string }>();
  const location = useLocation();
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [studentLoading, setStudentLoading] = useState(true);
  const [studentError, setStudentError] = useState<string | null>(null);
  const latestStudentRequestRef = useRef(0);
  const activePage = getActivePage(location.pathname);
  const activePageMeta = STUDENT_AREA_PAGE_META[activePage];
  const studentName = student?.student ?? 'Student record';
  const studentInitials = getStudentInitials(student?.student);

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
    <section className="student-area-shell student-area-theme">
      <StudentAreaDesignSystemStyles />
      <header className="student-area-masthead">
        <Link className="student-area-back" to="/students">
          Back to all students
        </Link>

        <div className="student-area-identity-row">
          <div className="student-area-avatar" aria-hidden="true">
            {studentInitials}
          </div>
          <div className="student-area-identity-copy">
            <span className="student-area-eyebrow">{activePageMeta.label}</span>
            <h1>{studentName}</h1>
            <p>{studentError ?? formatStudentSubtitle(student)}</p>
            <p className="student-area-page-summary">{activePageMeta.summary}</p>
          </div>
        </div>

        <nav aria-label="Student area navigation" className="student-area-nav">
          {STUDENT_AREA_PAGE_ORDER.map((page) => (
            <NavLink key={page} to={`/students/${studentId}/${page}`}>
              {STUDENT_AREA_PAGE_META[page].label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div
        className={`student-area-body student-area-body-${activePageMeta.density}`}
        data-testid="student-area-body"
      >
        <Outlet
          context={{
            student,
            studentId,
            studentLoading,
            studentError,
            refreshStudent: loadStudent,
          }}
        />
      </div>
    </section>
  );
};
