export interface StudentProfileBindingRecord {
  id: string;
  studentId: string;
  profileId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string | null;
  changedBy: string | null;
  createdAt: Date;
}
