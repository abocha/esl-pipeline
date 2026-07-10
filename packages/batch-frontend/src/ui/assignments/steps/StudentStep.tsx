import { ShieldCheck } from 'lucide-react';

import { ProductNotice } from '../../system/ProductNotice';
import type { StudentStepProps } from '../assignment-step-props';

export function StudentStep({
  children,
  students,
  selectedStudentId,
  selectionLocked = false,
  error,
  onRefresh,
  onSelect,
}: StudentStepProps) {
  return (
    <div className="assignment-step assignment-step--student">
      {children}
      <section className="assignment-student-picker" aria-labelledby="assignment-student-heading">
        <div>
          <h3 id="assignment-student-heading">Choose the student</h3>
          <p>The assignment stays linked to this learner when you move between steps.</p>
        </div>
        <label>
          Student
          <select
            value={selectedStudentId}
            disabled={selectionLocked}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Select a student</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="product-button product-button--quiet" onClick={onRefresh}>
          Refresh students
        </button>
        {error ? <p className="assignment-source-pane__error">{error}</p> : null}
      </section>
      <ProductNotice tone="info" title="Learner context stays connected" icon={<ShieldCheck />}>
        The selected student’s approved learning profile and teaching memory are included when the
        assignment is created. You can review that context before generation.
      </ProductNotice>
    </div>
  );
}
