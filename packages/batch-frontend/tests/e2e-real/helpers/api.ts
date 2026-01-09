import type { APIRequestContext } from '@playwright/test';

const DEFAULT_BACKEND_URL = 'http://localhost:8080';

function resolveBackendUrl(): string {
  return process.env.BATCH_BACKEND_URL || DEFAULT_BACKEND_URL;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function createStudentProfile(
  request: APIRequestContext,
  accessToken: string,
  payload: { student: string },
): Promise<{ id: string; student: string }> {
  const backendUrl = resolveBackendUrl();
  const response = await request.post(`${backendUrl}/students`, {
    data: payload,
    headers: buildAuthHeaders(accessToken),
  });
  if (response.status() !== 201) {
    const body = await response.text();
    throw new Error(`Failed to create student: ${response.status()} ${body}`);
  }
  return (await response.json()) as { id: string; student: string };
}

export async function deleteStudentProfile(
  request: APIRequestContext,
  accessToken: string,
  studentId: string,
): Promise<void> {
  const backendUrl = resolveBackendUrl();
  const response = await request.delete(`${backendUrl}/students/${encodeURIComponent(studentId)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (![200, 204, 404].includes(response.status())) {
    const body = await response.text();
    throw new Error(`Failed to delete student: ${response.status()} ${body}`);
  }
}
