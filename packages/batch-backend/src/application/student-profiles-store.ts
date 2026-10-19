import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { StudentRecord } from '../domain/student-model.js';
import {
  archiveStudent,
  deleteStudent,
  getStudentById,
  insertStudent,
  listStudents,
  restoreStudent,
  upsertStudent,
} from '../domain/student-repository.js';
import {
  deriveStudentId,
  deriveWorkspaceStudentId,
  normalizeStudentName,
} from '../domain/student-utils.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  buildStarterProfileStructuredContent,
  renderStarterProfileContent,
  type StarterProfileInput,
} from './starter-profile-content.js';

export interface StudentProfileData {
  id: string;
  student: string;
  email?: string | null;
  workspaceId?: string | null;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
}

export interface StudentProfileCreateInput extends Omit<StudentProfileData, 'id'> {
  starterProfile?: StarterProfileInput | null;
}

export type StudentProfileInput = StudentProfileCreateInput;

export interface StudentProfileListResult {
  items: StudentProfileData[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface StudentProfileListParams {
  search?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  status?: 'active' | 'archived' | 'all';
  workspaceId?: string | null;
}

export interface StudentArchiveInput {
  archivedBy?: string | null;
  archiveReason?: string | null;
}

export interface StudentRestoreInput {
  restoredBy?: string | null;
}

interface StudentStoreDependencies {
  students: {
    list: typeof listStudents;
    getById: typeof getStudentById;
    insert: typeof insertStudent;
    upsert: typeof upsertStudent;
    remove: typeof deleteStudent;
    archive: typeof archiveStudent;
    restore: typeof restoreStudent;
  };
  revisions: { saveRevision: typeof saveProfileRevisionContent };
}

export interface StudentStoreOverrides {
  config?: BatchBackendConfig;
  workspaceId?: string | null;
  audit?: {
    reason?: string | null;
    changedBy?: string | null;
  };
  deps?: Partial<StudentStoreDependencies>;
}

export class StudentProfileStoreError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'StudentProfileStoreError';
    this.code = code;
    this.status = status;
  }
}

const MAX_PAGE_LIMIT = 500;

interface StudentProfileEntry extends StudentProfileData {}

function getDependencies(overrides?: StudentStoreOverrides): StudentStoreDependencies {
  return {
    students: {
      list: overrides?.deps?.students?.list ?? listStudents,
      getById: overrides?.deps?.students?.getById ?? getStudentById,
      insert: overrides?.deps?.students?.insert ?? insertStudent,
      upsert: overrides?.deps?.students?.upsert ?? upsertStudent,
      remove: overrides?.deps?.students?.remove ?? deleteStudent,
      archive: overrides?.deps?.students?.archive ?? archiveStudent,
      restore: overrides?.deps?.students?.restore ?? restoreStudent,
    },
    revisions: {
      saveRevision: overrides?.deps?.revisions?.saveRevision ?? saveProfileRevisionContent,
    },
  };
}

function assertDbEnabled(config: BatchBackendConfig): void {
  if (!config.pg.enabled) {
    throw new StudentProfileStoreError(
      'Student profile APIs require Postgres (PG_ENABLED=true)',
      'student_profiles_db_required',
      503,
    );
  }
}

