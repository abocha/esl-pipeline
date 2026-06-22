import { createHash } from 'node:crypto';

import type { BatchBackendConfig } from '../config/env.js';

export type StudentMemoryBatchWorkload =
  | 'lesson_memory'
  | 'homework_memory'
  | 'student_memory_snapshot';

export type StudentMemoryBatchRemoteAction =
  | 'submit'
  | 'status'
  | 'poll'
  | 'reconcile'
  | 'retry'
  | 'cancel';

export class StudentMemoryOpenAiBatchAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentMemoryOpenAiBatchAccessError';
  }
}

export function assertStudentMemoryOpenAiBatchAccess(args: {
  config: BatchBackendConfig;
  model: string;
  action: StudentMemoryBatchRemoteAction;
}): void {
  if (!args.config.studentMemory.openAiBatchEnabled) {
    throw new StudentMemoryOpenAiBatchAccessError(
      `Student-memory OpenAI Batch ${args.action} is disabled. Set STUDENT_MEMORY_OPENAI_BATCH_ENABLED=true only with explicit operator approval.`,
    );
  }
  if (!args.config.generation.providers.openai.apiKey) {
    throw new StudentMemoryOpenAiBatchAccessError('OPENAI_API_KEY is required for OpenAI Batch.');
  }
  if (!args.config.generation.models.openai.allowed.includes(args.model)) {
    throw new StudentMemoryOpenAiBatchAccessError(
      `OpenAI Batch model is not allowlisted: ${args.model}`,
    );
  }
}

export interface StudentMemoryBatchJsonlItem {
  customId: string;
  model: string;
  body: Record<string, unknown>;
}

export interface StudentMemoryBatchJsonl {
  jsonl: string;
  sha256: string;
  byteLength: number;
  itemCount: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAiBatchRemoteRecord {
  id: string;
  status?: string;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: Record<string, unknown>;
  errors?: unknown;
}

export function createStudentMemoryOpenAiBatchTransport(args?: { fetchImpl?: FetchLike }) {
  const fetchImpl = args?.fetchImpl ?? fetch;

  return {
    async uploadInput(input: {
      config: BatchBackendConfig;
      model: string;
      jsonl: string;
    }): Promise<{ id: string }> {
      assertStudentMemoryOpenAiBatchAccess({
        config: input.config,
        model: input.model,
        action: 'submit',
      });
      const form = new FormData();
      form.set('purpose', 'batch');
      form.set(
        'file',
        new Blob([input.jsonl], { type: 'application/jsonl' }),
        'student-memory.jsonl',
      );
      return requestJson(fetchImpl, input.config, '/v1/files', {
        method: 'POST',
        body: form,
      }) as Promise<{ id: string }>;
    },

    async createBatch(input: {
      config: BatchBackendConfig;
      model: string;
      inputFileId: string;
    }): Promise<OpenAiBatchRemoteRecord> {
      assertStudentMemoryOpenAiBatchAccess({
        config: input.config,
        model: input.model,
        action: 'submit',
      });
      return requestJson(fetchImpl, input.config, '/v1/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_file_id: input.inputFileId,
          endpoint: '/v1/responses',
          completion_window: '24h',
        }),
      }) as Promise<OpenAiBatchRemoteRecord>;
    },

    async getBatch(input: {
      config: BatchBackendConfig;
      model: string;
      batchId: string;
    }): Promise<OpenAiBatchRemoteRecord> {
      assertStudentMemoryOpenAiBatchAccess({
        config: input.config,
        model: input.model,
        action: 'status',
      });
      return requestJson(
        fetchImpl,
        input.config,
        `/v1/batches/${encodeURIComponent(input.batchId)}`,
        { method: 'GET' },
      ) as Promise<OpenAiBatchRemoteRecord>;
    },

    async cancelBatch(input: {
      config: BatchBackendConfig;
      model: string;
      batchId: string;
    }): Promise<OpenAiBatchRemoteRecord> {
      assertStudentMemoryOpenAiBatchAccess({
        config: input.config,
        model: input.model,
        action: 'cancel',
      });
      return requestJson(
        fetchImpl,
        input.config,
        `/v1/batches/${encodeURIComponent(input.batchId)}/cancel`,
        { method: 'POST' },
      ) as Promise<OpenAiBatchRemoteRecord>;
    },

    async downloadFile(input: {
      config: BatchBackendConfig;
      model: string;
      fileId: string;
    }): Promise<string> {
      assertStudentMemoryOpenAiBatchAccess({
        config: input.config,
        model: input.model,
        action: 'reconcile',
      });
      const response = await fetchImpl(
        `https://api.openai.com/v1/files/${encodeURIComponent(input.fileId)}/content`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${input.config.generation.providers.openai.apiKey}` },
        },
      );
      if (!response.ok) {
        throw new Error(`OpenAI Batch file download failed (HTTP ${response.status})`);
      }
      return response.text();
    },
  };
}

async function requestJson(
  fetchImpl: FetchLike,
  config: BatchBackendConfig,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(`https://api.openai.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.generation.providers.openai.apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAI Batch request failed (HTTP ${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI Batch returned malformed JSON payload');
  }
  return payload;
}

const OPENAI_BATCH_MAX_REQUESTS = 50_000;
const OPENAI_BATCH_MAX_BYTES = 200 * 1024 * 1024;

export function buildStudentMemoryOpenAiBatchJsonl(args: {
  workload: StudentMemoryBatchWorkload;
  model: string;
  items: StudentMemoryBatchJsonlItem[];
}): StudentMemoryBatchJsonl {
  const seen = new Set<string>();
  const sorted = [...args.items].sort((left, right) => left.customId.localeCompare(right.customId));
  if (sorted.length === 0) {
    throw new Error('OpenAI Batch slice requires at least one item.');
  }
  if (sorted.length > OPENAI_BATCH_MAX_REQUESTS) {
    throw new Error(`OpenAI Batch slice exceeds ${OPENAI_BATCH_MAX_REQUESTS} requests.`);
  }

  const lines = sorted.map((item) => {
    if (item.model !== args.model || item.body.model !== args.model) {
      throw new Error('OpenAI Batch slice must contain one model.');
    }
    if (seen.has(item.customId)) {
      throw new Error(`OpenAI Batch custom_id is duplicated: ${item.customId}`);
    }
    seen.add(item.customId);
    return JSON.stringify({
      custom_id: item.customId,
      method: 'POST',
      url: '/v1/responses',
      body: item.body,
    });
  });
  const jsonl = `${lines.join('\n')}\n`;
  const byteLength = Buffer.byteLength(jsonl, 'utf8');
  if (byteLength > OPENAI_BATCH_MAX_BYTES) {
    throw new Error(`OpenAI Batch slice exceeds ${OPENAI_BATCH_MAX_BYTES} bytes.`);
  }

  return {
    jsonl,
    sha256: createHash('sha256').update(jsonl).digest('hex'),
    byteLength,
    itemCount: sorted.length,
  };
}
