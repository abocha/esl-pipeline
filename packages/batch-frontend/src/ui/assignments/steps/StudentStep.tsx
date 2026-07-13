import { useEffect, useRef, useState } from 'react';

import type { StudentStepProps } from '../assignment-step-props';

export function StudentStep({
  children,
  students,
  selectedStudentId,
  selectionLocked = false,
  error,
  onSelect,
}: StudentStepProps) {
  const [isChangingStudent, setIsChangingStudent] = useState(false);
  const studentSelectRef = useRef<HTMLSelectElement>(null);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? null;
  const showSelector = !selectedStudent || isChangingStudent;

  useEffect(() => {
    if (isChangingStudent) {
      studentSelectRef.current?.focus();
    }
  }, [isChangingStudent]);

  const handleStudentChange = (studentId: string) => {
    onSelect(studentId);
    if (students.some((student) => student.id === studentId)) {
      setIsChangingStudent(false);
    }
  };

  return (
    <div className="assignment-step assignment-step--student">
      {children}
      {showSelector ? (
        <section
          className="assignment-student-choice assignment-student-choice--open"
          aria-labelledby="assignment-student-heading"
        >
          <div className="assignment-student-choice__copy">
            <h3 id="assignment-student-heading">Choose the student</h3>
          </div>
          <label>
            Student
            <select
              ref={studentSelectRef}
              value={selectedStudentId}
              disabled={selectionLocked}
              onChange={(event) => handleStudentChange(event.target.value)}
            >
              <option value="">Select a student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="assignment-source-pane__error">{error}</p> : null}
        </section>
      ) : (
        <section
          className="assignment-student-choice assignment-choice-summary"
          aria-labelledby="assignment-student-heading"
        >
          <div className="assignment-choice-summary__identity">
            <span className="assignment-choice-summary__avatar" aria-hidden="true">
              {selectedStudent.name.trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="assignment-choice-summary__label">Student</p>
              <h3 id="assignment-student-heading">{selectedStudent.name}</h3>
              <p>Selected for this assignment</p>
            </div>
          </div>
          <button
            type="button"
            className="product-button product-button--quiet"
            disabled={selectionLocked}
            onClick={() => setIsChangingStudent(true)}
          >
            Change student
          </button>
          {error ? <p className="assignment-source-pane__error">{error}</p> : null}
        </section>
      )}
    </div>
  );
}
