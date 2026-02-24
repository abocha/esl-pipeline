import { withPgClient } from '../infrastructure/db.js';
import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';

const LESSON_ANALYSIS_VERSION = 1;

interface StudentLessonRow {
  id: string;
  summary_json: Record<string, unknown> | null;
  created_at: Date;
}

export interface TranscriptAnalysisSnapshot {
  version: number;
  generatedAt: string;
  provider: string;
  model: string | null;
  lessonSummary: string;
  vocabularyFocus: string[];
  grammarWatchlist: string[];
  source: 'batch_llm' | 'heuristic';
}

interface SpeakerTrackTranscriptRef {
  speaker: number;
  label: string;
  uri: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeTranscriptAnalysis(value: unknown): TranscriptAnalysisSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const cast = value as Record<string, unknown>;

  const generatedAt =
    typeof cast.generatedAt === 'string' && cast.generatedAt.trim().length > 0
      ? cast.generatedAt
      : null;
  const provider =
    typeof cast.provider === 'string' && cast.provider.trim().length > 0
      ? cast.provider
      : null;
  const lessonSummary =
    typeof cast.lessonSummary === 'string' && cast.lessonSummary.trim().length > 0
      ? cast.lessonSummary.trim()
      : '';
  const source = cast.source === 'batch_llm' || cast.source === 'heuristic' ? cast.source : null;
  if (!generatedAt || !provider || !source) return null;

  return {
    version:
      typeof cast.version === 'number' && Number.isFinite(cast.version)
        ? cast.version
        : LESSON_ANALYSIS_VERSION,
    generatedAt,
    provider,
    model: typeof cast.model === 'string' && cast.model.trim().length > 0 ? cast.model : null,
    lessonSummary,
    vocabularyFocus: asStringArray(cast.vocabularyFocus),
    grammarWatchlist: asStringArray(cast.grammarWatchlist),
    source,
  };
}

export function mergeTranscriptAnalysis(
  summaryJson: Record<string, unknown> | null | undefined,
  analysis: TranscriptAnalysisSnapshot,
): Record<string, unknown> {
  const summary = summaryJson ? { ...summaryJson } : {};
  return {
    ...summary,
    analysis: {
      version: analysis.version,
      generatedAt: analysis.generatedAt,
      provider: analysis.provider,
      model: analysis.model,
      lessonSummary: analysis.lessonSummary,
      vocabularyFocus: analysis.vocabularyFocus,
      grammarWatchlist: analysis.grammarWatchlist,
      source: analysis.source,
    },
  };
}

export function extractStudentOnlyTranscript(transcript: string): string {
  const lines = transcript.split(/\r?\n/);
  const studentLines: string[] = [];
  let inStudentBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inStudentBlock && studentLines.at(-1) !== '') {
        studentLines.push('');
      }
      continue;
    }

    const timelineMatch = /^\[Student [^\]]+\]\s*(.*)$/i.exec(trimmed);
    if (timelineMatch) {
      const text = timelineMatch[1]?.trim() ?? '';
      if (text) studentLines.push(text);
      inStudentBlock = false;
      continue;
    }

    const stackHeaderMatch = /^(Teacher|Student|Speaker\s+\d+):\s*(.*)$/i.exec(trimmed);
    if (stackHeaderMatch) {
      const speaker = (stackHeaderMatch[1] ?? '').toLowerCase();
      const text = (stackHeaderMatch[2] ?? '').trim();
      if (speaker === 'student') {
        inStudentBlock = true;
        if (text) studentLines.push(text);
      } else {
        inStudentBlock = false;
      }
      continue;
    }

    if (inStudentBlock) {
      studentLines.push(trimmed);
    }
  }

  return studentLines.join('\n').replaceAll(/\n{3,}/g, '\n\n').trim();
}

export function resolveStudentTrackTranscriptUri(
  summaryJson: Record<string, unknown> | null | undefined,
): string | null {
  if (!summaryJson || typeof summaryJson !== 'object') return null;

  const speakerTracks = (summaryJson as { speakerTracks?: unknown }).speakerTracks;
  if (!speakerTracks || typeof speakerTracks !== 'object') return null;
  const rawTranscripts = (speakerTracks as { transcripts?: unknown }).transcripts;
  if (!Array.isArray(rawTranscripts)) return null;

  const transcripts: SpeakerTrackTranscriptRef[] = rawTranscripts
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const cast = item as Record<string, unknown>;
      const uri = typeof cast.uri === 'string' && cast.uri.trim().length > 0 ? cast.uri : null;
      if (!uri) return null;
      const speaker = typeof cast.speaker === 'number' ? cast.speaker : Number.NaN;
      const label = typeof cast.label === 'string' ? cast.label.trim() : '';
      return {
        speaker: Number.isFinite(speaker) ? speaker : 0,
        label,
        uri,
      };
    })
    .filter((item): item is SpeakerTrackTranscriptRef => item !== null);

  if (transcripts.length === 0) return null;

  const labeledStudent = transcripts.find((item) => /\bstudent\b/i.test(item.label));
  if (labeledStudent) return labeledStudent.uri;

  const speakerOne = transcripts.find((item) => item.speaker === 1);
  if (speakerOne) return speakerOne.uri;

  return null;
}

