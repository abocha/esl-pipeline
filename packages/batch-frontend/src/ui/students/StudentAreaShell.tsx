import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';

import { getStudentProfile, type StudentProfile } from '../../utils/api';
import { StudentAreaDesignSystemStyles } from './StudentAreaDesignSystem';
import { formatStudentShortId, getStudentInitials } from './studentIdentity';

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

      <style>{`
        .student-area-shell {
          display: grid;
          gap: 1.35rem;
          color: var(--app-ink);
        }

        .student-area-masthead {
          display: grid;
          gap: 1.15rem;
          max-width: 1240px;
          width: 100%;
          margin: 0 auto;
          padding: clamp(1.1rem, 2vw, 1.65rem);
          border: 1px solid var(--app-line);
          border-radius: var(--app-radius-lg);
          background:
            linear-gradient(135deg, rgba(251, 247, 238, 0.98), rgba(244, 234, 219, 0.84));
          box-shadow: var(--app-shadow-soft);
          position: relative;
          overflow: hidden;
        }

        .student-area-masthead::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.5;
          background-image:
            linear-gradient(rgba(42, 36, 26, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(42, 36, 26, 0.035) 1px, transparent 1px);
          background-size: 26px 26px;
        }

        .student-area-masthead > * {
          position: relative;
        }

        .student-area-back {
          width: fit-content;
          color: var(--app-blue);
          font-weight: 700;
          text-decoration: none;
        }

        .student-area-back:hover {
          text-decoration: underline;
          text-underline-offset: 0.2em;
        }

        .student-area-identity-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 1rem;
          align-items: center;
        }

        .student-area-avatar {
          width: clamp(4rem, 8vw, 5.8rem);
          aspect-ratio: 1;
          border-radius: 30% 70% 62% 38% / 42% 46% 54% 58%;
          display: grid;
          place-items: center;
          border: 1px solid rgba(20, 63, 115, 0.16);
          background:
            radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.82), transparent 32%),
            linear-gradient(145deg, var(--app-paper-deep), var(--app-blue-soft));
          color: var(--app-blue);
          font-size: clamp(1.35rem, 3vw, 2rem);
          font-weight: 800;
          letter-spacing: 0.04em;
        }

        .student-area-identity-copy {
          min-width: 0;
        }

        .student-area-masthead h1 {
          margin: 0.25rem 0;
          font-family: var(--app-serif);
          font-size: clamp(2rem, 5vw, 4rem);
          line-height: 0.98;
          letter-spacing: -0.04em;
        }

        .student-area-masthead p {
          margin: 0;
          color: var(--app-muted);
        }

        .student-area-eyebrow {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--app-blue);
        }

        .student-area-page-summary {
          max-width: 42rem;
          margin-top: 0.35rem !important;
        }

        .student-area-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
          padding-top: 0.3rem;
        }

        .student-area-nav a {
          padding: 0.65rem 0.95rem;
          border: 1px solid rgba(42, 36, 26, 0.12);
          border-radius: 999px;
          text-decoration: none;
          background: rgba(255, 255, 255, 0.52);
          color: var(--app-ink);
          font-weight: 700;
          transition:
            background-color var(--transition-fast),
            border-color var(--transition-fast),
            color var(--transition-fast),
            transform var(--transition-fast);
        }

        .student-area-nav a:hover {
          transform: translateY(-1px);
        }

        .student-area-nav a.active {
          border-color: transparent;
          background: var(--app-blue);
          color: #fffaf1;
        }

        .student-area-body {
          position: relative;
          display: grid;
          gap: 1.35rem;
          width: 100%;
          max-width: 1240px;
          margin: 0 auto;
          overflow: hidden;
          padding: clamp(1.25rem, 3vw, 2.4rem);
          border: 1px solid var(--app-line);
          border-radius: var(--app-radius-lg);
          background: linear-gradient(135deg, rgba(255, 252, 245, 0.98), rgba(247, 239, 226, 0.92));
          box-shadow: var(--app-shadow-soft);
        }

        .student-area-body::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.34;
          background-image:
            linear-gradient(rgba(42, 36, 26, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(42, 36, 26, 0.025) 1px, transparent 1px);
          background-size: 44px 44px;
        }

        .student-area-body > * {
          position: relative;
        }

        @media (prefers-reduced-motion: reduce) {
          .student-area-nav a {
            transition: none;
          }

          .student-area-nav a:hover {
            transform: none;
          }
        }

        @media (max-width: 720px) {
          .student-area-body {
            padding: 1rem;
          }

          .student-area-identity-row {
            grid-template-columns: 1fr;
          }

          .student-area-avatar {
            width: 4.25rem;
          }
        }
      `}</style>
    </section>
  );
};
