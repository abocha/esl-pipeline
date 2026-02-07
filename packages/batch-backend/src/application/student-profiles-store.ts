import { constants as FS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveConfigPaths } from '@esl-pipeline/orchestrator';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { upsertProfile } from '../domain/profile-repository.js';
import type { StudentRecord } from '../domain/student-model.js';
import {
  deleteStudent,
  getStudentById,
  insertStudent,
  listStudents,
  upsertStudent,
} from '../domain/student-repository.js';
import {
  clearActiveStudentProfileBinding,
  setActiveStudentProfileBinding,
} from '../domain/student-profile-binding-repository.js';
import { deriveStudentId, normalizeStudentName } from '../domain/student-utils.js';
import { getStudentProfilesFromOrchestrator } from '../infrastructure/orchestrator-service.js';

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
}

export type StudentProfileInput = Omit<StudentProfileData, 'id'>;

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
}

interface StudentStoreDependencies {
  students: {
    list: typeof listStudents;
    getById: typeof getStudentById;
    insert: typeof insertStudent;
    upsert: typeof upsertStudent;
    remove: typeof deleteStudent;
  };
  profiles: {
    upsert: typeof upsertProfile;
  };
  bindings: {
    setActive: typeof setActiveStudentProfileBinding;
    clearActive: typeof clearActiveStudentProfileBinding;
  };
}

