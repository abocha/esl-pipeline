// Standalone Vite development entry: synthetic props, no API/provider calls or persistence.
import '../configure-zod';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import '../index.css';
import '../ui/AppShell.css';
import '../ui/minimal/MinimalAssignment.css';
import { AssignmentWorkflow } from '../ui/assignments/AssignmentWorkflow';
import type { AssignmentWorkflowStep } from '../ui/assignments/assignment-workflow';
import { ContextStageSection } from '../ui/minimal/MinimalAssignment.stages';
import { CalmStudioShell } from '../ui/shell/CalmStudioShell';
import { getFrontendSandboxUser } from './frontend-sandbox';

type ContextProps = React.ComponentProps<typeof ContextStageSection>;
const cases = [
  'short',
  'long',
  'huge',
  'partial',
  'empty',
  'missing',
  'unavailable',
  'completed',
  'failed',
  'long-name',
] as const;
const many = (text: string) =>
  Array.from({ length: 12 }, (_, index) => `${index + 1}. ${text} ${text}`);
const steps: AssignmentWorkflowStep[] = [
  { id: 'student', label: 'Student', status: 'complete' },
  { id: 'source', label: 'Lesson source', status: 'complete' },
  { id: 'context', label: 'Teaching context', status: 'current' },
  { id: 'assignment', label: 'Create', status: 'locked' },
  { id: 'review', label: 'Review & share', status: 'locked' },
];

export function Preview() {
  const [mode, setMode] = useState<(typeof cases)[number]>('long');
  const [learner, setLearner] = useState(1);
  const [session, setSession] = useState(1);
  const [notes, setNotes] = useState('Focus on giving clear examples.');
  const long = mode === 'long' || mode === 'huge';
  const profile: NonNullable<ContextProps['profilePreview']> = {
    studentId: `synthetic-${learner}`,
    overallLevel: mode === 'partial' || mode === 'empty' ? null : 'B1',
    primaryGoals:
      mode === 'huge'
        ? ['One huge goal. '.repeat(150)]
        : long
          ? many(
              'Explain project decisions clearly with supporting examples and respond to follow-up questions in team meetings.',
            )
          : ['Lead project updates clearly.'],
    persistentChallenges: long
      ? many(
          'Keep past and present tenses consistent when telling stories while speaking at a natural pace.',
        )
      : ['Past tense consistency.'],
    interests: long
      ? [
          'unbrokentoken'.repeat(100),
          ...many('Cooking, hiking and practical conversations about shared plans.'),
        ]
      : ['Cooking.'],
    communicationContexts: ['Weekly team meetings.'],
    stableStrengths: ['Clear structure.'],
    studyPreferences: [],
    durableConstraints: [],
    goalsAndContexts: [],
    strengthsAndChallenges: [],
    teacherNoteSnippet: long
      ? 'Durable teacher observation with exact source text. '.repeat(120)
      : 'Use concrete examples.',
    updatedAt: null,
  };
  if (mode === 'partial') {
    profile.primaryGoals = [];
    profile.interests = [];
  }
  if (mode === 'empty') {
    profile.primaryGoals = [];
    profile.persistentChallenges = [];
    profile.interests = [];
    profile.communicationContexts = [];
    profile.stableStrengths = [];
    profile.teacherNoteSnippet = null;
  }
  const context: NonNullable<ContextProps['learnerContext']> = {
    assignmentSessionId: `synthetic-session-${session}`,
    studentId: profile.studentId,
    source: null,
    eligibility: 'eligible',
    state:
      mode === 'completed'
        ? 'completed'
        : mode === 'failed'
          ? 'failed'
          : mode === 'missing'
            ? 'not_applicable'
            : 'preparing',
    operationState: null,
    profile: null,
    pinned: null,
    confirmationAvailable: false,
    warning: null,
  };
  const name = mode === 'long-name' ? 'Synthetic'.repeat(30) : `Synthetic Learner ${learner}`;
  return (
    <MemoryRouter>
      <CalmStudioShell user={getFrontendSandboxUser()} onLogout={() => {}} sandboxMode>
        <div className="minimal-assignment">
          <div className="minimal-inline">
            <label>
              Synthetic profile{' '}
              <select
                aria-label="Synthetic profile"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                {cases.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setLearner((value) => value + 1)}>
              Switch learner
            </button>
            <button type="button" onClick={() => setSession((value) => value + 1)}>
              Switch session
            </button>
          </div>
          <AssignmentWorkflow
            steps={steps}
            activeStep="context"
            highestAvailableStep="context"
            saveState="saved"
            studentName={name}
            onStepRequest={() => {}}
            onBack={() => {}}
            onContinue={() => {}}
            continueLabel="Continue to Create"
          >
            <ContextStageSection
              stage={{ id: 'context', title: '', description: '', status: 'current' }}
              studentId={profile.studentId}
              studentName={name}
              selectedProfileId={profile.studentId}
              sessionId={context.assignmentSessionId}
              profilePreview={mode === 'unavailable' || mode === 'missing' ? null : profile}
              profileRevisionError={
                mode === 'unavailable' ? 'Unable to load synthetic learner context.' : null
              }
              learnerContext={mode === 'unavailable' ? null : context}
              teacherNotes={notes}
              onTeacherNotesChange={setNotes}
              onRetryContext={() => setMode('short')}
            />
          </AssignmentWorkflow>
        </div>
      </CalmStudioShell>
    </MemoryRouter>
  );
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />);
