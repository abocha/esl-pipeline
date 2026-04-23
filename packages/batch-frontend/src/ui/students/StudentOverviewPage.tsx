import React from 'react';
import { Link } from 'react-router-dom';

import { useStudentAreaContext } from './StudentAreaContext';
import { formatStudentShortId } from './studentIdentity';

const CARD_DEFS = [
  {
    title: 'Profile Health',
    description: 'See whether the learner profile is ready for lesson authoring.',
    ctaLabel: 'Open Learning',
    ctaPath: 'learning',
  },
  {
    title: 'Teaching Snapshot',
    description: 'Review the current pedagogical context before building the next assignment.',
    ctaLabel: 'Review Learning',
    ctaPath: 'learning',
  },
  {
    title: 'Next Lesson',
    description: 'Capture next-step teaching intent without dropping back into the legacy workspace.',
    ctaLabel: 'Open History',
    ctaPath: 'history',
  },
  {
    title: 'Billing Snapshot',
    description: 'Reserve a dedicated home for lesson credits and payment state.',
    ctaLabel: 'Open Schedule & Billing',
    ctaPath: 'schedule-billing',
  },
  {
    title: 'Reminder Status',
    description: 'Keep reminder ownership in the future schedule and billing domain.',
    ctaLabel: 'Review Schedule & Billing',
    ctaPath: 'schedule-billing',
  },
  {
    title: 'Recent Activity',
    description: 'Jump into the student timeline and provenance trail.',
    ctaLabel: 'Open History',
    ctaPath: 'history',
  },
] as const;

export const StudentOverviewPage: React.FC = () => {
  const { student, studentId, studentLoading, studentError } = useStudentAreaContext();

  return (
    <section className="student-overview-grid">
      <header className="card">
        <h2>Student overview</h2>
        <p>
          {studentError
            ? studentError
            : studentLoading
              ? 'Loading overview context...'
              : `${student?.student ?? 'This student'} • ${formatStudentShortId(studentId)}. These cards keep the control-tower shape while deeper domains mature.`}
        </p>
      </header>

      {CARD_DEFS.map((card) => (
        <article key={card.title} className="card student-overview-card">
          <h3>{card.title}</h3>
          <p>{card.description}</p>
          <Link to={`/students/${studentId}/${card.ctaPath}`}>{card.ctaLabel}</Link>
        </article>
      ))}

      <style>{`
        .student-overview-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .student-overview-grid > header {
          grid-column: 1 / -1;
        }

        .student-overview-card {
          display: grid;
          gap: 0.75rem;
        }

        .student-overview-card h3,
        .student-overview-grid h2,
        .student-overview-card p,
        .student-overview-grid p {
          margin: 0;
        }

        .student-overview-card a {
          width: fit-content;
          padding: 0.65rem 0.95rem;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.1);
          color: var(--color-primary-600, #1d4ed8);
          font-weight: 600;
          text-decoration: none;
        }
      `}</style>
    </section>
  );
};
