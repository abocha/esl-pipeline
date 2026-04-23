import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  createStudentProfile,
  listProfileContents,
  listStudents,
  type ProfileContentOption,
  type StudentProfile,
} from '../../utils/api';
import {
  buildCreateStudentPayload,
  INITIAL_CREATE_STUDENT_FORM,
  type CreateStudentFormState,
} from './StudentWorkspace.logic';
import { CreateStudentDialog } from './CreateStudentDialog';
import { formatStudentShortId } from './studentIdentity';

export const StudentDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [profileOptions, setProfileOptions] = useState<ProfileContentOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createStudentForm, setCreateStudentForm] = useState<CreateStudentFormState>(
    INITIAL_CREATE_STUDENT_FORM,
  );

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const response = await listStudents({ limit: 200, offset: 0, order: 'asc' });
      setStudents(response.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students.';
      setStudentsError(message);
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  const loadProfileOptions = useCallback(async () => {
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
    } catch {
      setProfileOptions([]);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadStudents(), loadProfileOptions()]);
  }, [loadProfileOptions, loadStudents]);

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

  return (
    <section className="student-directory-layout">
      <article className="card student-directory-hero">
        <div>
          <span className="student-area-eyebrow">Students</span>
          <h1>Student area</h1>
          <p>Open a student’s routed workspace or create a new learner record here.</p>
        </div>
      </article>

      <article className="card">
        <CreateStudentDialog
          isOpen={createOpen}
          isBusy={createBusy}
          error={createError}
          success={createSuccess}
          profileOptions={profileOptions}
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

      <article className="card student-directory-list">
        <header className="student-directory-list-header">
          <div>
            <h2>Students</h2>
            <p>Choose a student to continue in Overview or jump straight into Learning.</p>
          </div>
          <button
            type="button"
            className="workspace-secondary-btn"
            onClick={() => void loadStudents()}
            disabled={studentsLoading}
          >
            {studentsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        {studentsError ? <p className="workspace-error">{studentsError}</p> : null}
        {studentsLoading ? <p className="workspace-muted">Loading students...</p> : null}
        {!studentsLoading && students.length === 0 ? (
          <p className="workspace-muted">No students yet. Create the first learner to begin.</p>
        ) : null}

        <div className="student-directory-grid">
          {students.map((student) => (
            <article key={student.id} className="student-directory-card">
              <div>
                <h3>{student.student}</h3>
                <p>{formatStudentShortId(student.id)}</p>
              </div>
              <div className="student-directory-actions">
                <Link to={`/students/${encodeURIComponent(student.id)}/overview`}>Open Overview</Link>
                <Link to={`/students/${encodeURIComponent(student.id)}/learning`}>Open Learning</Link>
              </div>
            </article>
          ))}
        </div>
      </article>

      <style>{`
        .student-directory-layout {
          display: grid;
          gap: 1rem;
        }

        .student-directory-hero h1,
        .student-directory-list h2,
        .student-directory-card h3,
        .student-directory-card p,
        .student-directory-hero p {
          margin: 0;
        }

        .student-directory-list {
          display: grid;
          gap: 1rem;
        }

        .student-directory-list-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }

        .student-directory-grid {
          display: grid;
          gap: 0.75rem;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }

        .student-directory-card {
          border: 1px solid var(--border-light, rgba(15, 23, 42, 0.12));
          border-radius: 1rem;
          padding: 1rem;
          display: grid;
          gap: 0.75rem;
          background: var(--bg-secondary, rgba(248, 250, 252, 0.85));
        }

        .student-directory-actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .student-directory-actions a {
          width: fit-content;
          padding: 0.65rem 0.95rem;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.1);
          color: var(--color-primary-600, #1d4ed8);
          text-decoration: none;
          font-weight: 600;
        }
      `}</style>
    </section>
  );
};
