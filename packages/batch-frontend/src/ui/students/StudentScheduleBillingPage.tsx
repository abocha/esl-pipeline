import React from 'react';

import { useStudentAreaContext } from './StudentAreaContext';

export const StudentScheduleBillingPage: React.FC = () => {
  const { student } = useStudentAreaContext();

  return (
    <section className="card">
      <h2>Schedule & Billing</h2>
      <p>
        Scheduling, reminder state, and billing hooks for {student?.student ?? 'this student'} are
        reserved here so the learning surface can stay pedagogy-first.
      </p>
    </section>
  );
};
