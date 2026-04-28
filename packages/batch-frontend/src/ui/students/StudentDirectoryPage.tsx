import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  createStudentProfile,
  listProfileContents,
  listStudents,
  type ProfileContentOption,
  type StudentProfile,
} from '../../utils/api';
import { CreateStudentDialog } from './CreateStudentDialog';
import { StudentAreaDesignSystemStyles } from './StudentAreaDesignSystem';
import {
  buildCreateStudentPayload,
  type CreateStudentFormState,
  INITIAL_CREATE_STUDENT_FORM,
} from './StudentWorkspace.logic';
import { formatStudentShortId, getStudentInitials } from './studentIdentity';
import './StudentDirectoryPage.css';

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
    <section className="student-directory-layout student-area-theme">
      <StudentAreaDesignSystemStyles />
      <article className="student-area-panel card student-directory-hero">
        <div>
          <span className="student-area-eyebrow">Students</span>
          <h1>Student area</h1>
          <p>Open a student’s routed workspace or create a new learner record here.</p>
        </div>
      </article>

      <article className="student-area-panel card">
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

      <article className="student-area-panel card student-directory-list">
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
            <article key={student.id} className="student-area-panel student-directory-card">
              <div className="student-directory-identity">
                <div className="student-directory-avatar" aria-hidden="true">
                  {getStudentInitials(student.student)}
                </div>
                <div>
                  <h3>{student.student}</h3>
                  <p>{formatStudentShortId(student.id)}</p>
                </div>
              </div>
              <div className="student-directory-actions">
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
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
};
