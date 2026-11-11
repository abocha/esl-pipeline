import type { PoolClient } from 'pg';

import {
  maintenanceFactKey,
  normalizeMaintenanceFact,
} from '../application/profile-maintenance-policy.js';

const FIELDS = [
  'communicationContexts',
  'interestsAndUsefulThemes',
  'studyPreferences',
  'stableStrengths',
] as const;

/** Actual future transitions only. No historical reconstruction or separate SQL normalization. */
export async function suppressRemovedProfileFacts(
  client: PoolClient,
  studentId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  const previous = before as Partial<Record<(typeof FIELDS)[number], string[]>> | null;
  const next = after as Partial<Record<(typeof FIELDS)[number], string[]>> | null;
  for (const field of FIELDS) {
    const kept = new Set((next?.[field] ?? []).map(normalizeMaintenanceFact));
    for (const value of previous?.[field] ?? []) {
      if (kept.has(normalizeMaintenanceFact(value))) continue;
      const key = maintenanceFactKey(field, value);
      await client.query(
        `INSERT INTO student_profile_fact_suppressions
        (student_id,fact_key,change_id,field,removed_value,reason,source_latest_lesson_at)
        VALUES($1,$2,(SELECT id FROM student_profile_maintenance_changes WHERE student_id=$1 AND fact_key=$2 ORDER BY applied_at DESC LIMIT 1),$3,$4,'tutor_removed_value',clock_timestamp())
        ON CONFLICT(student_id,fact_key) DO UPDATE SET field=EXCLUDED.field,removed_value=EXCLUDED.removed_value,
          reason=EXCLUDED.reason,suppressed_at=clock_timestamp(),source_latest_lesson_at=clock_timestamp(),reconsideration_evidence='[]'::jsonb`,
        [studentId, key, field, value],
      );
    }
  }
}
