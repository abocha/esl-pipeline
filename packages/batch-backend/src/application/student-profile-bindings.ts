import type { StudentProfileBindingRecord } from '../domain/student-profile-binding-model.js';
import {
  getActiveStudentProfileBinding,
  getStudentProfileBindingAt,
  listStudentProfileBindings,
} from '../domain/student-profile-binding-repository.js';

export interface StudentProfileBindingResponse {
  id: string;
  studentId: string;
  profileId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface StudentProfileBindingListResponse {
  items: StudentProfileBindingResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

function toResponse(binding: StudentProfileBindingRecord): StudentProfileBindingResponse {
  return {
    id: binding.id,
    studentId: binding.studentId,
    profileId: binding.profileId,
    effectiveFrom: binding.effectiveFrom.toISOString(),
    effectiveTo: binding.effectiveTo ? binding.effectiveTo.toISOString() : null,
    reason: binding.reason ?? null,
    changedBy: binding.changedBy ?? null,
    createdAt: binding.createdAt.toISOString(),
  };
}

export async function listStudentProfileBindingsForStudent(
  studentId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentProfileBindingListResponse> {
  const result = await listStudentProfileBindings({
    studentId,
    limit: params.limit,
    offset: params.offset,
    order: params.order,
  });

  return {
    items: result.items.map((item) => toResponse(item)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    order: result.order,
  };
}

export async function getActiveStudentProfileBindingForStudent(
  studentId: string,
): Promise<StudentProfileBindingResponse | null> {
  const active = await getActiveStudentProfileBinding(studentId);
  return active ? toResponse(active) : null;
}

export async function resolveStudentProfileBindingAt(
  studentId: string,
  at: Date,
): Promise<StudentProfileBindingResponse | null> {
  const binding = await getStudentProfileBindingAt(studentId, at);
  return binding ? toResponse(binding) : null;
}
