import React from 'react';

import { useStudentAreaContext } from './StudentAreaContext';

export const StudentScheduleBillingPage: React.FC = () => {
  const { student } = useStudentAreaContext();
  const studentName = student?.student ?? 'this student';

  return (
    <section className="student-schedule-billing-page">
      <article className="card student-schedule-billing-note">
        <span className="student-schedule-billing-eyebrow">Operations home</span>
        <p>
          Scheduling, reminders, credits, and payments for {studentName} are planned homes, not
          learner-profile fields. These placeholders reserve the correct surface without pretending
          unavailable features already work.
        </p>
      </article>

      <div className="student-schedule-billing-grid">
        <article className="card student-schedule-billing-card">
          <span>Next lesson</span>
          <strong>Not scheduled yet</strong>
          <p>Lesson planning and calendar state will collect here.</p>
        </article>
        <article className="card student-schedule-billing-card">
          <span>Lesson credits</span>
          <strong>Not configured yet</strong>
          <p>Credit balances stay out of the pedagogical profile.</p>
        </article>
        <article className="card student-schedule-billing-card">
          <span>Reminders</span>
          <strong>Telegram and email pending</strong>
          <p>Reminder delivery will use explicit operational state.</p>
        </article>
        <article className="card student-schedule-billing-card">
          <span>Invoices and payments</span>
          <strong>Not tracked yet</strong>
          <p>Payment records will live in the business domain.</p>
        </article>
      </div>

      <style>{`
        .student-schedule-billing-page {
          display: grid;
          gap: 1rem;
        }

        .student-schedule-billing-note,
        .student-schedule-billing-card {
          display: grid;
          gap: 0.7rem;
        }

        .student-schedule-billing-note {
          background:
            radial-gradient(circle at top right, rgba(20, 63, 115, 0.08), transparent 32%),
            rgba(255, 253, 248, 0.92);
        }

        .student-schedule-billing-eyebrow,
        .student-schedule-billing-card span {
          color: #143f73;
          font-size: 0.76rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .student-schedule-billing-note p,
        .student-schedule-billing-card p {
          margin: 0;
          color: var(--text-secondary, #52606d);
          line-height: 1.55;
        }

        .student-schedule-billing-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .student-schedule-billing-card strong {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 1.35rem;
          font-weight: 500;
          color: #151412;
        }
      `}</style>
    </section>
  );
};
