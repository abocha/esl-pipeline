import {
  assertStudentMemoryOpenAiBatchAccess,
  createStudentMemoryOpenAiBatchTransport,
  type StudentMemoryBatchWorkload,
} from '../application/student-memory-openai-batch.js';
import {
  buildHomeworkMemoryBatchCandidates,
  buildLessonMemoryBatchCandidates,
  buildStudentMemorySnapshotBatchCandidates,
} from '../application/student-memory-openai-batch-candidates.js';
import {
  createStudentMemoryOpenAiBatchPlan,
  submitStudentMemoryOpenAiBatchPlan,
} from '../application/student-memory-openai-batch-operations.js';
import { reconcileStudentMemoryOpenAiBatchRun } from '../application/student-memory-openai-batch-run-reconcile.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import {
  getStudentMemoryOpenAiBatchRunById,
  hasStudentMemoryOpenAiBatchRetryChild,
  listStudentMemoryOpenAiBatchItems,
  updateStudentMemoryOpenAiBatchRunRemoteStatus,
} from '../domain/student-memory-openai-batch-repository.js';

type Action = 'dry-run' | 'submit' | 'status' | 'poll' | 'reconcile' | 'retry' | 'cancel';
interface Options {
  action: Action;
  workload?: StudentMemoryBatchWorkload;
  model?: string;
  ids: string[];
  runId?: string;
  apply: boolean;
}

