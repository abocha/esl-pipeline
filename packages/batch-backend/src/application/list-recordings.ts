import { RecordingSourceSchema, RecordingStatusSchema } from '../domain/recording-model.js';
import {
  countRecordings,
  listRecordings,
  type RecordingListOptions,
} from '../domain/recording-repository.js';
import { listLatestTranscriptionRunsForRecordings } from '../domain/transcription-run-repository.js';
import { type RecordingDto, recordingToDto } from './recording-dto.js';

export interface ListRecordingsParams {
  workspaceId: string;
  statuses?: string[] | null;
  sources?: string[] | null;
  search?: string | null;
  studentId?: string | null;
  limit?: number;
  offset?: number;
  order?: RecordingListOptions['order'];
}

export interface RecordingsListResponse {
  items: RecordingDto[];
  limit: number;
  offset: number;
  total: number;
  order: RecordingListOptions['order'];
}

export interface ListRecordingsDependencies {
  recordings: {
    list: typeof listRecordings;
    count: typeof countRecordings;
  };
  transcriptionRuns: {
    listLatestForRecordings: typeof listLatestTranscriptionRunsForRecordings;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listRecordingsWithDefaults(
  params: ListRecordingsParams,
  overrides?: Partial<ListRecordingsDependencies>,
): Promise<RecordingsListResponse> {
  const recordings = overrides?.recordings ?? {
    list: listRecordings,
    count: countRecordings,
  };
  const transcriptionRuns = overrides?.transcriptionRuns ?? {
    listLatestForRecordings: listLatestTranscriptionRunsForRecordings,
  };

  const limit = clampNumber(params.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(0, params.offset ?? 0);
  const order = params.order === 'asc' ? 'asc' : 'desc';
  const studentId = params.studentId ?? null;
  const statuses =
    params.statuses && params.statuses.length > 0
      ? params.statuses.map((status) => RecordingStatusSchema.parse(status))
      : undefined;
  const sources =
    params.sources && params.sources.length > 0
      ? params.sources.map((source) => RecordingSourceSchema.parse(source))
      : undefined;
  const search = params.search?.trim() || undefined;

  const [items, total] = await Promise.all([
    recordings.list({
      workspaceId: params.workspaceId,
      statuses,
      sources,
      search,
      studentId,
      limit,
      offset,
      order,
    }),
    recordings.count(params.workspaceId, statuses, studentId, sources, search),
  ]);
  const runs = await transcriptionRuns.listLatestForRecordings(
    items.map((item) => item.id),
    params.workspaceId,
  );
  const runByRecordingId = new Map(runs.map((run) => [run.recordingId, run] as const));

  return {
    items: items.map((item) => recordingToDto(item, runByRecordingId.get(item.id) ?? null)),
    limit,
    offset,
    total,
    order,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
