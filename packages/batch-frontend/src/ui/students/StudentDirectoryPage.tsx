import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  archiveStudentProfile,
  createStudentProfile,
  listStudents,
  restoreStudentProfile,
  type StudentProfile,
} from '../../utils/api';
import { CreateStudentDialog } from './CreateStudentDialog';
import { StudentAreaDesignSystemStyles } from './StudentAreaDesignSystem';
import {
  buildCreateStudentPayload,
  type CreateStudentFormState,
  INITIAL_CREATE_STUDENT_FORM,
} from './StudentProfileUi.logic';
import { formatStudentShortId, getStudentInitials } from './studentIdentity';
import './StudentDirectoryPage.css';

type StudentDirectoryStatus = 'active' | 'archived';

export const StudentDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [studentActionError, setStudentActionError] = useState<string | null>(null);
  const [studentStatus, setStudentStatus] = useState<StudentDirectoryStatus>('active');
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [openActionsStudentId, setOpenActionsStudentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createStudentForm, setCreateStudentForm] = useState<CreateStudentFormState>(
    INITIAL_CREATE_STUDENT_FORM,
  );
  const latestStudentsRequestRef = useRef(0);

  const loadStudents = useCallback(async () => {
    const requestId = latestStudentsRequestRef.current + 1;
    latestStudentsRequestRef.current = requestId;
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const response = await listStudents({
        limit: 200,
        offset: 0,
        order: 'asc',
        status: studentStatus,
      });
      if (latestStudentsRequestRef.current !== requestId) return;
      setStudents(response.items ?? []);
    } catch (error) {
      if (latestStudentsRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentsError(message);
    } finally {
      if (latestStudentsRequestRef.current === requestId) {
        setStudentsLoading(false);
      }
    }
  }, [studentStatus]);

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
      setCreateSuccess(`Created ${created.student}. Redirecting to Learning...`);
      setCreateStudentForm(INITIAL_CREATE_STUDENT_FORM);
      setCreateOpen(false);
      await loadStudents();
      navigate(`/students/${encodeURIComponent(created.id)}/learning`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create student.';
      setCreateError(message);
    } finally {
      setCreateBusy(false);
    }
  }, [createStudentForm, loadStudents, navigate]);

  const handleArchiveStudent = useCallback(
    async (student: StudentProfile) => {
      setOpenActionsStudentId(null);
      const confirmed = window.confirm(
        `Are you sure you want to archive ${student.student}? Lesson history and profile audit records will be preserved.`,
      );
      if (!confirmed) return;

      setBusyStudentId(student.id);
      setStudentActionError(null);
      try {
        await archiveStudentProfile(student.id, {
          reason: 'Archived from the student directory.',
        });
        await loadStudents();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to archive student.';
        setStudentActionError(message);
      } finally {
        setBusyStudentId(null);
      }
    },
    [loadStudents],
  );

  const handleRestoreStudent = useCallback(
    async (student: StudentProfile) => {
      setBusyStudentId(student.id);
      setStudentActionError(null);
      try {
        await restoreStudentProfile(student.id);
        await loadStudents();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to restore student.';
        setStudentActionError(message);
      } finally {
        setBusyStudentId(null);
      }
    },
    [loadStudents],
  );

  const emptyMessage =
    studentStatus === 'active'
      ? 'No students yet. Create the first learner to begin.'
      : 'No archived students.';

  return (
    <section className="student-directory-layout student-area-theme">
      <StudentAreaDesignSystemStyles />
      <article className="student-area-panel student-directory-hero">
        <div>
          <span className="student-area-eyebrow">Students</span>
          <h1>Student area</h1>
          <p>Open a student’s routed workspace or create a new learner record here.</p>
        </div>
      </article>

      <article className="student-area-panel">
        <CreateStudentDialog
          isOpen={createOpen}
          isBusy={createBusy}
          error={createError}
          success={createSuccess}
          createStudentForm={createStudentForm}
          onToggleOpen={() => {
            setCreateOpen((current) => !current);
            setCreateError(null);
            setCreateSuccess(null);
          }}
          onCancel={() => {
            setCreateOpen(false);
            setCreateError(null);
          }}
          onSubmit={() => void handleCreateStudent()}
          setCreateStudentForm={setCreateStudentForm}
        />
      </article>

      <article className="student-area-panel student-directory-list">
        <header className="student-directory-list-header">
          <div>
            <h2>Students</h2>
            <p>
              {studentStatus === 'active'
                ? 'Choose a student to continue in Overview or jump straight into Learning.'
                : 'Restore paused learners when they return.'}
            </p>
          </div>
          <div className="student-directory-list-tools">
            <div className="student-directory-status-tabs" aria-label="Student list">
              <button
                type="button"
                className={studentStatus === 'active' ? 'is-active' : ''}
                onClick={() => setStudentStatus('active')}
              >
                Active
              </button>
              <button
                type="button"
                className={studentStatus === 'archived' ? 'is-active' : ''}
                onClick={() => setStudentStatus('archived')}
              >
                Archived
              </button>
            </div>
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={() => void loadStudents()}
              disabled={studentsLoading}
            >
              {studentsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </header>

        {studentsError ? <p className="workspace-error">{studentsError}</p> : null}
        {studentActionError ? <p className="workspace-error">{studentActionError}</p> : null}
        {studentsLoading ? <p className="workspace-muted">Loading students...</p> : null}
        {!studentsLoading && students.length === 0 ? (
          <p className="workspace-muted">{emptyMessage}</p>
        ) : null}

        <div className="student-directory-grid">
          {students.map((student) => (
            <article key={student.id} className="student-area-panel student-directory-card">
              <div className="student-directory-identity">
                <div className="student-directory-avatar" aria-hidden="true">
                  {getStudentInitials(student.student)}
                </div>
                <div>
                  <h3>{student.student}</h3>
                  <p>{formatStudentShortId(student.id)}</p>
                  {student.archivedAt ? (
                    <p className="student-directory-archive-note">
                      Archived {new Date(student.archivedAt).toLocaleDateString()}
                      {student.archiveReason ? ` · ${student.archiveReason}` : ''}
                    </p>
                  ) : null}
                </div>
                {studentStatus === 'active' ? (
                  <div className="student-directory-card-menu">
                    <button
                      type="button"
                      className="student-directory-menu-trigger"
                      aria-label={`Student actions for ${student.student}`}
                      aria-haspopup="menu"
                      aria-expanded={openActionsStudentId === student.id}
                      disabled={busyStudentId === student.id}
                      onClick={() =>
                        setOpenActionsStudentId((current) =>
                          current === student.id ? null : student.id,
                        )
                      }
                    >
                      ...
                    </button>
                    {openActionsStudentId === student.id ? (
                      <div className="student-directory-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busyStudentId === student.id}
                          onClick={() => void handleArchiveStudent(student)}
                        >
                          {busyStudentId === student.id ? 'Archiving...' : 'Archive student'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="student-directory-actions">
                {studentStatus === 'active' ? (
                  <>
                    <Link
                      className="student-directory-primary-action"
                      to={`/students/${encodeURIComponent(student.id)}/overview`}
                    >
                      Open student
                    </Link>
                    <Link
                      className="student-directory-secondary-action"
                      to={`/students/${encodeURIComponent(student.id)}/learning`}
                    >
                      Open Learning
                    </Link>
                  </>
                ) : (
                  <button
                    type="button"
                    className="student-directory-primary-action"
                    disabled={busyStudentId === student.id}
                    onClick={() => void handleRestoreStudent(student)}
                  >
                    {busyStudentId === student.id ? 'Restoring...' : 'Restore student'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
};