function normalizeOptionalString(value?: string | null): string | null {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeProfileInput(input: Partial<StudentProfileInput>): Partial<StudentProfileInput> {
  const sanitized: Partial<StudentProfileInput> = {};
  if ('student' in input && typeof input.student === 'string') {
    sanitized.student = normalizeStudentName(input.student);
  }
  if ('email' in input) {
    const email = normalizeOptionalString(input.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new StudentProfileStoreError('Invalid student email', 'invalid_email');
    sanitized.email = email;
  }
  if ('dbId' in input) sanitized.dbId = normalizeOptionalString(input.dbId);
  if ('workspaceId' in input) sanitized.workspaceId = normalizeOptionalString(input.workspaceId);
  if ('pageParentId' in input) sanitized.pageParentId = normalizeOptionalString(input.pageParentId);
  if ('colorPreset' in input) sanitized.colorPreset = normalizeOptionalString(input.colorPreset);
  if ('accentPreference' in input) {
    sanitized.accentPreference = normalizeOptionalString(input.accentPreference);
  }
  if ('manifestPreset' in input)
    sanitized.manifestPreset = normalizeOptionalString(input.manifestPreset);
  if ('voices' in input) {
    sanitized.voices = input.voices ? { ...input.voices } : {};
  }
  if ('starterProfile' in input) {
    sanitized.starterProfile = input.starterProfile ?? null;
  }
  return sanitized;
}

function toStudentProfileData(entry: StudentProfileEntry): StudentProfileData {
  return {
    id: entry.id,
    student: entry.student,
    email: entry.email ?? null,
    dbId: entry.dbId ?? null,
    workspaceId: entry.workspaceId ?? null,
    pageParentId: entry.pageParentId ?? null,
    colorPreset: entry.colorPreset ?? null,
    accentPreference: entry.accentPreference ?? null,
    manifestPreset: entry.manifestPreset ?? null,
    voices: entry.voices ?? {},
    archivedAt: entry.archivedAt ?? null,
    archivedBy: entry.archivedBy ?? null,
    archiveReason: entry.archiveReason ?? null,
  };
}

function mapStudentRecordToEntry(record: StudentRecord): StudentProfileEntry {
  return {
    id: record.id,
    student: normalizeStudentName(record.student),
    email: record.email ?? null,
    workspaceId: record.workspaceId ?? null,
    dbId: normalizeOptionalString(record.dbId),
    pageParentId: normalizeOptionalString(record.pageParentId),
    colorPreset: normalizeOptionalString(record.colorPreset),
    accentPreference: normalizeOptionalString(record.accentPreference),
    manifestPreset: normalizeOptionalString(record.manifestPreset),
    voices: record.voices ? { ...record.voices } : {},
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
    archivedBy: normalizeOptionalString(record.archivedBy),
    archiveReason: normalizeOptionalString(record.archiveReason),
  };
}

function applyListFilters(
  profiles: StudentProfileEntry[],
  params: StudentProfileListParams,
): StudentProfileListResult {
  const query = params.search?.trim().toLowerCase();
  const status = params.status ?? 'active';
  const statusFiltered = profiles.filter((profile) => {
    if (status === 'all') return true;
    if (status === 'archived') return Boolean(profile.archivedAt);
    return !profile.archivedAt;
  });
  const filtered = query
    ? statusFiltered.filter(
        (profile) =>
          profile.student.toLowerCase().includes(query) || profile.id.toLowerCase().includes(query),
      )
    : statusFiltered;

  const order = params.order ?? 'asc';
  const sorted = [...filtered].sort((a, b) =>
    order === 'asc' ? a.student.localeCompare(b.student) : b.student.localeCompare(a.student),
  );

  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const items = sorted.slice(offset, offset + limit).map((entry) => toStudentProfileData(entry));

  return {
    items,
    total: sorted.length,
    limit,
    offset,
    order,
  };
}

async function createStudentProfileDb(
  input: StudentProfileInput,
  dependencies: StudentStoreDependencies,
  options?: {
    audit?: {
      reason?: string | null;
      changedBy?: string | null;
    };
  },
): Promise<StudentProfileData> {
  const sanitized = sanitizeProfileInput(input);
  const student = sanitized.student?.trim();
  if (!student) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }

  const workspaceId = sanitized.workspaceId ?? null;
  const id = workspaceId
    ? deriveWorkspaceStudentId(student, workspaceId)
    : deriveStudentId(student);
  const existing = await dependencies.students.getById(id, { workspaceId });
  if (existing) {
    throw new StudentProfileStoreError('Student profile already exists', 'student_exists', 409);
  }

  const starterProfile = sanitized.starterProfile ?? null;
  let inserted: StudentRecord;
  try {
    inserted = await dependencies.students.insert({
      actorUserId: options?.audit?.changedBy,
      id,
      student,
      workspaceId,
      dbId: sanitized.dbId ?? null,
      pageParentId: sanitized.pageParentId ?? null,
      colorPreset: sanitized.colorPreset ?? null,
      accentPreference: sanitized.accentPreference ?? null,
      email: sanitized.email ?? null,
      manifestPreset: sanitized.manifestPreset ?? null,
      voices: sanitized.voices ?? {},
    });
  } catch (error) {
    const pgError = error as { code?: string } | null;
    if (pgError?.code === '23505') {
      throw new StudentProfileStoreError('Student profile already exists', 'student_exists', 409);
    }
    throw error;
  }

  try {
    if (starterProfile) {
      const starterProfileStructuredContent = buildStarterProfileStructuredContent(starterProfile);
      const starterProfileContent = renderStarterProfileContent({
        studentName: student,
        starterProfile,
      });

      await dependencies.revisions.saveRevision(id, starterProfileContent, {
        source: 'starter_profile_form',
        status: 'active',
        createdBy: options?.audit?.changedBy ?? null,
        structuredContent: starterProfileStructuredContent,
      });
    }
  } catch (error) {
    await dependencies.students.remove(inserted.id).catch(() => false);
    throw error;
  }

  return toStudentProfileData(mapStudentRecordToEntry(inserted));
}

async function updateStudentProfileDb(
  id: string,
  input: Partial<StudentProfileInput>,
  options: {
    dependencies: StudentStoreDependencies;
    audit?: {
      reason?: string | null;
      changedBy?: string | null;
    };
  },
): Promise<StudentProfileData | null> {
  if (!id) return null;
  const sanitized = sanitizeProfileInput(input);
  if (Object.hasOwn(sanitized, 'student') && !(sanitized.student ?? '').trim()) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }

  const workspaceId = sanitized.workspaceId ?? null;
  const existing = await options.dependencies.students.getById(id, { workspaceId });
  if (!existing) return null;

  if (sanitized.student && deriveStudentId(sanitized.student) !== id) {
    throw new StudentProfileStoreError(
      'Student name changes require migration',
      'student_name_change_not_allowed',
      400,
    );
  }

  const has = (key: keyof StudentProfileInput) => Object.hasOwn(sanitized, key);

  const merged = {
    id: existing.id,
    student: has('student') ? (sanitized.student as string) : existing.student,
    email: has('email') ? (sanitized.email ?? null) : (existing.email ?? null),
    workspaceId: existing.workspaceId ?? workspaceId,
    dbId: has('dbId') ? (sanitized.dbId ?? null) : existing.dbId,
    pageParentId: has('pageParentId') ? (sanitized.pageParentId ?? null) : existing.pageParentId,
    colorPreset: has('colorPreset') ? (sanitized.colorPreset ?? null) : existing.colorPreset,
    accentPreference: has('accentPreference')
      ? (sanitized.accentPreference ?? null)
      : existing.accentPreference,
    manifestPreset: has('manifestPreset')
      ? (sanitized.manifestPreset ?? null)
      : existing.manifestPreset,
    voices: has('voices') ? (sanitized.voices ?? {}) : existing.voices,
  };

  const persisted = await options.dependencies.students.upsert({
    actorUserId: options.audit?.changedBy,
    id: merged.id,
    student: merged.student,
    email: merged.email,
    workspaceId: merged.workspaceId ?? null,
    dbId: merged.dbId,
    pageParentId: merged.pageParentId,
    colorPreset: merged.colorPreset,
    accentPreference: merged.accentPreference,
    manifestPreset: merged.manifestPreset,
    voices: merged.voices,
  });

  return toStudentProfileData(mapStudentRecordToEntry(persisted));
}

