/** Student-authorized, server-paged activity. Historical gaps are not reconstructed. */
export type StudentActivityCategory =
  | 'lessons'
  | 'profile'
  | 'billing'
  | 'lifecycle'
  | 'operations';

export interface StudentActivityFact {
  label: string;
  value: string;
}

export interface StudentActivityItem {
  id: string;
  type: string;
  category: StudentActivityCategory;
  occurredAt: string;
  subject: string;
  summary?: string | null;
  actor?: { kind: 'user' | 'system' | 'unknown'; label?: string | null } | null;
  evidence: 'recorded' | 'retained' | 'legacy';
  effectiveAt?: string | null;
  details: StudentActivityFact[];
  links: Array<{ label: string; href: string }>;
  effects?: StudentActivityFact[];
}

export interface StudentActivityResponse {
  items: StudentActivityItem[];
  nextCursor: string | null;
  timezone: string;
  coverage: { recordingStartedAt: string | null; notice: string };
}
