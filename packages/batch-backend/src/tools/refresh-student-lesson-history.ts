import type { PoolClient } from 'pg';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import {
  buildHeuristicTranscriptAnalysis,
  extractStudentOnlyTranscript,
  mergeTranscriptAnalysis,
  resolveStudentTrackTranscriptUri,
  type TranscriptAnalysisSnapshot,
} from '../application/student-lesson-history.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import {
  executeGoogleGeneration,
  executeOpenAiGeneration,
  executeOpenRouterGeneration,
} from '../application/generation-providers.js';
import {
  createTranscriptionStorageForUri,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';
import { withPgClient } from '../infrastructure/db.js';

interface TranscriptRow {
  id: string;
  student_id: string;
  storage_uri: string;
  summary_json: Record<string, unknown> | null;
}

interface CliOptions {
  limit: number;
  batchSize: number;
  provider?: GenerationProvider;
  model?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 80,
    batchSize: 8,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --limit');
      options.limit = Math.max(1, Number.parseInt(value, 10) || 80);
      index += 1;
      continue;
    }
    if (arg === '--batch-size') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --batch-size');
      options.batchSize = Math.max(1, Math.min(20, Number.parseInt(value, 10) || 8));
      index += 1;
      continue;
    }
    if (arg === '--provider') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --provider');
      const normalized = value.trim().toLowerCase();
      if (normalized !== 'openai' && normalized !== 'google_ai_studio' && normalized !== 'openrouter') {
        throw new Error('Invalid --provider. Use openai, google_ai_studio, or openrouter');
      }
      options.provider = normalized;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --model');
      options.model = value.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function listTranscriptsNeedingAnalysis(limit: number): Promise<TranscriptRow[]> {
  return withPgClient(async (client: PoolClient) => {
    const result = await client.query<TranscriptRow>(
      `
      SELECT
        t.id,
        r.student_id,
        t.storage_uri,
        t.summary_json
      FROM transcripts t
      INNER JOIN recordings r ON r.id = t.recording_id
      WHERE r.student_id IS NOT NULL
        AND (t.summary_json IS NULL OR NOT (t.summary_json ? 'analysis'))
      ORDER BY t.created_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return result.rows;
  });
}

async function updateTranscriptSummary(
  transcriptId: string,
  summaryJson: Record<string, unknown>,
): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE transcripts
      SET summary_json = $2::jsonb,
          updated_at = now()
      WHERE id = $1
      `,
      [transcriptId, JSON.stringify(summaryJson)],
    );
  });
}

function resolveModel(config: BatchBackendConfig, provider: GenerationProvider): string {
  if (provider === 'openai') {
    return config.generation.models.openai.primary;
  }
  if (provider === 'google_ai_studio') {
    return config.generation.models.googleAiStudio.primary;
  }
  return (
    config.generation.models.openrouter.primary ??
    config.generation.models.openrouter.fallback ??
    config.generation.models.openrouter.allowed[0] ??
    'openai/gpt-4o-mini'
  );
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const direct = text.trim();
  if (!direct) return null;
  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    // noop
  }

  const start = direct.indexOf('{');
  const end = direct.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(direct.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toAnalysisMap(payload: unknown): Map<string, TranscriptAnalysisSnapshot> {
  const results = new Map<string, TranscriptAnalysisSnapshot>();
  if (!payload || typeof payload !== 'object') return results;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return results;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const cast = item as Record<string, unknown>;
    const transcriptId =
      typeof cast.transcriptId === 'string' && cast.transcriptId.trim().length > 0
        ? cast.transcriptId
        : null;
    if (!transcriptId) continue;

    const vocabularyFocus = Array.isArray(cast.vocabularyFocus)
      ? cast.vocabularyFocus.filter((value): value is string => typeof value === 'string')
      : [];
    const grammarWatchlist = Array.isArray(cast.grammarWatchlist)
      ? cast.grammarWatchlist.filter((value): value is string => typeof value === 'string')
      : [];
    const lessonSummary =
      typeof cast.lessonSummary === 'string' ? cast.lessonSummary.trim() : '';
    const provider = typeof cast.provider === 'string' ? cast.provider.trim() : 'batch_llm';
    const model = typeof cast.model === 'string' && cast.model.trim() ? cast.model.trim() : null;

    results.set(transcriptId, {
      version: 1,
      generatedAt: new Date().toISOString(),
      provider: provider || 'batch_llm',
      model,
      lessonSummary,
      vocabularyFocus,
      grammarWatchlist,
      source: 'batch_llm',
    });
  }

  return results;
}