export async function listStudentProfiles(
  params: StudentProfileListParams = {},
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileListResult> {
  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  const dependencies = getDependencies(overrides);
  const dbResult = await dependencies.students.list({
    limit: MAX_PAGE_LIMIT,
    offset: 0,
    order: 'asc',
    status: params.status ?? 'active',
    workspaceId: params.workspaceId ?? null,
  });

  const entries = dbResult.items.map((item) => mapStudentRecordToEntry(item));
  return applyListFilters(entries, params);
}

export async function getStudentProfileById(
  id: string,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  const dependencies = getDependencies(overrides);
  const record = await dependencies.students.getById(id, {
    includeArchived: false,
    workspaceId: overrides?.workspaceId ?? null,
  });
  if (record) {
    return toStudentProfileData(mapStudentRecordToEntry(record));
  }

  return null;
}

export async function createStudentProfile(
  input: StudentProfileInput,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData> {
  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  return createStudentProfileDb(
    { ...input, workspaceId: overrides?.workspaceId ?? input.workspaceId ?? null },
    getDependencies(overrides),
    {
      audit: overrides?.audit,
    },
  );
}

export async function updateStudentProfile(
  id: string,
  input: Partial<StudentProfileInput>,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  return updateStudentProfileDb(
    id,
    { ...input, workspaceId: overrides?.workspaceId ?? input.workspaceId ?? null },
    {
      dependencies: getDependencies(overrides),
      audit: overrides?.audit,
    },
  );
}

export async function deleteStudentProfile(
  id: string,
  overrides?: StudentStoreOverrides,
): Promise<boolean> {
  if (!id) return false;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  const dependencies = getDependencies(overrides);
  const archived = await dependencies.students.archive({
    id,
    workspaceId: overrides?.workspaceId ?? null,
    archivedBy: null,
    archiveReason: 'Archived through legacy delete operation.',
  });
  if (!archived) return false;

  return true;
}

export async function archiveStudentProfile(
  id: string,
  input: StudentArchiveInput = {},
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  const dependencies = getDependencies(overrides);
  const archived = await dependencies.students.archive({
    id,
    workspaceId: overrides?.workspaceId ?? null,
    archivedBy: normalizeOptionalString(input.archivedBy),
    archiveReason: normalizeOptionalString(input.archiveReason),
  });
  if (!archived) return null;

  return toStudentProfileData(mapStudentRecordToEntry(archived));
}

export async function restoreStudentProfile(
  id: string,
  input: StudentRestoreInput = {},
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  const dependencies = getDependencies(overrides);
  const restored = await dependencies.students.restore(id, {
    actorUserId: input.restoredBy,
    workspaceId: overrides?.workspaceId ?? null,
  });
  if (!restored) return null;

  return toStudentProfileData(mapStudentRecordToEntry(restored));
}