interface StudentStoreOverrides {
  config?: BatchBackendConfig;
  studentsDir?: string;
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

const DEFAULT_STUDENT_NAME = 'Default';
const DEFAULT_COLOR_PRESET = 'b1-default';
const MAX_PAGE_LIMIT = 500;
const PROFILE_EXTENSIONS = new Set(['.md', '.txt']);

interface StudentProfileEntry extends StudentProfileData {
  filePath?: string | null;
  isSynthetic?: boolean;
}

interface ResolveStudentsDirOptions {
  config?: BatchBackendConfig;
  studentsDir?: string;
}

function getDependencies(overrides?: StudentStoreOverrides): StudentStoreDependencies {
  return {
    students: {
      list: overrides?.deps?.students?.list ?? listStudents,
      getById: overrides?.deps?.students?.getById ?? getStudentById,
      insert: overrides?.deps?.students?.insert ?? insertStudent,
      upsert: overrides?.deps?.students?.upsert ?? upsertStudent,
      remove: overrides?.deps?.students?.remove ?? deleteStudent,
    },
    profiles: {
      upsert: overrides?.deps?.profiles?.upsert ?? upsertProfile,
    },
    bindings: {
      setActive: overrides?.deps?.bindings?.setActive ?? setActiveStudentProfileBinding,
      clearActive: overrides?.deps?.bindings?.clearActive ?? clearActiveStudentProfileBinding,
    },
  };
}

function isRemoteConfigProvider(config: BatchBackendConfig): boolean {
  return config.orchestrator.configProvider === 'http';
}

function getStudentSystemSource(config: BatchBackendConfig): 'fs' | 'hybrid' | 'db' {
  return config.studentSystem?.source ?? 'fs';
}

function isDbBackedSource(config: BatchBackendConfig): boolean {
  const source = getStudentSystemSource(config);
  return source === 'db' || source === 'hybrid';
}

function shouldReadFsFallback(config: BatchBackendConfig): boolean {
  return getStudentSystemSource(config) === 'hybrid' && (config.studentSystem?.fsFallback ?? true);
}

async function resolveStudentsDir(options: ResolveStudentsDirOptions): Promise<string> {
  const config = options.config ?? loadConfig();
  if (options.studentsDir) {
    return path.resolve(options.studentsDir);
  }

  const cwd = process.env.PIPELINE_CWD || process.cwd();
  const configPaths = resolveConfigPaths({
    cwd,
    configDir: config.orchestrator.configDir,
  });

  return configPaths.studentsDir;
}

async function assertWritableDir(studentsDir: string): Promise<void> {
  try {
    const stats = await fs.stat(studentsDir);
    if (!stats.isDirectory()) {
      throw new StudentProfileStoreError(
        'Students directory is not a directory',
        'students_dir_invalid',
        409,
      );
    }
    await fs.access(studentsDir, FS.W_OK);
  } catch (error) {
    if (error instanceof StudentProfileStoreError) {
      throw error;
    }
    throw new StudentProfileStoreError(
      'Students directory is not writable',
      'students_dir_not_writable',
      409,
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
  return sanitized;
}

function slugifyStudentName(name: string): string {
  const normalized = normalizeStudentName(name).toLowerCase();
  return normalized.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

function isAscii(value: string): boolean {
  return /^[\u0020-\u007E]+$/.test(value);
}

function ensureSafeFileBase(base: string): string {
  const cleaned = base.replaceAll(/[/\\]/g, '-').replaceAll(/[^a-zA-Z0-9._-]+/g, '-');
  const trimmed = cleaned.replaceAll(/^-+/g, '').replaceAll(/-+$/g, '');
  if (!trimmed || !isAscii(trimmed)) {
    throw new StudentProfileStoreError(
      'Student filename contains unsupported characters',
      'student_filename_invalid',
      400,
    );
  }
  return trimmed;
}

function buildStudentFilename(student: string, existingNames: Set<string>): string {
  const slug = slugifyStudentName(student);
  const base = slug || `student-${deriveStudentId(student).slice(0, 8)}`;
  const safeBase = ensureSafeFileBase(base);
  let candidate = `${safeBase}.json`;
  let counter = 1;
  while (existingNames.has(candidate)) {
    candidate = `${safeBase}-${counter}.json`;
    counter += 1;
  }
  return candidate;
}

function buildDefaultProfileEntry(): StudentProfileEntry {
  return {
    id: deriveStudentId(DEFAULT_STUDENT_NAME),
    student: DEFAULT_STUDENT_NAME,
    dbId: null,
    pageParentId: null,
    colorPreset: DEFAULT_COLOR_PRESET,
    accentPreference: null,
    manifestPreset: null,
    profileId: null,
    voices: {},
    filePath: null,
    isSynthetic: true,
  };
}

function ensureDefaultProfileEntry(entries: StudentProfileEntry[]): StudentProfileEntry[] {
  if (entries.some((entry) => entry.id === deriveStudentId(DEFAULT_STUDENT_NAME))) {
    return entries;
  }
  return [...entries, buildDefaultProfileEntry()];
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
    filePath: null,
  };
}

function applyListFilters(
  profiles: StudentProfileEntry[],
  params: StudentProfileListParams,
): StudentProfileListResult {
  const query = params.search?.trim().toLowerCase();
  const filtered = query
    ? profiles.filter(
        (profile) =>
          profile.student.toLowerCase().includes(query) || profile.id.toLowerCase().includes(query),
      )
    : profiles;

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

async function syncBindingForStudent(
  studentId: string,
  profileId: string | null,
  dependencies: StudentStoreDependencies,
  reason: string,
): Promise<void> {
  if (!profileId) {
    await dependencies.bindings.clearActive(studentId);
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
    changedBy: null,
  });
}

async function loadLocalProfiles(studentsDir: string): Promise<StudentProfileEntry[]> {
  const entries = await fs.readdir(studentsDir, { withFileTypes: true });
  const profiles: StudentProfileEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    const filePath = path.join(studentsDir, entry.name);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<StudentProfileData>;
      if (!data || typeof data.student !== 'string') continue;
      const student = normalizeStudentName(data.student);
      if (!student) continue;
      const profile: StudentProfileEntry = {
        id: deriveStudentId(student),
        student,
        dbId: normalizeOptionalString(data.dbId),
        pageParentId: normalizeOptionalString(data.pageParentId),
        colorPreset: normalizeOptionalString(data.colorPreset),
        accentPreference: normalizeOptionalString(data.accentPreference),
        manifestPreset: normalizeOptionalString(data.manifestPreset),
        profileId: normalizeOptionalString(data.profileId),
        voices: data.voices ? { ...data.voices } : {},
        filePath,
      };
      profiles.push(profile);
    } catch {
      continue;
    }
  }

  return ensureDefaultProfileEntry(profiles).sort((a, b) => a.student.localeCompare(b.student));
}

async function loadRemoteProfiles(): Promise<StudentProfileEntry[]> {
  const profiles = await getStudentProfilesFromOrchestrator();
  return profiles
    .map((profile): StudentProfileEntry | null => {
      const student = typeof profile.student === 'string' ? normalizeStudentName(profile.student) : '';
      if (!student) return null;
      return {
        id: deriveStudentId(student),
        student,
        dbId: normalizeOptionalString(profile.dbId),
        pageParentId: normalizeOptionalString(profile.pageParentId),
        colorPreset: normalizeOptionalString(profile.colorPreset),
        accentPreference: normalizeOptionalString(profile.accentPreference),
        manifestPreset: normalizeOptionalString(profile.manifestPreset),
        profileId: normalizeOptionalString(profile.profileId),
        voices: profile.voices ? { ...profile.voices } : {},
        filePath: null,
      };
    })
    .filter((profile): profile is StudentProfileEntry => profile !== null)
    .sort((a, b) => a.student.localeCompare(b.student));
}

async function getLocalProfileById(
  id: string,
  studentsDir: string,
): Promise<StudentProfileEntry | null> {
  if (!id) return null;
  const profiles = await loadLocalProfiles(studentsDir);
  return profiles.find((profile) => profile.id === id) ?? null;
}

async function createStudentProfileLocal(
  input: StudentProfileInput,
  studentsDir: string,
): Promise<StudentProfileData> {
  const sanitized = sanitizeProfileInput(input);
  const student = sanitized.student?.trim();
  if (!student) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }

