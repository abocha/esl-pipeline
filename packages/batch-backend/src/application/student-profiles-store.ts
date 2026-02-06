import { constants as FS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveConfigPaths } from '@esl-pipeline/orchestrator';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
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

interface StudentProfileEntry extends StudentProfileData {
  filePath?: string | null;
  isSynthetic?: boolean;
}

interface ResolveStudentsDirOptions {
  config?: BatchBackendConfig;
  studentsDir?: string;
  requireWritable?: boolean;
}

function isRemoteConfigProvider(config: BatchBackendConfig): boolean {
  return config.orchestrator.configProvider === 'http';
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
  if ('profileId' in input) sanitized.profileId = normalizeOptionalString(input.profileId);
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

  if (!profiles.some((profile) => profile.student === DEFAULT_STUDENT_NAME)) {
    profiles.push({
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
    });
  }

  return profiles.sort((a, b) => a.student.localeCompare(b.student));
}

async function loadProfiles(options: {
  config?: BatchBackendConfig;
  studentsDir?: string;
}): Promise<StudentProfileEntry[]> {
  const config = options.config ?? loadConfig();
  if (isRemoteConfigProvider(config)) {
    const profiles = await getStudentProfilesFromOrchestrator();
    return profiles
      .map((profile): StudentProfileEntry | null => {
        const student =
          typeof profile.student === 'string' ? normalizeStudentName(profile.student) : '';
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

  const studentsDir = await resolveStudentsDir({ config, studentsDir: options.studentsDir });
  return loadLocalProfiles(studentsDir);
}

export async function listStudentProfiles(
  params: StudentProfileListParams = {},
  overrides?: Partial<{ config: BatchBackendConfig; studentsDir: string }>,
): Promise<StudentProfileListResult> {
  const profiles = await loadProfiles({
    config: overrides?.config,
    studentsDir: overrides?.studentsDir,
  });
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
  const items = sorted.slice(offset, offset + limit);

  return {
    items: items.map(({ filePath: _filePath, isSynthetic: _isSynthetic, ...profile }) => profile),
    total: sorted.length,
    limit,
    offset,
    order,
  };
}

export async function getStudentProfileById(
  id: string,
  overrides?: Partial<{ config: BatchBackendConfig; studentsDir: string }>,
): Promise<StudentProfileData | null> {
  if (!id) return null;
  const profiles = await loadProfiles({
    config: overrides?.config,
    studentsDir: overrides?.studentsDir,
  });
  const match = profiles.find((profile) => profile.id === id);
  if (!match) return null;
  const { filePath: _filePath, isSynthetic: _isSynthetic, ...profile } = match;
  return profile;
}

export async function createStudentProfile(
  input: StudentProfileInput,
  overrides?: Partial<{ config: BatchBackendConfig; studentsDir: string }>,
): Promise<StudentProfileData> {
  const config = overrides?.config ?? loadConfig();
  if (isRemoteConfigProvider(config)) {
    throw new StudentProfileStoreError(
      'Student profiles are read-only when ESL_PIPELINE_CONFIG_PROVIDER=http',
      'student_profiles_read_only',
      409,
    );
  }

  const sanitized = sanitizeProfileInput(input);
  const student = sanitized.student?.trim();
  if (!student) {
    throw new StudentProfileStoreError('Student name is required', 'student_name_missing', 400);
  }

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
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

export async function updateStudentProfile(
  id: string,
  input: Partial<StudentProfileInput>,
  overrides?: Partial<{ config: BatchBackendConfig; studentsDir: string }>,
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

  const sanitized = sanitizeProfileInput(input);
  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
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

export async function deleteStudentProfile(
  id: string,
  overrides?: Partial<{ config: BatchBackendConfig; studentsDir: string }>,
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

  const studentsDir = await resolveStudentsDir({ config, studentsDir: overrides?.studentsDir });
  await assertWritableDir(studentsDir);

  const profiles = await loadLocalProfiles(studentsDir);
  const existing = profiles.find((profile) => profile.id === id);
  if (!existing || !existing.filePath) {
    return false;
  }

  await fs.unlink(existing.filePath);
  return true;
}