export function extractVocabularyFocus(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[a-z']{4,}/g) ?? [];
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    if (COMMON_WORDS.has(token)) continue;
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([token]) => token);
}

export function extractGrammarWatchlist(text: string): string[] {
  const normalized = text.toLowerCase();
  const watchlist: string[] = [];
  if (/\bi am agree\b/.test(normalized)) watchlist.push('Possible misuse: "I am agree"');
  if (/\bhe go\b/.test(normalized) || /\bshe go\b/.test(normalized)) {
    watchlist.push('Third-person present tense agreement ("he/she goes")');
  }
  if (/\bmore better\b/.test(normalized)) watchlist.push('Double comparative ("better", not "more better")');
  if (/\bi very like\b/.test(normalized)) watchlist.push('Adverb placement ("I like ... very much")');
  return watchlist;
}

export function buildHeuristicTranscriptAnalysis(params: {
  text: string;
  generatedAt?: Date;
  provider?: string;
  model?: string | null;
}): TranscriptAnalysisSnapshot {
  const generatedAt = (params.generatedAt ?? new Date()).toISOString();
  const normalized = params.text.replaceAll(/\s+/g, ' ').trim();
  const summary =
    normalized.length > 0
      ? `${normalized.slice(0, 180)}${normalized.length > 180 ? '…' : ''}`
      : 'No clear student-only speech detected.';

  return {
    version: LESSON_ANALYSIS_VERSION,
    generatedAt,
    provider: params.provider ?? 'heuristic',
    model: params.model ?? null,
    lessonSummary: summary,
    vocabularyFocus: extractVocabularyFocus(normalized),
    grammarWatchlist: extractGrammarWatchlist(normalized),
    source: 'heuristic',
  };
}

export async function buildStudentLessonHistoryContext(params: {
  studentId: string | null;
  currentTranscriptId: string;
  maxLessons?: number;
  config?: BatchBackendConfig;
}): Promise<string | null> {
  if (!params.studentId) return null;
  const config = params.config ?? loadConfig();
  const pgEnabled = Boolean((config as { pg?: { enabled?: boolean } }).pg?.enabled);
  if (!pgEnabled) return null;

  const rows = await withPgClient(async (client) => {
    const result = await client.query<StudentLessonRow>(
      `
      SELECT
        t.id,
        t.summary_json,
        t.created_at
      FROM transcripts t
      INNER JOIN recordings r ON r.id = t.recording_id
      WHERE r.student_id = $1
        AND t.id <> $2
      ORDER BY t.created_at DESC
      LIMIT $3
      `,
      [params.studentId, params.currentTranscriptId, params.maxLessons ?? 6],
    );
    return result.rows;
  }).catch(() => [] as StudentLessonRow[]);

  if (rows.length === 0) return null;

  const lessonLines: string[] = [];
  const vocabFrequency = new Map<string, number>();
  const grammarFrequency = new Map<string, number>();

  for (const row of rows) {
    const summaryJson = row.summary_json;
    const analysis = normalizeTranscriptAnalysis(
      summaryJson && typeof summaryJson === 'object'
        ? (summaryJson as Record<string, unknown>).analysis
        : null,
    );

    const summary =
      analysis?.lessonSummary && analysis.lessonSummary.trim().length > 0
        ? analysis.lessonSummary.trim()
        : 'Transcript available (analysis pending).';
    lessonLines.push(`- ${row.created_at.toISOString()}: ${summary}`);

    for (const token of analysis?.vocabularyFocus ?? []) {
      const normalized = token.toLowerCase();
      vocabFrequency.set(normalized, (vocabFrequency.get(normalized) ?? 0) + 1);
    }
    for (const item of analysis?.grammarWatchlist ?? []) {
      grammarFrequency.set(item, (grammarFrequency.get(item) ?? 0) + 1);
    }
  }

  const vocabularyFocus = [...vocabFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([token]) => token);
  const grammarWatchlist = [...grammarFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([item]) => item);

  const parts = ['Recent lessons:', ...lessonLines];
  if (vocabularyFocus.length > 0) {
    parts.push('', `Vocabulary focus candidates: ${vocabularyFocus.join(', ')}`);
  }
  if (grammarWatchlist.length > 0) {
    parts.push('', 'Grammar watchlist:', ...grammarWatchlist.map((item) => `- ${item}`));
  }

  return parts.join('\n');
}

const COMMON_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'could',
  'from',
  'have',
  'just',
  'like',
  'really',
  'should',
  'some',
  'that',
  'their',
  'there',
  'they',
  'this',
  'very',
  'want',
  'were',
  'what',
  'when',
  'with',
  'would',
]);
