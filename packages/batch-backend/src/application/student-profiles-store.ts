import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getProfileById, upsertProfile } from '../domain/profile-repository.js';
import type { StudentRecord } from '../domain/student-model.js';
import {
  clearActiveStudentProfileBinding,
  setActiveStudentProfileBinding,
} from '../domain/student-profile-binding-repository.js';
import {
  archiveStudent,
  deleteStudent,
  getStudentById,
  insertStudent,
  listStudents,
  restoreStudent,
  upsertStudent,
} from '../domain/student-repository.js';
import { deriveStudentId, normalizeStudentName } from '../domain/student-utils.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  buildStarterProfileStructuredContent,
  renderStarterProfileContent,
  type StarterProfileInput,
} from './starter-profile-content.js';

export interface StudentProfileData {
  id: string;
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
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
  profiles: {
    getById: typeof getProfileById;
    upsert: typeof upsertProfile;
    saveRevision: typeof saveProfileRevisionContent;
  };
  bindings: {
    setActive: typeof setActiveStudentProfileBinding;
    clearActive: typeof clearActiveStudentProfileBinding;
  };
}

export interface StudentStoreOverrides {
  config?: BatchBackendConfig;
  bindingAudit?: {
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
const PROFILE_EXTENSIONS = new Set(['.md', '.txt']);

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
    profiles: {
      getById: overrides?.deps?.profiles?.getById ?? getProfileById,
      upsert: overrides?.deps?.profiles?.upsert ?? upsertProfile,
      saveRevision: overrides?.deps?.profiles?.saveRevision ?? saveProfileRevisionContent,
    },
    bindings: {
      setActive: overrides?.deps?.bindings?.setActive ?? setActiveStudentProfileBinding,
      clearActive: overrides?.deps?.bindings?.clearActive ?? clearActiveStudentProfileBinding,
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

function normalizeProfileId(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '');
}

function validateProfileId(value: string): string {
  const normalized = normalizeProfileId(value.trim());
  if (!normalized) {
    throw new StudentProfileStoreError('profileId is required', 'profile_id_missing', 400);
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!PROFILE_EXTENSIONS.has(ext)) {
    throw new StudentProfileStoreError(
      'profileId must end with .md or .txt',
      'profile_id_invalid',
      400,
    );
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new StudentProfileStoreError(
      'profileId must not include parent traversal segments',
      'profile_id_outside_root',
      400,
    );
  }
  return normalized;
}

function sanitizeProfileInput(input: Partial<StudentProfileInput>): Partial<StudentProfileInput> {
  const sanitized: Partial<StudentProfileInput> = {};
  if ('student' in input && typeof input.student === 'string') {
    sanitized.student = normalizeStudentName(input.student);
  }
  if ('dbId' in input) sanitized.dbId = normalizeOptionalString(input.dbId);
  if ('pageParentId' in input) sanitized.pageParentId = normalizeOptionalString(input.pageParentId);
  if ('colorPreset' in input) sanitized.colorPreset = normalizeOptionalString(input.colorPreset);
  if ('accentPreference' in input) {
    sanitized.accentPreference = normalizeOptionalString(input.accentPreference);
  }
  if ('manifestPreset' in input)
    sanitized.manifestPreset = normalizeOptionalString(input.manifestPreset);
  if ('profileId' in input) {
    sanitized.profileId =
      input.profileId === null || input.profileId === undefined
        ? null
        : validateProfileId(input.profileId);
  }
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
    dbId: entry.dbId ?? null,
    pageParentId: entry.pageParentId ?? null,
    colorPreset: entry.colorPreset ?? null,
    accentPreference: entry.accentPreference ?? null,
    manifestPreset: entry.manifestPreset ?? null,
    profileId: entry.profileId ?? null,
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
    dbId: normalizeOptionalString(record.dbId),
    pageParentId: normalizeOptionalString(record.pageParentId),
    colorPreset: normalizeOptionalString(record.colorPreset),
    accentPreference: normalizeOptionalString(record.accentPreference),
    manifestPreset: normalizeOptionalString(record.manifestPreset),
    profileId: normalizeOptionalString(record.profileId),
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

function profileLabelFromId(profileId: string): string {
  const base = path.basename(profileId, path.extname(profileId));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : profileId;
}

export function deriveStarterProfileId(studentId: string): string {
  return `profiles/students/${studentId}.md`;
}

async function syncBindingForStudent(
  studentId: string,
  profileId: string | null,
  dependencies: StudentStoreDependencies,
  reason: string,
  changedBy: string | null,
): Promise<void> {
  if (!profileId) {
    await dependencies.bindings.clearActive(studentId, { reason, changedBy });
    return;
  }

  await dependencies.profiles.upsert({
    id: profileId,
    label: profileLabelFromId(profileId),
    activeRevisionId: null,
  });

  await dependencies.bindings.setActive({
    studentId,
    profileId,
    reason,
    changedBy,
  });
}

async function createStudentProfileDb(
  input: StudentProfileInput,
  dependencies: StudentStoreDependencies,
  options?: {
    bindingAudit?: {
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

  const id = deriveStudentId(student);
  const existing = await dependencies.students.getById(id);
  if (existing) {
    throw new StudentProfileStoreError('Student profile already exists', 'student_exists', 409);
  }

  const starterProfile = sanitized.starterProfile ?? null;
  const profileId = sanitized.profileId ?? (starterProfile ? deriveStarterProfileId(id) : null);

  if (starterProfile && profileId) {
    const existingProfile = await dependencies.profiles.getById(profileId);
    if (existingProfile?.activeRevisionId) {
      throw new StudentProfileStoreError(
        'starterProfile requires a new or empty profileId',
        'starter_profile_profile_conflict',
        409,
      );
    }
  }

  if (profileId) {
    await dependencies.profiles.upsert({
      id: profileId,
      label: profileLabelFromId(profileId),
      activeRevisionId: null,
    });
  }

  let inserted: StudentRecord;
  try {
    inserted = await dependencies.students.insert({
      id,
      student,
      dbId: sanitized.dbId ?? null,
      pageParentId: sanitized.pageParentId ?? null,
      colorPreset: sanitized.colorPreset ?? null,
      accentPreference: sanitized.accentPreference ?? null,
      manifestPreset: sanitized.manifestPreset ?? null,
      profileId,
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
    if (starterProfile && profileId) {
      const starterProfileStructuredContent = buildStarterProfileStructuredContent(starterProfile);
      const starterProfileContent = renderStarterProfileContent({
        studentName: student,
        starterProfile,
      });

      await dependencies.profiles.saveRevision(profileId, starterProfileContent, {
        source: 'starter_profile_form',
        status: 'active',
        createdBy: options?.bindingAudit?.changedBy ?? null,
        structuredContent: starterProfileStructuredContent,
      });
    }
  } catch (error) {
    await dependencies.students.remove(inserted.id).catch(() => false);
    throw error;
  }

  await syncBindingForStudent(
    inserted.id,
    inserted.profileId ?? null,
    dependencies,
    options?.bindingAudit?.reason ?? 'student_create',
    options?.bindingAudit?.changedBy ?? null,
  );

  return toStudentProfileData(mapStudentRecordToEntry(inserted));
}

async function updateStudentProfileDb(
  id: string,
  input: Partial<StudentProfileInput>,
  options: {
    dependencies: StudentStoreDependencies;
    bindingAudit?: {
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

  const existing = await options.dependencies.students.getById(id);
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
    dbId: has('dbId') ? (sanitized.dbId ?? null) : existing.dbId,
    pageParentId: has('pageParentId') ? (sanitized.pageParentId ?? null) : existing.pageParentId,
    colorPreset: has('colorPreset') ? (sanitized.colorPreset ?? null) : existing.colorPreset,
    accentPreference: has('accentPreference')
      ? (sanitized.accentPreference ?? null)
      : existing.accentPreference,
    manifestPreset: has('manifestPreset')
      ? (sanitized.manifestPreset ?? null)
      : existing.manifestPreset,
    profileId: has('profileId') ? (sanitized.profileId ?? null) : existing.profileId,
    voices: has('voices') ? (sanitized.voices ?? {}) : existing.voices,
  };

  if (merged.profileId) {
    await options.dependencies.profiles.upsert({
      id: merged.profileId,
      label: profileLabelFromId(merged.profileId),
      activeRevisionId: null,
    });
  }

  const persisted = await options.dependencies.students.upsert({
    id: merged.id,
    student: merged.student,
    dbId: merged.dbId,
    pageParentId: merged.pageParentId,
    colorPreset: merged.colorPreset,
    accentPreference: merged.accentPreference,
    manifestPreset: merged.manifestPreset,
    profileId: merged.profileId,
    voices: merged.voices,
  });

  await syncBindingForStudent(
    persisted.id,
    persisted.profileId ?? null,
    options.dependencies,
    options.bindingAudit?.reason ?? 'student_update',
    options.bindingAudit?.changedBy ?? null,
  );

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
  const record = await dependencies.students.getById(id, { includeArchived: false });
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

  return createStudentProfileDb(input, getDependencies(overrides), {
    bindingAudit: overrides?.bindingAudit,
  });
}

export async function updateStudentProfile(
  id: string,
  input: Partial<StudentProfileInput>,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();
  assertDbEnabled(config);

  return updateStudentProfileDb(id, input, {
    dependencies: getDependencies(overrides),
    bindingAudit: overrides?.bindingAudit,
  });
}

export async function ensureStudentCanonicalProfileBinding(
  id: string,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const existing = await getStudentProfileById(id, overrides);
  if (!existing) {
    return null;
  }
  if (existing.profileId) {
    return existing;
  }

  return updateStudentProfile(
    id,
    { profileId: deriveStarterProfileId(id) },
    {
      ...overrides,
      bindingAudit: overrides?.bindingAudit,
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
    archivedBy: null,
    archiveReason: 'Archived through legacy delete operation.',
  });
  return Boolean(archived);
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
    archivedBy: normalizeOptionalString(input.archivedBy),
    archiveReason: normalizeOptionalString(input.archiveReason),
  });
  if (!archived) return null;

  await dependencies.bindings.clearActive(id, {
    reason: 'student_archive',
    changedBy: normalizeOptionalString(input.archivedBy),
  });

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
  const restored = await dependencies.students.restore(id);
  if (!restored) return null;

  await syncBindingForStudent(
    restored.id,
    restored.profileId,
    dependencies,
    'student_restore',
    normalizeOptionalString(input.restoredBy),
  );

  return toStudentProfileData(mapStudentRecordToEntry(restored));
}
