import { ArrowRight, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { fetchStudentOptions, type StudentOption } from '../../utils/api';
import { BusinessSchedulePage } from '../business/BusinessSchedulePage';
import { StudentDialog } from '../students/StudentDialog';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { ContinueAssignments } from './ContinueAssignments';
import '../business/BusinessDashboard.css';
import './DayPage.css';

export default function DayPage() {
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!choosing) return;
    let current = true;
    setError(false);
    void fetchStudentOptions()
      .then((result) => {
        if (current) setStudents(result.students);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [choosing, retry]);
  return (
    <section className="business-dashboard-page studio-v2-day">
      <header className="business-dashboard-header">
        <h1>Your day</h1>
        <button
          className="workspace-primary-btn studio-v2-day-create"
          type="button"
          onClick={() => setChoosing(true)}
        >
          <Plus size={18} aria-hidden="true" />
          Schedule lesson
        </button>
      </header>
      <BusinessSchedulePage />
      <ContinueAssignments />
      <StudentDialog
        open={choosing}
        titleId="schedule-student-title"
        onCancel={() => setChoosing(false)}
      >
        <header className="studio-v2-student-picker-heading">
          <h2 id="schedule-student-title">Schedule a lesson</h2>
          <button
            type="button"
            aria-label="Close student selection"
            onClick={() => setChoosing(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <label className="studio-v2-student-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Find a student"
            placeholder="Find a student"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {error ? (
          <p role="alert">
            Students unavailable.{' '}
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
          </p>
        ) : !students ? (
          <LoadingPlaceholder label="Loading students" kind="roster" />
        ) : (
          <ul className="studio-v2-student-picker">
            {students
              .filter((student) =>
                student.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              )
              .map((student) => (
                <li key={student.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setChoosing(false);
                      navigate(
                        `/students/${encodeURIComponent(student.id)}/schedule#teaching-calendar`,
                      );
                    }}
                  >
                    <span>{student.name}</span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
          </ul>
        )}
        {students?.length === 0 && <Link to="/students">Add a student</Link>}
        {students?.length &&
        !students.some((student) =>
          student.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ) ? (
          <p>No students match.</p>
        ) : null}
      </StudentDialog>
    </section>
  );
}