  await assertWritableDir(studentsDir);

  const existing = await loadLocalProfiles(studentsDir);
  const id = deriveStudentId(student);
  if (existing.some((profile) => profile.id === id)) {
    throw new StudentProfileStoreError('Student profile already exists', 'student_exists', 409);
  }

  const fileNames = new Set(
    existing
      .map((profile) => (profile.filePath ? path.basename(profile.filePath) : ''))
      .filter(Boolean),
  );
  const filename = buildStudentFilename(student, fileNames);
  const filePath = path.join(studentsDir, filename);

  const payload: Record<string, unknown> = {
    student,
    dbId: sanitized.dbId ?? null,
    pageParentId: sanitized.pageParentId ?? null,
    colorPreset: sanitized.colorPreset ?? null,
    accentPreference: sanitized.accentPreference ?? null,
    manifestPreset: sanitized.manifestPreset ?? null,
    profileId: sanitized.profileId ?? null,
    voices: sanitized.voices ?? {},
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return {
    id,
    student,
    dbId: payload.dbId as string | null,
    pageParentId: payload.pageParentId as string | null,
    colorPreset: payload.colorPreset as string | null,
    accentPreference: payload.accentPreference as string | null,
    manifestPreset: payload.manifestPreset as string | null,
    profileId: payload.profileId as string | null,
    voices: payload.voices as Record<string, string>,
  };
}

async function updateStudentProfileLocal(
  id: string,
  input: Partial<StudentProfileInput>,
  studentsDir: string,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const sanitized = sanitizeProfileInput(input);
  if (Object.hasOwn(sanitized, 'student') && !(sanitized.student ?? '').trim()) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }
  await assertWritableDir(studentsDir);

  const profiles = await loadLocalProfiles(studentsDir);
  const existing = profiles.find((profile) => profile.id === id);
  if (!existing) return null;

  if (sanitized.student && deriveStudentId(sanitized.student) !== id) {
    throw new StudentProfileStoreError(
      'Student name changes require migration',
      'student_name_change_not_allowed',
      400,
    );
  }

