import { ChevronRight, Search } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router-dom';

import {
  createStudentProfile,
  listStudents,
  restoreStudentProfile,
  type StudentProfile,
} from '../../utils/api';
import { CreateStudentDialog } from './CreateStudentDialog';
import {
  buildCreateStudentPayload,
  type CreateStudentFormState,
  INITIAL_CREATE_STUDENT_FORM,
} from './StudentProfileUi.logic';
import { useStudentDirectoryRefresh } from './StudentWorkspaceContext';
import { getStudentInitials } from './studentIdentity';

type StudentDirectoryStatus = 'active' | 'archived';

const PAGE_SIZE = 200;

export const StudentDirectoryPage: React.FC = () => {
  const navigate = useNavigate();

  const [params, setParams] = useSearchParams();

  const selectedMatch = useMatch('/students/:studentId/*');

  const selectedId = selectedMatch?.params.studentId;

  const { version, confirmLeave } = useStudentDirectoryRefresh();

  const section = selectedMatch?.params['*'] || params.get('section') || 'overview';

  const studentStatus: StudentDirectoryStatus =
    params.get('status') === 'archived' ? 'archived' : 'active';

  const search = params.get('q')?.trim() ?? '';

  const rawOffset = Number(params.get('offset') ?? 0);

  const offset =
    Number.isSafeInteger(rawOffset) && rawOffset >= 0
      ? Math.floor(rawOffset / PAGE_SIZE) * PAGE_SIZE
      : 0;

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const setOffset = useCallback(
    (value: number) => {
      const next = new URLSearchParams(paramsRef.current);

      if (value) next.set('offset', String(value));
      else next.delete('offset');

      setParams(next, { replace: true });
    },
    [setParams],
  );

  const studentHref = (id: string) => {
    const next = new URLSearchParams(params);
    next.delete('status');
    next.delete('section');

    return `/students/${encodeURIComponent(id)}/${section}?${next}`;
  };

  const [studentPage, setStudentPage] = useState<{
    items: StudentProfile[];

    total: number;

    status: StudentDirectoryStatus;

    search: string;

    offset: number;
  } | null>(null);

  const [studentsLoading, setStudentsLoading] = useState(true);

  const [studentsError, setStudentsError] = useState<string | null>(null);

  const [studentActionError, setStudentActionError] = useState<string | null>(null);

  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const [createBusy, setCreateBusy] = useState(false);

  const [createError, setCreateError] = useState<string | null>(null);

  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [createStudentForm, setCreateStudentForm] = useState<CreateStudentFormState>(
    INITIAL_CREATE_STUDENT_FORM,
  );

  const latestStudentsRequestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentPage =
    studentPage?.status === studentStatus &&
    studentPage.search === search &&
    studentPage.offset === offset
      ? studentPage
      : null;

  const students = currentPage?.items ?? [];

  const changeStatus = (status: StudentDirectoryStatus) => {
    const next = new URLSearchParams(params);
    next.set('section', section);

    next.delete('offset');
    next.delete('focus');

    if (status === 'archived') next.set('status', status);
    else next.delete('status');

    setStudentActionError(null);

    navigate(`/students?${next}`);
  };

  const updateCreateStudentForm = useCallback<
    React.Dispatch<React.SetStateAction<CreateStudentFormState>>
  >((update) => {
    setCreateStudentForm(update);

    setCreateError(null);

    setCreateSuccess(null);
  }, []);

  const loadStudents = useCallback(async () => {
    const requestId = latestStudentsRequestRef.current + 1;

    latestStudentsRequestRef.current = requestId;

    setStudentsLoading(true);

    setStudentsError(null);

    try {
      const response = await listStudents({
        ...(search ? { q: search } : {}),

        limit: PAGE_SIZE,

        offset,

        order: 'asc',

        status: studentStatus,
      });

      if (latestStudentsRequestRef.current !== requestId) return;

      if (offset > 0 && offset >= response.total) {
        setOffset(Math.max(0, Math.floor((response.total - 1) / PAGE_SIZE) * PAGE_SIZE));

        return;
      }

      setStudentPage({
        items: response.items ?? [],

        total: response.total,

        status: studentStatus,

        search,

        offset,
      });
    } catch (error) {
      if (latestStudentsRequestRef.current !== requestId) return;

      const message = error instanceof Error ? error.message : 'Unable to load students.';

      setStudentsError(message);
    } finally {
      if (latestStudentsRequestRef.current === requestId) {
        setStudentsLoading(false);
      }
    }
  }, [studentStatus, search, offset, version, setOffset]);

  const refreshCurrentPageRef = useRef(loadStudents);

  useEffect(() => {
    refreshCurrentPageRef.current = loadStudents;
  }, [loadStudents]);

  useEffect(() => {
    void loadStudents();

    return () => {
      latestStudentsRequestRef.current += 1;
    };
  }, [loadStudents]);

  const handleCreateStudent = useCallback(async () => {
    const built = buildCreateStudentPayload(createStudentForm);

    if (!built.payload) {
      setCreateError(built.validationError ?? 'Unable to create student.');

      setCreateSuccess(null);

      return;
    }

    setCreateBusy(true);

    setCreateError(null);

    setCreateSuccess(null);

    try {
      const created = await createStudentProfile(built.payload);

      if (!mountedRef.current) return;
      setCreateSuccess(`Created ${created.student}. Redirecting to Learning...`);

      setCreateStudentForm(INITIAL_CREATE_STUDENT_FORM);

      setCreateOpen(false);

      await refreshCurrentPageRef.current();

      navigate(`/students/${encodeURIComponent(created.id)}/learning`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create student.';

      setCreateError(message);
    } finally {
      setCreateBusy(false);
    }
  }, [createStudentForm, navigate]);

  const handleRestoreStudent = useCallback(async (student: StudentProfile) => {
    setBusyStudentId(student.id);

    setStudentActionError(null);

    try {
      await restoreStudentProfile(student.id);

      await refreshCurrentPageRef.current();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to restore student.';

      setStudentActionError(message);
    } finally {
      setBusyStudentId(null);
    }
  }, []);

  const emptyMessage = search
    ? `No students match “${search}”. Try another name or clear the search.`
    : studentStatus === 'active'
      ? 'No students yet. Create the first learner to begin.'
      : 'No archived students.';

  return (
    <aside className="student-roster" aria-label="Student directory">
      <header className="roster-heading">
        <h1>Students</h1>
        <CreateStudentDialog
          isOpen={createOpen}
          isBusy={createBusy}
          error={createError}
          success={createSuccess}
          createStudentForm={createStudentForm}
          onToggleOpen={async () => {
            if (!(await confirmLeave())) return;
            setCreateStudentForm(INITIAL_CREATE_STUDENT_FORM);
            setCreateOpen(true);
            setCreateError(null);
            setCreateSuccess(null);
          }}
          onCancel={() => {
            if (!createBusy) {
              setCreateOpen(false);
              setCreateError(null);
            }
          }}
          onSubmit={() => void handleCreateStudent()}
          setCreateStudentForm={updateCreateStudentForm}
        />
      </header>
      <label className="roster-search">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search students"
          placeholder="Search students by name"
          value={params.get('q') ?? ''}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.delete('offset');

            if (event.target.value) next.set('q', event.target.value);
            else next.delete('q');

            setParams(next, { replace: true });
          }}
        />
      </label>
      <div className="roster-toolbar">
        <div className="status-switch" role="group" aria-label="Student list">
          <button
            type="button"
            aria-pressed={studentStatus === 'active'}
            onClick={() => changeStatus('active')}
          >
            Active
          </button>
          <button
            type="button"
            aria-pressed={studentStatus === 'archived'}
            onClick={() => changeStatus('archived')}
          >
            Archived
          </button>
        </div>
      </div>
      <div className="roster-scroll" aria-busy={studentsLoading}>
        {studentsError && (
          <div role="alert" className="roster-message">
            {studentsError}
            <button type="button" onClick={() => void loadStudents()}>
              Retry
            </button>
          </div>
        )}
        {studentActionError && (
          <p role="alert" className="roster-message">
            {studentActionError}
          </p>
        )}
        {studentsLoading && (
          <p role="status" className="roster-message">
            Loading students…
          </p>
        )}
        {!studentsLoading && !studentsError && students.length === 0 && (
          <p role="status" className="roster-message">
            {emptyMessage}
          </p>
        )}
        {students.map((student) => (
          <div
            className={`roster-row${selectedId === student.id ? ' selected' : ''}`}
            key={student.id}
          >
            {student.archivedAt ? (
              <div className="roster-archived">
                <span className="student-monogram" aria-hidden="true">
                  {getStudentInitials(student.student)}
                </span>
                <div>
                  <strong>{student.student}</strong>
                  {student.archiveReason && <p>{student.archiveReason}</p>}
                  <button
                    type="button"
                    disabled={busyStudentId === student.id}
                    onClick={() => void handleRestoreStudent(student)}
                  >
                    {busyStudentId === student.id ? 'Restoring…' : 'Restore student'}
                  </button>
                </div>
              </div>
            ) : (
              <Link
                to={studentHref(student.id)}
                aria-label={student.student}
                aria-current={selectedId === student.id ? 'page' : undefined}
              >
                <span className="student-monogram" aria-hidden="true">
                  {getStudentInitials(student.student)}
                </span>
                <span>{student.student}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            )}
          </div>
        ))}
      </div>
      {currentPage && currentPage.total > PAGE_SIZE && (
        <nav className="roster-pagination" aria-label="Student pages">
          <span role="status">
            {offset + 1}–{offset + students.length} of {currentPage.total}
          </span>
          <button
            type="button"
            aria-label="Previous page"
            disabled={studentsLoading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={studentsLoading || offset + PAGE_SIZE >= currentPage.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </nav>
      )}
    </aside>
  );
};
