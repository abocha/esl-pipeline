import React from 'react';

import { useStudentAreaContext } from './StudentAreaContext';
import {
  StudentAreaMetricCard,
  StudentAreaPanel,
  StudentAreaSectionLabel,
} from './StudentAreaDesignSystem';
import './StudentScheduleBillingPage.css';

export const StudentScheduleBillingPage: React.FC = () => {
  const { student } = useStudentAreaContext();
  const studentName = student?.student ?? 'this student';

  return (
    <section className="student-schedule-billing-page student-area-theme">
      <StudentAreaPanel className="student-schedule-billing-note">
        <StudentAreaSectionLabel>Operations home</StudentAreaSectionLabel>
        <p>
          Scheduling, reminders, credits, and payments for {studentName} are planned homes, not
          learner-profile fields. These placeholders reserve the correct surface without pretending
          unavailable features already work.
        </p>
      </StudentAreaPanel>

      <div className="student-schedule-billing-grid">
        <StudentAreaMetricCard
          eyebrow="Next lesson"
          value="Not scheduled yet"
          detail="Lesson planning and calendar state will collect here."
        />
        <StudentAreaMetricCard
          eyebrow="Lesson credits"
          value="Not configured yet"
          detail="Credit balances stay out of the pedagogical profile."
        />
        <StudentAreaMetricCard
          eyebrow="Reminders"
          value="Telegram and email pending"
          detail="Reminder delivery will use explicit operational state."
          tone="attention"
        />
        <StudentAreaMetricCard
          eyebrow="Invoices and payments"
          value="Not tracked yet"
          detail="Payment records will live in the business domain."
        />
      </div>
    </section>
  );
};
