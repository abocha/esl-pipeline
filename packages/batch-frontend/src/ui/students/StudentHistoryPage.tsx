import React from 'react';

import { useStudentAreaContext } from './StudentAreaContext';

export const StudentHistoryPage: React.FC = () => {
  const { student } = useStudentAreaContext();

  return (
    <section className="card">
      <h2>Student history</h2>
      <p>
        Timeline, provenance, and assignment chronology for {student?.student ?? 'this student'}
        will live here as the new long-term home for history work.
      </p>
    </section>
  );
};
