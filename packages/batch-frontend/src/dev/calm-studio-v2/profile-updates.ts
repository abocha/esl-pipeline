import type { ProfileData } from './learning-data';

export type ProfileChange = {
  id: string;
  learnerId: string;
  field: keyof ProfileData;
  before: string;
  after: string;
  sourceAssignmentId: string;
  sourceId: string;
  sourceTitle: string;
  reason: string;
  status: 'applied' | 'undone';
  updatedAt: string;
};

export function profileChanges(
  before: ProfileData,
  after: ProfileData,
  provenance: {
    learnerId: string;
    sourceAssignmentId: string;
    sourceId: string;
    sourceTitle: string;
    reason: string;
    updatedAt: string;
  },
): ProfileChange[] {
  return (Object.keys(before) as (keyof ProfileData)[])
    .filter((field) => before[field] !== after[field])
    .map((field) => {
      const previousValue = before[field];
      const nextValue = after[field];
      const id = JSON.stringify([
        provenance.learnerId,
        provenance.sourceAssignmentId,
        provenance.sourceId,
        field,
        previousValue,
        nextValue,
      ]);

      return {
        id,
        learnerId: provenance.learnerId,
        field,
        before: previousValue,
        after: nextValue,
        sourceAssignmentId: provenance.sourceAssignmentId,
        sourceId: provenance.sourceId,
        sourceTitle: provenance.sourceTitle,
        reason: provenance.reason,
        status: 'applied',
        updatedAt: provenance.updatedAt,
      };
    });
}

export function undoProfileChange(profile: ProfileData, change: ProfileChange): ProfileData | null {
  if (change.status === 'undone' || profile[change.field] !== change.after) return null;

  return { ...profile, [change.field]: change.before };
}
