import { Archive, ArrowLeft, Maximize, Minimize, MoreHorizontal } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import {
  archiveStudentProfile,
  getProfileContent,
  getStudentProfile,
  type StudentProfile,
} from '../../utils/api';
import { useStudioV2 } from '../studio-v2/StudioV2Context';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { StudentDialog } from './StudentDialog';
import { useStudentDirectoryRefresh } from './StudentWorkspaceContext';
import { getStudentInitials } from './studentIdentity';

type StudentAreaPageKey =
  | 'overview'
  | 'learning'
  | 'history'
  | 'schedule-billing'
  | 'schedule'
  | 'billing';

type StudentAreaDensity = 'overview' | 'learning' | 'reading' | 'operations';

interface StudentAreaPageMeta {
  label: string;

  density: StudentAreaDensity;
}

const STUDENT_AREA_PAGE_META: Record<StudentAreaPageKey, StudentAreaPageMeta> = {
  overview: {
    label: 'Overview',

    density: 'overview',
  },

  learning: {
    label: 'Learning',

    density: 'learning',
  },

  history: {
    label: 'History',

    density: 'reading',
  },

  schedule: { label: 'Schedule', density: 'operations' },
  billing: { label: 'Billing', density: 'operations' },
  'schedule-billing': {
    label: 'Schedule & Billing',

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
  const segment = pathname.split('/').filter(Boolean).at(-1)?.toLowerCase();
  const activePage = (
    [...STUDENT_AREA_PAGE_ORDER, 'schedule', 'billing'] as StudentAreaPageKey[]
  ).find((page) => page === segment);

  return activePage ?? 'overview';
}

export const StudentAreaShell: React.FC = () => {
  const studioV2 = useStudioV2();
  const pages: StudentAreaPageKey[] = studioV2
    ? ['overview', 'learning', 'history', 'schedule', 'billing']
    : STUDENT_AREA_PAGE_ORDER;
  const { studentId = '' } = useParams<{ studentId: string }>();

  const location = useLocation();

  const navigate = useNavigate();

  const [params, setParams] = useSearchParams();

  const { refresh: refreshDirectory, confirmLeave } = useStudentDirectoryRefresh();

  const [menuOpen, setMenuOpen] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(false);

  const [archiveBusy, setArchiveBusy] = useState(false);

  const [archiveError, setArchiveError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const focused = params.get('focus') === '1';

  const sectionHref = (page: string) =>
    `/students/${encodeURIComponent(studentId)}/${page}${location.search}`;

  const rosterParams = new URLSearchParams(params);
  rosterParams.delete('focus');
  rosterParams.set('section', getActivePage(location.pathname));

  const rosterHref = `/students?${rosterParams}`;

  const [student, setStudent] = useState<StudentProfile | null>(null);

  const [studentLoading, setStudentLoading] = useState(true);
  const [studentLevel, setStudentLevel] = useState<string | null>(null);

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
      if (studioV2) {
        void getProfileContent(studentId)
          .catch(() => null)
          .then((profile) => {
            if (latestStudentRequestRef.current !== requestId) return;
            setStudentLevel(
              profile?.activeRevisionId && profile.currentRevisionId === profile.activeRevisionId
                ? profile.structuredContent?.overallLevel || null
                : null,
            );
          });
      }
    } catch (error) {
      if (latestStudentRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to load the student.';

      setStudent(null);
      setStudentLevel(null);

      setStudentError(message);
    } finally {
      if (latestStudentRequestRef.current === requestId) {
        setStudentLoading(false);
      }
    }
  }, [studentId, studioV2]);

  useEffect(() => {
    void loadStudent();

    return () => {
      latestStudentRequestRef.current += 1;
    };
  }, [loadStudent]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dismiss the menu on a route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pane scroll before painting the new route.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target))
        setMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOutside);

    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

  const archive = async () => {
    setArchiveBusy(true);
    setArchiveError(null);

    try {
      await archiveStudentProfile(studentId, { reason: 'Archived from the student directory.' });

      refreshDirectory();
      if (!mountedRef.current) return;
      setArchiveOpen(false);

      navigate(rosterHref);
    } catch (error) {
      if (!mountedRef.current) return;
      setArchiveError(error instanceof Error ? error.message : 'Unable to archive student.');
    } finally {
      if (mountedRef.current) setArchiveBusy(false);
    }
  };

  const cancelArchive = () => {
    if (!archiveBusy) {
      setArchiveOpen(false);
      menuRef.current?.querySelector<HTMLButtonElement>('.overflow-button')?.focus();
    }
  };

  return (
    <section className={`student-area-shell${studioV2 ? ' student-v2' : ''}`}>
      <div className="workspace-chrome">
        <header className="student-pane-header">
          <div className="pane-identity">
            <span className="student-monogram large" aria-hidden="true">
              {studentLoading && !student ? null : studentInitials}
            </span>
            {studentLoading && !student ? (
              <LoadingPlaceholder label="Loading student details" kind="inline" count={1} />
            ) : (
              <div>
                <h2>{studentName}</h2>
              </div>
            )}
            {studioV2 && studentLevel && (
              <span className="student-v2-level" aria-label={`Level ${studentLevel}`}>
                {studentLevel}
              </span>
            )}
          </div>
          <div className="pane-controls">
            <Link
              className="mobile-back"
              to={rosterHref}
              aria-label="Back to students"
              title="Back to students"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="focus-button"
              aria-label={focused ? 'Exit focus view' : 'Enter focus view'}
              title={focused ? 'Exit focus view' : 'Enter focus view'}
              aria-pressed={focused}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (focused) next.delete('focus');
                else next.set('focus', '1');
                setParams(next, { replace: true });
              }}
            >
              {focused ? (
                <Minimize size={19} aria-hidden="true" />
              ) : (
                <Maximize size={19} aria-hidden="true" />
              )}
            </button>
            <div
              className="student-menu"
              ref={menuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setMenuOpen(false);
                  menuRef.current?.querySelector<HTMLButtonElement>('.overflow-button')?.focus();
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  setMenuOpen(true);
                  menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
                }
              }}
            >
              <button
                type="button"
                className="overflow-button"
                aria-label={`Actions for ${studentName}`}
                title={`Actions for ${studentName}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={studentLoading || !student || Boolean(student.archivedAt)}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={22} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div role="menu" aria-label="Student actions">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      menuRef.current
                        ?.querySelector<HTMLButtonElement>('.overflow-button')
                        ?.focus();
                      setMenuOpen(false);
                      if (await confirmLeave()) {
                        setArchiveError(null);
                        setArchiveOpen(true);
                      }
                    }}
                  >
                    <Archive size={17} aria-hidden="true" />
                    Archive student
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <nav className="student-page-tabs" aria-label="Student area navigation">
          {pages.map((page) => (
            <NavLink key={page} to={sectionHref(page)}>
              {STUDENT_AREA_PAGE_META[page].label}
            </NavLink>
          ))}
        </nav>
      </div>
      {studentError && (
        <div className="student-workspace-error" role="alert">
          {studentError}
          <button type="button" onClick={() => void loadStudent()}>
            Retry student
          </button>
        </div>
      )}
      <div
        ref={bodyRef}
        className={`student-area-body student-area-body-${activePageMeta.density}`}
        data-testid="student-area-body"
      >
        <Outlet
          context={{
            student: student?.id === studentId ? student : null,
            studentId,
            studentLoading,
            studentError,
            refreshStudent: loadStudent,
          }}
        />
      </div>
      <StudentDialog open={archiveOpen} titleId="archive-student-title" onCancel={cancelArchive}>
        <h2 id="archive-student-title">Archive {studentName}?</h2>
        <p>
          The student moves to Archived. Lesson history and profile audit records are preserved.
        </p>
        {archiveError && <p role="alert">{archiveError}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={archiveBusy} onClick={cancelArchive}>
            Cancel
          </button>
          <button
            type="button"
            className="workspace-primary-btn"
            disabled={archiveBusy}
            onClick={() => void archive()}
          >
            {archiveBusy ? 'Archiving…' : 'Archive student'}
          </button>
        </div>
      </StudentDialog>
    </section>
  );
};
