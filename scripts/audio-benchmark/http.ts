import { readFile } from 'node:fs/promises';

import type { ProviderHttpResponse, ProviderRequest } from './providers/types';

export class BenchmarkHttpError extends Error {
  constructor(
    message: string,
    readonly outcome: 'failed' | 'uncertain',
    readonly category: string,
  ) {
    super(message);
    this.name = 'BenchmarkHttpError';
  }
}

export type FetchLike = typeof fetch;

export async function executeHttpRequest(
  request: ProviderRequest,
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHttpResponse> {
  const credential = environment[request.credentialEnv];
  if (!credential) {
    throw new BenchmarkHttpError(
      `Missing credential ${request.credentialEnv}.`,
      'failed',
      'missing_credential',
    );
  }

  const headers = {
    ...(request.headers ?? {}),
    ...authenticationHeader(request.credentialEnv, credential),
  };
  let body: RequestInit['body'];
  if (request.body?.kind === 'json') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(request.body.value);
  } else if (request.body?.kind === 'multipart') {
    const form = new FormData();
    for (const [key, value] of Object.entries(request.body.fields)) form.append(key, value);
    const bytes = await readFile(request.body.filePath);
    form.append(request.body.fileField, new Blob([bytes]), request.body.fileName);
    body = form;
  } else if (request.body?.kind === 'binary') {
    headers['content-type'] = request.body.contentType;
    body = new Uint8Array(await readFile(request.body.filePath));
  }

  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error: unknown) {
    throw new BenchmarkHttpError(
      `Request could have reached ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
      'uncertain',
      'transport_uncertain',
    );
  }

  let responseBody: string;
  try {
    responseBody = await response.text();
  } catch (error: unknown) {
    const riskBearing = request.requestRisk !== undefined && request.requestRisk !== 'none';
    throw new BenchmarkHttpError(
      `Response body from ${request.url} could not be read${
        riskBearing ? '; the request may have reached the provider' : ''
      }: ${error instanceof Error ? error.message : String(error)}`,
      riskBearing ? 'uncertain' : 'failed',
      riskBearing ? 'response_body_uncertain' : 'response_body_read_failed',
    );
  }
  return { status: response.status, body: responseBody };
}

function authenticationHeader(credentialEnv: string, credential: string): Record<string, string> {
  if (credentialEnv === 'ELEVENLABS_API_KEY') return { 'xi-api-key': credential };
  if (credentialEnv === 'DEEPGRAM_API_KEY') return { Authorization: `Token ${credential}` };
  return { Authorization: `Bearer ${credential}` };
}