function parse(argv: string[]): Options {
  const [action] = argv;
  if (
    !['dry-run', 'submit', 'status', 'poll', 'reconcile', 'retry', 'cancel'].includes(action ?? '')
  )
    throw new Error(
      'First argument must be dry-run, submit, status, poll, reconcile, retry, or cancel',
    );
  const options: Options = { action: action as Action, ids: [], apply: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--workload') {
      options.workload = requireWorkload(argv[++i]);
      continue;
    }
    if (arg === '--model') {
      options.model = requireValue(argv[++i], '--model');
      continue;
    }
    if (arg === '--id') {
      options.ids.push(requireValue(argv[++i], '--id'));
      continue;
    }
    if (arg === '--run-id') {
      options.runId = requireValue(argv[++i], '--run-id');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function candidates(options: Options) {
  if (!options.workload || !options.model) throw new Error('--workload and --model are required');
  if (options.workload === 'lesson_memory')
    return buildLessonMemoryBatchCandidates({ transcriptIds: options.ids, model: options.model });
  if (options.workload === 'homework_memory')
    return buildHomeworkMemoryBatchCandidates({ jobIds: options.ids, model: options.model });
  return buildStudentMemorySnapshotBatchCandidates({
    studentIds: options.ids,
    model: options.model,
  });
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-student-memory-openai-batch');
  const options = parse(process.argv.slice(2));
  const config = loadConfig();
  if (!config.pg.enabled) throw new Error('PG_ENABLED=true is required');

  if (options.action === 'dry-run' || options.action === 'submit') {
    if (options.action === 'submit') {
      if (!options.apply) throw new Error('submit requires --apply; no Batch run was persisted');
      assertStudentMemoryOpenAiBatchAccess({
        config,
        model: options.model ?? '',
        action: 'submit',
      });
    }
    const planned = await candidates(options);
    const plan = await createStudentMemoryOpenAiBatchPlan({
      workload: options.workload!,
      model: options.model!,
      items: planned,
      persist: options.action === 'submit' && options.apply,
    });
    console.log(JSON.stringify(plan.summary));
    if (options.action === 'dry-run') return;
    const submitted = await submitStudentMemoryOpenAiBatchPlan({
      config,
      model: options.model!,
      runId: plan.runId!,
      jsonl: plan.jsonl,
    });
    console.log(JSON.stringify({ runId: plan.runId, ...submitted }));
    return;
  }

  if (!options.runId) throw new Error('--run-id is required');
  const batchRun = await getStudentMemoryOpenAiBatchRunById(options.runId);
  if (!batchRun?.remoteBatchId) throw new Error('Batch run is missing a remote Batch id');
  const transport = createStudentMemoryOpenAiBatchTransport();
  if (options.action === 'cancel') {
    if (!options.apply) throw new Error('cancel requires --apply');
    const remote = await transport.cancelBatch({
      config,
      model: batchRun.model,
      batchId: batchRun.remoteBatchId,
    });
    await updateStudentMemoryOpenAiBatchRunRemoteStatus({
      runId: batchRun.id,
      state: 'cancelled',
      remoteOutputFileId: remote.output_file_id ?? null,
      remoteErrorFileId: remote.error_file_id ?? null,
      requestCounts: remote.request_counts,
      remoteError: safeRemoteError(remote.errors),
    });
    console.log(JSON.stringify({ runId: batchRun.id, state: 'cancelled' }));
    return;
  }
  const remote = await transport.getBatch({
    config,
    model: batchRun.model,
    batchId: batchRun.remoteBatchId,
  });
  const state = mapRemoteState(remote.status);
  await updateStudentMemoryOpenAiBatchRunRemoteStatus({
    runId: batchRun.id,
    state,
    remoteOutputFileId: remote.output_file_id ?? null,
    remoteErrorFileId: remote.error_file_id ?? null,
    requestCounts: remote.request_counts,
    remoteError: safeRemoteError(remote.errors),
  });
  if (options.action === 'status' || options.action === 'poll') {
    console.log(
      JSON.stringify({ runId: batchRun.id, state, requestCounts: remote.request_counts ?? null }),
    );
    return;
  }
  if (options.action === 'reconcile') {
    if (state !== 'completed' && state !== 'expired')
      throw new Error(`Batch is not terminal for reconciliation: ${state}`);
    const outputJsonl = remote.output_file_id
      ? await transport.downloadFile({
          config,
          model: batchRun.model,
          fileId: remote.output_file_id,
        })
      : '';
    const errorJsonl = remote.error_file_id
      ? await transport.downloadFile({
          config,
          model: batchRun.model,
          fileId: remote.error_file_id,
        })
      : '';
    console.log(
      JSON.stringify(
        await reconcileStudentMemoryOpenAiBatchRun({
          config,
          runId: batchRun.id,
          runStatus: state,
          outputJsonl,
          errorJsonl,
        }),
      ),
    );
    return;
  }
  if (!options.apply) throw new Error('retry requires --apply');
  if (batchRun.state !== 'reconciled') {
    throw new Error('retry requires a fully reconciled Batch run');
  }
  assertStudentMemoryOpenAiBatchAccess({ config, model: batchRun.model, action: 'retry' });
  const retryableItems = (await listStudentMemoryOpenAiBatchItems({ runId: batchRun.id })).filter(
    (item) => item.state === 'retryable_failure',
  );
  const retryItems = (
    await Promise.all(
      retryableItems.map(async (item) =>
        (await hasStudentMemoryOpenAiBatchRetryChild(item.id)) ? null : item,
      ),
    )
  ).filter((item): item is (typeof retryableItems)[number] => item !== null);
  if (retryItems.length === 0) throw new Error('No retryable Batch items are available');
  const plan = await createStudentMemoryOpenAiBatchPlan({
    workload: batchRun.workload,
    model: batchRun.model,
    persist: true,
    parentRetryRunId: batchRun.id,
    items: retryItems.map((item) => ({
      retryOfItemId: item.id,
      studentId: item.studentId,
      customId: `${item.customId}:retry:${batchRun.id}`,
      model: item.model,
      body: item.requestBody,
      canonicalScopeKey: item.canonicalScopeKey,
      sourceVersionHash: item.sourceVersionHash,
      requestEnvelope: item.requestEnvelope as never,
      responseSchemaFingerprint: item.responseSchemaFingerprint,
      sourceRefs: item.sourceRefs,
    })),
  });
  console.log(JSON.stringify({ ...plan.summary, runId: plan.runId, parentRunId: batchRun.id }));
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`Missing value for ${flag}`);
  return value.trim();
}
function requireWorkload(value: string | undefined): StudentMemoryBatchWorkload {
  if (
    value === 'lesson_memory' ||
    value === 'homework_memory' ||
    value === 'student_memory_snapshot'
  )
    return value;
  throw new Error('Invalid --workload');
}
function mapRemoteState(
  value: string | undefined,
): 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'expired' | 'cancelled' {
  if (
    value === 'in_progress' ||
    value === 'finalizing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'expired' ||
    value === 'cancelled'
  )
    return value;
  return 'in_progress';
}
function safeRemoteError(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? { present: true } : undefined;
}

void run().catch((error) => {
  console.error(
    `[student-memory:batch] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
