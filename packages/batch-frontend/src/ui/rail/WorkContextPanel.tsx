import React from 'react';
import { NavLink } from 'react-router-dom';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import { useWizard } from '../../context/WizardContext';

const stepLinks = {
  student: '/wizard?step=select',
  recording: '/wizard?step=select',
  transcript: '/wizard?step=transcript',
  draft: '/wizard?step=review',
  publish: '/wizard?step=publish',
  job: '/jobs',
};

type ContextStatus = 'ready' | 'pending' | 'missing' | 'failed';

const statusLabels: Record<ContextStatus, string> = {
  ready: 'Ready',
  pending: 'In progress',
  missing: 'Missing',
  failed: 'Failed',
};

const statusClass: Record<ContextStatus, string> = {
  ready: 'context-status-ready',
  pending: 'context-status-pending',
  missing: 'context-status-missing',
  failed: 'context-status-failed',
};

const formatState = (value: string | null | undefined) =>
  value ? value.replaceAll('_', ' ') : 'unknown';

export const WorkContextPanel: React.FC = () => {
  const { selectedStudent } = useStudentSelection();
  const { state } = useWizard();
  const { jobMap, recordingMap } = useJobMonitor();

  const job = state.activeJobId ? jobMap[state.activeJobId] : null;
  const recording = state.recordingId ? recordingMap[state.recordingId] : null;

  const jobStatus: ContextStatus = job
    ? job.state === 'failed'
      ? 'failed'
      : job.state === 'succeeded'
        ? 'ready'
        : 'pending'
    : 'missing';

  const recordingStatus: ContextStatus = recording
    ? recording.status === 'failed'
      ? 'failed'
      : recording.status === 'transcribed'
        ? 'ready'
        : 'pending'
    : state.recordingId
      ? 'pending'
      : 'missing';

  const transcriptStatus: ContextStatus = state.transcriptId
    ? 'ready'
    : recording?.status === 'failed'
      ? 'failed'
      : recording?.status === 'transcribing'
        ? 'pending'
        : 'missing';

  const draftStatus: ContextStatus = state.draftId
    ? 'ready'
    : state.promptPackageId
      ? 'pending'
      : 'missing';

  const publishStatus: ContextStatus = job?.notionUrl
    ? 'ready'
    : job?.state === 'failed'
      ? 'failed'
      : job
        ? 'pending'
        : 'missing';

  return (
    <section className="rail-panel context-panel">
      <header className="context-header">
        <div>
          <h3>Work Context</h3>
          <p>Links to the active assignment artifacts.</p>
        </div>
      </header>

      <div className="context-list">
        <ContextRow
          label="Student"
          value={selectedStudent?.student ?? 'Not selected'}
          status={selectedStudent ? 'ready' : 'missing'}
          href={selectedStudent ? `/students/${selectedStudent.id}` : stepLinks.student}
        />
        <ContextRow
          label="Recording"
          value={recording?.displayName ?? state.recordingId ?? 'Not added'}
          status={recordingStatus}
          meta={recording ? formatState(recording.status) : undefined}
          href={stepLinks.recording}
        />
        <ContextRow
          label="Transcript"
          value={state.transcriptId ?? 'Not ready'}
          status={transcriptStatus}
          meta={recording?.status ? formatState(recording.status) : undefined}
          href={stepLinks.transcript}
        />
        <ContextRow
          label="Draft"
          value={state.draftId ?? 'Not created'}
          status={draftStatus}
          meta={state.promptPackageId ? 'Prompt package ready' : undefined}
          href={stepLinks.draft}
        />
        <ContextRow
          label="Job"
          value={state.activeJobId ?? 'Not started'}
          status={jobStatus}
          meta={job ? formatState(job.state) : undefined}
          href={stepLinks.job}
        />
        <ContextRow
          label="Publish"
          value={job?.notionUrl ? 'Notion link ready' : 'Not published'}
          status={publishStatus}
          meta={job?.notionUrl ? 'Published' : undefined}
          href={stepLinks.publish}
        />
      </div>
    </section>
  );
};

const ContextRow: React.FC<{
  label: string;
  value: string;
  status: ContextStatus;
  href?: string;
  meta?: string;
}> = ({ label, value, status, href, meta }) => {
  const content = (
    <>
      <div className="context-row-title">
        <span>{label}</span>
        <span className={`context-status ${statusClass[status]}`}>{statusLabels[status]}</span>
      </div>
      <div className="context-row-body">
        <span>{value}</span>
        {meta ? <span className="context-row-meta">{meta}</span> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <NavLink to={href} className="context-row">
        {content}
      </NavLink>
    );
  }

  return <div className="context-row">{content}</div>;
};