  const merged: StudentProfileEntry = {
    ...existing,
    ...sanitized,
    student: sanitized.student ?? existing.student,
  };

  let filePath = existing.filePath ?? null;
  if (!filePath) {
    const fileNames = new Set(
      profiles
        .map((profile) => (profile.filePath ? path.basename(profile.filePath) : ''))
        .filter(Boolean),
    );
    const filename = buildStudentFilename(merged.student, fileNames);
    filePath = path.join(studentsDir, filename);
  }

  const payload: Record<string, unknown> = {
    student: merged.student,
    dbId: merged.dbId ?? null,
    pageParentId: merged.pageParentId ?? null,
    colorPreset: merged.colorPreset ?? null,
    accentPreference: merged.accentPreference ?? null,
    manifestPreset: merged.manifestPreset ?? null,
    profileId: merged.profileId ?? null,
    voices: merged.voices ?? {},
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return {
    id,
    student: merged.student,
    dbId: merged.dbId ?? null,
    pageParentId: merged.pageParentId ?? null,
    colorPreset: merged.colorPreset ?? null,
    accentPreference: merged.accentPreference ?? null,
    manifestPreset: merged.manifestPreset ?? null,
    profileId: merged.profileId ?? null,
    voices: merged.voices ?? {},
  };
}

async function deleteStudentProfileLocal(id: string, studentsDir: string): Promise<boolean> {
  if (!id) return false;

  await assertWritableDir(studentsDir);

  const profiles = await loadLocalProfiles(studentsDir);
  const existing = profiles.find((profile) => profile.id === id);
  if (!existing || !existing.filePath) {
    return false;
  }

  await fs.unlink(existing.filePath);
  return true;
}

async function createStudentProfileDb(
  input: StudentProfileInput,
  dependencies: StudentStoreDependencies,
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
      profileId: sanitized.profileId ?? null,
      voices: sanitized.voices ?? {},
    });
  } catch (error) {
    const pgError = error as { code?: string } | null;
    if (pgError?.code === '23505') {
      throw new StudentProfileStoreError('Student profile already exists', 'student_exists', 409);
    }
    throw error;
  }

  await syncBindingForStudent(inserted.id, inserted.profileId ?? null, dependencies, 'student_create');

  return toStudentProfileData(mapStudentRecordToEntry(inserted));
}

async function updateStudentProfileDb(
  id: string,
  input: Partial<StudentProfileInput>,
  options: {
    studentsDir?: string;
    allowFsFallbackRead: boolean;
    dependencies: StudentStoreDependencies;
  },
): Promise<StudentProfileData | null> {
  if (!id) return null;
  const sanitized = sanitizeProfileInput(input);
  if (Object.hasOwn(sanitized, 'student') && !(sanitized.student ?? '').trim()) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }

  let existing = await options.dependencies.students.getById(id);
  if (!existing && options.allowFsFallbackRead && options.studentsDir) {
    const local = await getLocalProfileById(id, options.studentsDir);
    if (local) {
      existing = {
        id: local.id,
        student: local.student,
        dbId: local.dbId ?? null,
        pageParentId: local.pageParentId ?? null,
        colorPreset: local.colorPreset ?? null,
        voices: local.voices ?? {},
        manifestPreset: local.manifestPreset ?? null,
        accentPreference: local.accentPreference ?? null,
        profileId: local.profileId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }
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
    manifestPreset: has('manifestPreset') ? (sanitized.manifestPreset ?? null) : existing.manifestPreset,
    profileId: has('profileId') ? (sanitized.profileId ?? null) : existing.profileId,
    voices: has('voices') ? (sanitized.voices ?? {}) : existing.voices,
  };

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
    'student_update',
  );

  return toStudentProfileData(mapStudentRecordToEntry(persisted));
}

