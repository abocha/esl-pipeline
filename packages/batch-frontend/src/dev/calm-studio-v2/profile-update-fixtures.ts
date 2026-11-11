import { type Learner, learners, today } from './fixtures';
import { seedProfile } from './learning-data';
import { profileChanges } from './profile-updates';

// Fictional completed updates for reviewing the proposed automatic-maintenance flow.
// This is not an inference engine or a change to the real candidate pipeline.
export function seedProfileUpdates(learner: Learner) {
  const before = seedProfile(learner);
  if (learner.id !== 'alex' && learner.id !== 'maria') return [];
  const after = { ...before };
  after.preferences +=
    learner.id === 'alex'
      ? '\nA concrete example helps before open-ended storytelling.'
      : '\nA brief rehearsal helps before answering an unexpected follow-up.';
  after.strengths +=
    learner.id === 'alex'
      ? '\nUses a short sequence of events to keep a story moving.'
      : '\nSupports a design recommendation with a concrete example.';
  return profileChanges(before, after, {
    learnerId: learner.id,
    sourceAssignmentId: `assignment-${learner.id}`,
    sourceId: learner.id === 'alex' ? 'source-alex-lesson' : 'source-maria-notes',
    sourceTitle: learner.id === 'alex' ? 'A change of plans' : 'Project review preparation',
    reason: 'A recurring pattern in the fictional recent lesson memories.',
    updatedAt: `${today}T09:30:00+07:00`,
  });
}
export const initialProfileChanges = learners.flatMap(seedProfileUpdates);
export const initialProfiles = Object.fromEntries(
  learners.map((learner) => {
    const profile = seedProfile(learner);
    for (const change of seedProfileUpdates(learner)) profile[change.field] = change.after;
    return [learner.id, profile];
  }),
);
export const initialProfileVersions = Object.fromEntries(
  learners.map((learner) => [
    learner.id,
    seedProfileUpdates(learner).length
      ? [seedProfile(learner), initialProfiles[learner.id]!]
      : [seedProfile(learner)],
  ]),
);