async function runBatchAnalysis(args: {
  config: BatchBackendConfig;
  provider: GenerationProvider;
  model: string;
  batch: {
    transcriptId: string;
    studentId: string;
    text: string;
  }[];
}): Promise<Map<string, TranscriptAnalysisSnapshot>> {
  const prompt = [
    'You analyze ESL student transcripts.',
    'Return ONLY JSON with this exact schema:',
    '{"items":[{"transcriptId":"string","lessonSummary":"string","vocabularyFocus":["string"],"grammarWatchlist":["string"],"provider":"string","model":"string|null"}]}',
    'Rules:',
    '- lessonSummary: one short sentence focused on student progress/problems.',
    '- vocabularyFocus: up to 8 words or short phrases the student used repeatedly or struggled with.',
    '- grammarWatchlist: up to 6 concise grammar issues.',
    '- Do not include markdown fences.',
    '',
    'Input transcripts:',
    JSON.stringify(
      args.batch.map((item) => ({
        transcriptId: item.transcriptId,
        studentId: item.studentId,
        text: item.text.slice(0, 2500),
      })),
      null,
      2,
    ),
  ].join('\n');

  const request = {
    model: args.model,
    prompt,
    maxOutputTokens: 1500,
    stream: false,
  };

  const result =
    args.provider === 'openai'
      ? await executeOpenAiGeneration({ config: args.config.generation, request })
      : args.provider === 'google_ai_studio'
        ? await executeGoogleGeneration({ config: args.config.generation, request })
        : await executeOpenRouterGeneration({ config: args.config.generation, request });

  const parsed = extractJsonObject(result.text);
  return toAnalysisMap(parsed);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-refresh-lesson-history');
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('PG_ENABLED=true is required');
  }

  const provider = options.provider ?? config.generation.defaultProvider;
  const model = options.model ?? resolveModel(config, provider);
  const rows = await listTranscriptsNeedingAnalysis(options.limit);

  if (rows.length === 0) {
    console.log('[lesson-history] no transcripts need analysis');
    return;
  }

  const prepared: {
    row: TranscriptRow;
    studentText: string;
  }[] = [];
  for (const row of rows) {
    try {
      const studentTrackUri = resolveStudentTrackTranscriptUri(row.summary_json);

      let text = '';
      if (studentTrackUri) {
        try {
          const studentTrackStorage: TranscriptionStorage =
            createTranscriptionStorageForUri(studentTrackUri);
          text = await studentTrackStorage.getText(studentTrackUri);
        } catch {
          text = '';
        }
      }

      if (!text.trim()) {
        const storage: TranscriptionStorage = createTranscriptionStorageForUri(row.storage_uri);
        text = await storage.getText(row.storage_uri);
      }

      const studentOnly = extractStudentOnlyTranscript(text);
      prepared.push({
        row,
        studentText: studentOnly.trim().length > 0 ? studentOnly : text,
      });
    } catch {
      prepared.push({
        row,
        studentText: '',
      });
    }
  }

  let updated = 0;
  let llmGenerated = 0;
  let heuristicGenerated = 0;

  for (const batchRows of chunk(prepared, options.batchSize)) {
    const batchInput = batchRows.map((item) => ({
      transcriptId: item.row.id,
      studentId: item.row.student_id,
      text: item.studentText,
    }));

    let llmMap = new Map<string, TranscriptAnalysisSnapshot>();
    try {
      llmMap = await runBatchAnalysis({
        config,
        provider,
        model,
        batch: batchInput,
      });
    } catch {
      llmMap = new Map<string, TranscriptAnalysisSnapshot>();
    }

    for (const item of batchRows) {
      const llmAnalysis = llmMap.get(item.row.id);
      const analysis =
        llmAnalysis ??
        buildHeuristicTranscriptAnalysis({
          text: item.studentText,
          provider: 'heuristic',
          model: null,
        });

      if (analysis.source === 'batch_llm') {
        llmGenerated += 1;
      } else {
        heuristicGenerated += 1;
      }

      const merged = mergeTranscriptAnalysis(item.row.summary_json, analysis);
      if (!options.dryRun) {
        await updateTranscriptSummary(item.row.id, merged);
      }
      updated += 1;
    }
  }

  console.log(`[lesson-history] provider=${provider} model=${model}`);
  console.log(`[lesson-history] processed=${rows.length} updated=${updated}`);
  console.log(`[lesson-history] llm=${llmGenerated} heuristic=${heuristicGenerated}`);
  console.log(`[lesson-history] dryRun=${options.dryRun}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lesson-history] failed: ${message}`);
  process.exitCode = 1;
});