export async function listStudentProfiles(
  params: StudentProfileListParams = {},
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileListResult> {
  const config = overrides?.config ?? loadConfig();

  if (isRemoteConfigProvider(config)) {
    const remoteProfiles = await loadRemoteProfiles();
    return applyListFilters(remoteProfiles, params);
  }

  if (isDbBackedSource(config)) {
    const dependencies = getDependencies(overrides);
    const dbResult = await dependencies.students.list({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      order: 'asc',
    });

    if (dbResult.items.length === 0 && shouldReadFsFallback(config)) {
      const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
      const localProfiles = await loadLocalProfiles(studentsDir);
      return applyListFilters(localProfiles, params);
    }

    const entries = ensureDefaultProfileEntry(dbResult.items.map((item) => mapStudentRecordToEntry(item)));
    return applyListFilters(entries, params);
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  const localProfiles = await loadLocalProfiles(studentsDir);
  return applyListFilters(localProfiles, params);
}

export async function getStudentProfileById(
  id: string,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();

  if (isRemoteConfigProvider(config)) {
    const remoteProfiles = await loadRemoteProfiles();
    const remoteMatch = remoteProfiles.find((profile) => profile.id === id);
    return remoteMatch ? toStudentProfileData(remoteMatch) : null;
  }

  if (isDbBackedSource(config)) {
    const dependencies = getDependencies(overrides);
    const record = await dependencies.students.getById(id);
    if (record) {
      return toStudentProfileData(mapStudentRecordToEntry(record));
    }

    if (id === deriveStudentId(DEFAULT_STUDENT_NAME)) {
      return toStudentProfileData(buildDefaultProfileEntry());
    }

    if (shouldReadFsFallback(config)) {
      const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
      const localMatch = await getLocalProfileById(id, studentsDir);
      return localMatch ? toStudentProfileData(localMatch) : null;
    }

    return null;
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  const localMatch = await getLocalProfileById(id, studentsDir);
  return localMatch ? toStudentProfileData(localMatch) : null;
}

export async function createStudentProfile(
  input: StudentProfileInput,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData> {
  const config = overrides?.config ?? loadConfig();

  if (isRemoteConfigProvider(config)) {
    throw new StudentProfileStoreError(
      'Student profiles are read-only when ESL_PIPELINE_CONFIG_PROVIDER=http',
      'student_profiles_read_only',
      409,
    );
  }

  if (isDbBackedSource(config)) {
    return createStudentProfileDb(input, getDependencies(overrides));
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  return createStudentProfileLocal(input, studentsDir);
}

export async function updateStudentProfile(
  id: string,
  input: Partial<StudentProfileInput>,
  overrides?: StudentStoreOverrides,
): Promise<StudentProfileData | null> {
  if (!id) return null;

  const config = overrides?.config ?? loadConfig();

  if (isRemoteConfigProvider(config)) {
    throw new StudentProfileStoreError(
      'Student profiles are read-only when ESL_PIPELINE_CONFIG_PROVIDER=http',
      'student_profiles_read_only',
      409,
    );
  }

  if (isDbBackedSource(config)) {
    const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
    return updateStudentProfileDb(id, input, {
      studentsDir,
      allowFsFallbackRead: shouldReadFsFallback(config),
      dependencies: getDependencies(overrides),
    });
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  return updateStudentProfileLocal(id, input, studentsDir);
}

export async function deleteStudentProfile(
  id: string,
  overrides?: StudentStoreOverrides,
): Promise<boolean> {
  if (!id) return false;

  const config = overrides?.config ?? loadConfig();

  if (isRemoteConfigProvider(config)) {
    throw new StudentProfileStoreError(
      'Student profiles are read-only when ESL_PIPELINE_CONFIG_PROVIDER=http',
      'student_profiles_read_only',
      409,
    );
  }

  if (isDbBackedSource(config)) {
    const dependencies = getDependencies(overrides);
    const removed = await dependencies.students.remove(id);
    if (removed) {
      return true;
    }

    if (shouldReadFsFallback(config)) {
      const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
      return deleteStudentProfileLocal(id, studentsDir);
    }

    return false;
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  return deleteStudentProfileLocal(id, studentsDir);
}
