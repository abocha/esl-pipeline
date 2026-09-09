import { listTranscriptionRunsRequiringDelivery } from '../domain/transcription-run-repository.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';

export async function reconcileTranscriptionDelivery(params?: {
  runs?: { listRequiringDelivery: typeof listTranscriptionRunsRequiringDelivery };
  queue?: Pick<ReturnType<typeof createTranscribeQueue>, 'ensureDelivery'>;
  limit?: number;
}): Promise<number> {
  const runs = params?.runs ?? { listRequiringDelivery: listTranscriptionRunsRequiringDelivery };
  const queue = params?.queue ?? createTranscribeQueue();
  const candidates = await runs.listRequiringDelivery(params?.limit ?? 100);
  for (const run of candidates) {
    await queue.ensureDelivery({ runId: run.id, recordingId: run.recordingId });
  }
  return candidates.length;
}
