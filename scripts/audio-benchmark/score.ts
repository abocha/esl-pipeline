import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkEnvironment } from './env';
import { getBenchmarkRoot, resolveUnderBenchmarkRoot, sha256File, sha256Text } from './manifest';
import { calculateRunCost, type PriceSnapshot, publicPriceSnapshot } from './report';
import type { BenchmarkRun, NativeSegment, ProviderId } from './schema';

export type TokenAlignment = {
  substitutions: number;
  deletions: number;
  insertions: number;
  totalEdits: number;
  referenceLength: number;
  hypothesisLength: number;
  operations?: Array<'match' | 'substitution' | 'deletion' | 'insertion'>;
};

export type SpeakerMappingInput = {
  labels: string[];
  windows: Array<{
    referenceTutorTokens: string[];
    referenceStudentTokens: string[];
    providerItems: Array<{ label: string; tokens: string[] }>;
  }>;
};

export type SpeakerMappingResult = {
  mapping: Record<string, 'tutor' | 'student'>;
  bestObjective: number;
  secondBestObjective: number | null;
  margin: number | null;
  labels: string[];
};

export type BlindLabelMapping = {
  seed: string;
  algorithm: string;
  providerToBlindLabel: Record<string, string>;
  blindLabelToProvider: Record<string, string>;
};

const WINDOW_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const EXPECTED_REFERENCE_HASHES = {
  annotations: 'daced1695a42ff1dc0e3ab8006426e04ed79f61b19674594a299aade59e14cac',
  views: '6d7fa498e416e04b73c0626319c4dd28419eb5aae30b5f6ef8d92823e718252b',
  windows: 'be8e0b08918996f79094437fa99f56f2779b5d4c1513206e5d86ee6441e28744',
} as const;

const RUN_SPECS = [
  {
    runId: 'soniox-standard-lesson-full-001',
    key: 'soniox-v5-async:mixed_diarized',
    providerId: 'soniox-v5-async' as const,
    mode: 'mixed_diarized' as const,
    displayName: 'Soniox v5 Async — mixed diarized',
    simpleUploadCandidate: true,
  },
  {
    runId: 'elevenlabs-standard-lesson-full-001',
    key: 'elevenlabs-scribe-v2:mixed_diarized',
    providerId: 'elevenlabs-scribe-v2' as const,
    mode: 'mixed_diarized' as const,
    displayName: 'ElevenLabs Scribe v2 — mixed diarized (num_speakers=2)',
    simpleUploadCandidate: true,
  },
  {
    runId: 'speechmatics-standard-lesson-full-001',
    key: 'speechmatics-melia-1-batch:mixed_diarized',
    providerId: 'speechmatics-melia-1-batch' as const,
    mode: 'mixed_diarized' as const,
    displayName: 'Speechmatics Melia 1 — mixed diarized',
    simpleUploadCandidate: true,
  },
  {
    runId: 'mistral-standard-lesson-full-001',
    key: 'mistral-voxtral-mini-transcribe-2:mixed_diarized',
    providerId: 'mistral-voxtral-mini-transcribe-2' as const,
    mode: 'mixed_diarized' as const,
    displayName: 'Mistral Voxtral Mini Transcribe 2 — mixed diarized',
    simpleUploadCandidate: true,
  },
  {
    runId: 'deepgram-standard-lesson-mixed-001',
    key: 'deepgram-nova-3:mixed_diarized',
    providerId: 'deepgram-nova-3' as const,
    mode: 'mixed_diarized' as const,
    displayName: 'Deepgram Nova-3 — mixed diarized',
    simpleUploadCandidate: true,
  },
  {
    runId: 'deepgram-standard-lesson-split-001',
    key: 'deepgram-nova-3:trusted_split_control',
    providerId: 'deepgram-nova-3' as const,
    mode: 'trusted_split_control' as const,
    displayName: 'Deepgram Nova-3 — trusted split control',
    simpleUploadCandidate: false,
  },
] as const;

/**
 * Scoring-only normalization. ECMAScript's Unicode-aware lowercasing is used
 * after NFKC; punctuation and symbols become token separators, not deletions
 * that can join adjacent lexical material.
 */
export function normalizeScoringText(text: string): string[] {
  const normalized = text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032]/gu, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized ? normalized.split(' ') : [];
}

export function alignTokenStreams(reference: string[], hypothesis: string[]): TokenAlignment {
  return alignSequences(reference, hypothesis, (left, right) => left === right);
}

export function chooseGlobalSpeakerMapping(input: SpeakerMappingInput): SpeakerMappingResult {
  const labels = [...new Set(input.labels)].sort(compareStrings);
  if (!labels.length) {
    return { mapping: {}, bestObjective: 0, secondBestObjective: null, margin: null, labels };
  }

  const candidates: Array<{
    mapping: Record<string, 'tutor' | 'student'>;
    objective: number;
    key: string;
  }> = [];
  for (let mask = 0; mask < 2 ** labels.length; mask += 1) {
    const mapping: Record<string, 'tutor' | 'student'> = {};
    labels.forEach((label, index) => {
      mapping[label] = mask & (1 << index) ? 'student' : 'tutor';
    });
    const objective = input.windows.reduce((sum, window) => {
      const tutor = window.providerItems
        .filter((item) => mapping[item.label] === 'tutor')
        .flatMap((item) => item.tokens);
      const student = window.providerItems
        .filter((item) => mapping[item.label] === 'student')
        .flatMap((item) => item.tokens);
      return (
        sum +
        editDistance(window.referenceTutorTokens, tutor) +
        editDistance(window.referenceStudentTokens, student)
      );
    }, 0);
    candidates.push({
      mapping,
      objective,
      key: labels.map((label) => (mapping[label] === 'tutor' ? '0' : '1')).join(''),
    });
  }
  candidates.sort(
    (left, right) => left.objective - right.objective || compareStrings(left.key, right.key),
  );
  const best = candidates[0]!;
  const second = candidates[1];
  return {
    mapping: best.mapping,
    bestObjective: best.objective,
    secondBestObjective: second?.objective ?? null,
    margin: second ? second.objective - best.objective : null,
    labels,
  };
}

export function createBlindLabelMapping(
  configurationKeys: string[],
  seed: string,
): BlindLabelMapping {
  const configurations = [...new Set(configurationKeys)].sort((left, right) => {
    const leftHash = createHash('sha256').update(`${seed}:${left}`, 'utf8').digest('hex');
    const rightHash = createHash('sha256').update(`${seed}:${right}`, 'utf8').digest('hex');
    return compareStrings(leftHash, rightHash) || compareStrings(left, right);
  });
  const providerToBlindLabel: Record<string, string> = {};
  const blindLabelToProvider: Record<string, string> = {};
  configurations.forEach((providerId, index) => {
    const label = `P${index + 1}`;
    providerToBlindLabel[providerId] = label;
    blindLabelToProvider[label] = providerId;
  });
  return {
    seed,
    algorithm:
      'SHA-256(seed + ":" + provider-id), ascending hexadecimal digest, then provider-id tie-break',
    providerToBlindLabel,
    blindLabelToProvider,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: Dynamic JSON evidence is intentionally kept structurally open at this private boundary.
type JsonRecord = Record<string, any>;
type ReferenceWindow = {
  windowId: string;
  startMs: number;
  endMs: number;
  chronologicalText: string;
  tutorText: string;
  studentText: string;
};
type NativeReference = {
  index?: number;
  nativeIndex?: number;
  startMs?: number;
  endMs?: number;
  kind?: string;
  text: string;
  speakerKey?: string;
  nativeSpeakerLabel?: string;
  channelIndex?: number;
  language?: string;
  confidence?: number;
  logprob?: number;
  isAudioEvent?: boolean | null;
};
type ProviderWindow = {
  windowId: string;
  startMs: number;
  endMs: number;
  chronologicalText: string;
  nativeReferences: NativeReference[];
  speakerTexts?: Record<string, JsonRecord>;
  channelTexts?: Array<JsonRecord>;
};

export type BlindedReviewCandidate = {
  configurationKey: string;
  chronologicalText: string;
  studentText: string;
  tutorText: string;
};

export type BlindedReviewWindow = {
  windowId: string;
  startMs: number;
  endMs: number;
  reference: {
    chronologicalText: string;
    studentText: string;
    tutorText: string;
  };
  candidates: BlindedReviewCandidate[];
};

export function createBlindedReviewPackage(input: {
  campaignId: string;
  caseId: string;
  mapping: BlindLabelMapping;
  windows: BlindedReviewWindow[];
}): JsonRecord {
  return {
    schemaVersion: '1.0',
    kind: 'blinded_semantic_review_package',
    campaignId: input.campaignId,
    caseId: input.caseId,
    candidateLabels: Object.keys(input.mapping.blindLabelToProvider).sort(compareStrings),
    windows: input.windows.map((window) => ({
      windowId: window.windowId,
      startMs: window.startMs,
      endMs: window.endMs,
      reference: window.reference,
      candidates: window.candidates
        .map((candidate) => ({
          blindLabel: input.mapping.providerToBlindLabel[candidate.configurationKey],
          chronologicalText: candidate.chronologicalText,
          studentText: candidate.studentText,
          tutorText: candidate.tutorText,
        }))
        .sort((left, right) => compareStrings(String(left.blindLabel), String(right.blindLabel))),
    })),
  };
}

export function partitionComparisonProviders(providers: JsonRecord[]): {
  eligible: JsonRecord[];
  control: JsonRecord[];
} {
  const byStudentWer = (left: JsonRecord, right: JsonRecord): number => {
    const leftAggregate = left.aggregate as JsonRecord;
    const rightAggregate = right.aggregate as JsonRecord;
    const leftStudent = leftAggregate.student as JsonRecord;
    const rightStudent = rightAggregate.student as JsonRecord;
    return (
      Number(leftStudent.wer ?? Infinity) - Number(rightStudent.wer ?? Infinity) ||
      compareStrings(String(left.displayName), String(right.displayName))
    );
  };
  return {
    eligible: providers.filter((provider) => !provider.controlOnly).sort(byStudentWer),
    control: providers.filter((provider) => provider.controlOnly).sort(byStudentWer),
  };
}

export type FrozenWindowDefinition = {
  windowId: string;
  startMs: number;
  endMs: number;
};

export type ProviderWindowValidationInput = {
  view: JsonRecord;
  expectedCampaignId: string;
  expectedCaseId: string;
  expectedProviderId: ProviderId;
  expectedRunId: string;
  expectedRunMode: string;
  expectedFrozenWindowsPath: string;
  expectedNativeSegmentsPath: string;
  expectedRawResponsePath: string;
  frozenWindows: FrozenWindowDefinition[];
  frozenWindowsSha256: string;
  nativeArtifactSha256: string;
  native: { providerId: string; segments: NativeSegment[] };
};

export function validateAndCanonicalizeProviderWindowView(input: ProviderWindowValidationInput): {
  view: JsonRecord;
  windows: ProviderWindow[];
} {
  assertMetadata(input.view, 'campaignId', input.expectedCampaignId);
  assertMetadata(input.view, 'caseId', input.expectedCaseId);
  assertMetadata(input.view, 'providerId', input.expectedProviderId);
  assertMetadata(input.view, 'runId', input.expectedRunId);
  if (input.view.runMode !== undefined)
    assertMetadata(input.view, 'runMode', input.expectedRunMode);
  assertMetadata(input.view, 'sourceFrozenWindowsPath', input.expectedFrozenWindowsPath);
  assertMetadata(input.view, 'sourceNativeSegmentsPath', input.expectedNativeSegmentsPath);
  assertMetadata(input.view, 'sourceRawResponsePath', input.expectedRawResponsePath);
  if (input.native.providerId !== input.expectedProviderId) {
    throw new Error('Native evidence providerId does not match the expected provider.');
  }
  if (input.expectedRunMode === 'trusted_split_control') {
    assertTrustedSplitNativeLineage(input.native.segments);
  }
  if (
    input.view.sourceFrozenWindowsSha256 !== input.frozenWindowsSha256 ||
    typeof input.view.sourceFrozenWindowsSha256 !== 'string'
  ) {
    throw new Error('Provider view frozen-window hash does not match the actual frozen file.');
  }
  if (
    input.view.sourceNativeSegmentsSha256 !== undefined &&
    input.view.sourceNativeSegmentsSha256 !== input.nativeArtifactSha256
  ) {
    throw new Error('Provider view native-artifact hash does not match the current native file.');
  }

  assertExactWindows(input.frozenWindows, 'frozen evidence');
  if (!Array.isArray(input.view.windows)) {
    throw new Error('Provider view must contain exactly six windows.');
  }
  assertExactWindows(
    input.view.windows.map((window: JsonRecord) => ({
      windowId: String(window.windowId),
      startMs: Number(window.startMs),
      endMs: Number(window.endMs),
    })),
    'provider view',
  );

  const speakerKeys = new Map<string, string>();
  let nextSpeakerNumber = 1;
  const canonicalWindows = WINDOW_IDS.map((windowId) => {
    const frozenWindow = input.frozenWindows.find((candidate) => candidate.windowId === windowId)!;
    const sourceWindow = input.view.windows.find(
      (window: JsonRecord) => window.windowId === frozenWindow.windowId,
    )!;
    if (
      sourceWindow.startMs !== frozenWindow.startMs ||
      sourceWindow.endMs !== frozenWindow.endMs
    ) {
      throw new Error(
        `Provider view window bounds do not match frozen window ${frozenWindow.windowId}.`,
      );
    }
    if (!Array.isArray(sourceWindow.nativeReferences)) {
      throw new Error(`Provider view window ${frozenWindow.windowId} has no native references.`);
    }
    const referenceIndices = sourceWindow.nativeReferences.map((reference: NativeReference) => {
      const nativeIndex = reference.nativeIndex;
      const index = reference.index;
      if (
        (nativeIndex !== undefined && (!Number.isInteger(nativeIndex) || nativeIndex < 0)) ||
        (index !== undefined && (!Number.isInteger(index) || index < 0))
      ) {
        throw new Error(`Invalid native reference index in window ${frozenWindow.windowId}.`);
      }
      if (nativeIndex !== undefined && index !== undefined && nativeIndex !== index) {
        throw new Error(`Native reference index disagreement in window ${frozenWindow.windowId}.`);
      }
      const selectedIndex = nativeIndex ?? index;
      if (
        selectedIndex === undefined ||
        selectedIndex >= input.native.segments.length ||
        input.native.segments[selectedIndex]?.index !== selectedIndex
      ) {
        throw new Error(`Invalid native reference index in window ${frozenWindow.windowId}.`);
      }
      return selectedIndex;
    });
    if (new Set(referenceIndices).size !== referenceIndices.length) {
      throw new Error(`Duplicate native reference index in window ${frozenWindow.windowId}.`);
    }
    const expectedIndices = input.native.segments
      .filter(
        (segment) =>
          segment.startMs !== undefined &&
          segment.endMs !== undefined &&
          segment.startMs < frozenWindow.endMs &&
          segment.endMs > frozenWindow.startMs,
      )
      .map((segment) => segment.index)
      .sort((left, right) => left - right);
    const actualIndices = [...referenceIndices].sort((left, right) => left - right);
    if (JSON.stringify(expectedIndices) !== JSON.stringify(actualIndices)) {
      throw new Error(
        `Provider view native references do not match frozen window ${frozenWindow.windowId}.`,
      );
    }

    const canonicalReferences = referenceIndices
      .map((index: number) => {
        const native = input.native.segments[index]!;
        const sourceReference = sourceWindow.nativeReferences.find(
          (reference: NativeReference) => (reference.nativeIndex ?? reference.index) === index,
        )!;
        assertNativeReferenceMatches(native, sourceReference, frozenWindow.windowId);
        const identity = nativeIdentity(native);
        const speakerKey = identity
          ? getAnonymousSpeakerKey(identity, speakerKeys, () => nextSpeakerNumber++)
          : undefined;
        return nativeReferenceFromSegment(native, speakerKey);
      })
      .sort((left: NativeReference, right: NativeReference) => {
        const a = itemOrder(left, 0);
        const b = itemOrder(right, 0);
        return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      });
    return {
      windowId: frozenWindow.windowId,
      startMs: frozenWindow.startMs,
      endMs: frozenWindow.endMs,
      chronologicalText: providerText(input.expectedProviderId, canonicalReferences),
      nativeReferences: canonicalReferences,
    };
  });

  return {
    view: {
      ...input.view,
      runMode: input.expectedRunMode,
      sourceFrozenWindowsSha256: input.frozenWindowsSha256,
      sourceNativeSegmentsSha256: input.nativeArtifactSha256,
      windows: canonicalWindows,
    },
    windows: canonicalWindows,
  };
}

function assertTrustedSplitNativeLineage(segments: NativeSegment[]): void {
  for (const segment of segments) {
    if (segment.channelIndex !== 0 && segment.channelIndex !== 1) {
      throw new Error(
        'Trusted split control native evidence has missing or invalid channel lineage.',
      );
    }
    if (
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs) ||
      segment.startMs! >= segment.endMs!
    ) {
      throw new Error(
        'Trusted split control native evidence has a text item without valid timestamp lineage.',
      );
    }
  }
}

function assertMetadata(view: JsonRecord, key: string, expected: string): void {
  if (view[key] !== expected)
    throw new Error(`Provider view ${key} does not match expected evidence.`);
}

function assertExactWindows(windows: FrozenWindowDefinition[], label: string): void {
  if (windows.length !== WINDOW_IDS.length) {
    throw new Error(`${label} must contain exactly six windows.`);
  }
  const ids = windows.map((window) => window.windowId);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} window IDs must be unique.`);
  if (ids.some((windowId) => !WINDOW_IDS.includes(windowId as (typeof WINDOW_IDS)[number]))) {
    throw new Error(`${label} contains an unexpected window ID.`);
  }
  for (const windowId of WINDOW_IDS) {
    const window = windows.find((candidate) => candidate.windowId === windowId);
    if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) {
      throw new Error(`${label} is missing window ${windowId}.`);
    }
    if (window.startMs >= window.endMs) throw new Error(`${label} has invalid window bounds.`);
  }
}

function assertNativeReferenceMatches(
  native: NativeSegment,
  reference: NativeReference,
  windowId: string,
): void {
  if (
    reference.text !== native.text ||
    reference.kind !== native.kind ||
    reference.startMs !== native.startMs ||
    reference.endMs !== native.endMs ||
    reference.nativeSpeakerLabel !== native.speakerLabel ||
    reference.channelIndex !== native.channelIndex ||
    reference.language !== native.language
  ) {
    throw new Error(
      `Provider view native reference is not bound to native evidence in window ${windowId}.`,
    );
  }
}

function nativeIdentity(segment: NativeSegment): string | undefined {
  if (segment.channelIndex === undefined && segment.speakerLabel === undefined) return undefined;
  return `${segment.channelIndex ?? ''}\u0000${segment.speakerLabel ?? ''}`;
}

function getAnonymousSpeakerKey(
  identity: string,
  keys: Map<string, string>,
  next: () => number,
): string {
  const existing = keys.get(identity);
  if (existing) return existing;
  const key = `S${next()}`;
  keys.set(identity, key);
  return key;
}

function nativeReferenceFromSegment(segment: NativeSegment, speakerKey?: string): NativeReference {
  return {
    index: segment.index,
    nativeIndex: segment.index,
    kind: segment.kind,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    nativeSpeakerLabel: segment.speakerLabel,
    speakerKey,
    channelIndex: segment.channelIndex,
    language: segment.language,
    confidence: segment.confidence,
    logprob: segment.logprob,
    isAudioEvent: segment.isAudioEvent,
  };
}

function rawWhitespaceTokenCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
type LoadedProvider = {
  spec: (typeof RUN_SPECS)[number];
  run: BenchmarkRun;
  runDirectory: string;
  view: JsonRecord;
  native: { providerId: string; segments: NativeSegment[] };
  windows: ProviderWindow[];
  viewHash: string;
  viewPath: string;
  evidenceHashes: Record<string, string>;
};

function alignSequences<T>(
  reference: T[],
  hypothesis: T[],
  equal: (left: T, right: T) => boolean,
): TokenAlignment {
  const rows = reference.length + 1;
  const columns = hypothesis.length + 1;
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  const choices = Array.from({ length: rows }, () =>
    Array<'match' | 'substitution' | 'deletion' | 'insertion' | undefined>(columns).fill(undefined),
  );
  for (let row = 1; row < rows; row += 1) {
    costs[row]![0] = row;
    choices[row]![0] = 'deletion';
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0]![column] = column;
    choices[0]![column] = 'insertion';
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const diagonal =
        costs[row - 1]![column - 1]! +
        (equal(reference[row - 1]!, hypothesis[column - 1]!) ? 0 : 1);
      const deletion = costs[row - 1]![column]! + 1;
      const insertion = costs[row]![column - 1]! + 1;
      const options = [
        {
          cost: diagonal,
          operation: equal(reference[row - 1]!, hypothesis[column - 1]!)
            ? ('match' as const)
            : ('substitution' as const),
          rank: 0,
        },
        { cost: deletion, operation: 'deletion' as const, rank: 1 },
        { cost: insertion, operation: 'insertion' as const, rank: 2 },
      ];
      options.sort((left, right) => left.cost - right.cost || left.rank - right.rank);
      costs[row]![column] = options[0]!.cost;
      choices[row]![column] = options[0]!.operation;
    }
  }
  let row = reference.length;
  let column = hypothesis.length;
  const operations: TokenAlignment['operations'] = [];
  while (row > 0 || column > 0) {
    const operation = choices[row]![column]!;
    operations.push(operation);
    if (operation === 'match' || operation === 'substitution') {
      row -= 1;
      column -= 1;
    } else if (operation === 'deletion') {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  operations.reverse();
  return {
    substitutions: operations.filter((operation) => operation === 'substitution').length,
    deletions: operations.filter((operation) => operation === 'deletion').length,
    insertions: operations.filter((operation) => operation === 'insertion').length,
    totalEdits: costs[reference.length]![hypothesis.length]!,
    referenceLength: reference.length,
    hypothesisLength: hypothesis.length,
    operations,
  };
}

function editDistance<T>(reference: T[], hypothesis: T[]): number {
  return alignSequences(reference, hypothesis, (left, right) => left === right).totalEdits;
}

function providerLabel(item: NativeReference): string {
  if (item.speakerKey) return item.speakerKey;
  if (item.channelIndex !== undefined || item.nativeSpeakerLabel !== undefined) {
    return `channel:${item.channelIndex ?? ''}|speaker:${item.nativeSpeakerLabel ?? ''}`;
  }
  return 'unattributed';
}

function itemOrder(item: NativeReference, fallback: number): [number, number, number] {
  return [
    item.startMs ?? Number.MAX_SAFE_INTEGER,
    item.endMs ?? Number.MAX_SAFE_INTEGER,
    item.index ?? item.nativeIndex ?? fallback,
  ];
}

function sortNativeReferences(items: NativeReference[]): NativeReference[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = itemOrder(left.item, left.index);
      const b = itemOrder(right.item, right.index);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    })
    .map(({ item }) => item);
}

function appendProviderText(
  existing: string,
  next: string,
  kind: string,
  preserve: boolean,
): string {
  if (!existing) return next;
  if (preserve) return `${existing}${next}`;
  if (!next || /^\s/u.test(next) || /\s$/u.test(existing)) return `${existing}${next}`;
  if (
    kind === 'punctuation' ||
    /^[,.;:!?%)}\]]/u.test(next) ||
    /^[([{]/u.test(existing.at(-1) ?? '')
  )
    return `${existing}${next}`;
  return `${existing} ${next}`;
}

function providerText(providerId: ProviderId, items: NativeReference[]): string {
  const preserve =
    providerId === 'soniox-v5-async' ||
    providerId === 'mistral-voxtral-mini-transcribe-2' ||
    providerId === 'elevenlabs-scribe-v2';
  return sortNativeReferences(items).reduce(
    (text, item) => appendProviderText(text, item.text, item.kind ?? 'word', preserve),
    '',
  );
}

function mappingItems(
  providerId: ProviderId,
  items: NativeReference[],
): Array<{ label: string; tokens: string[] }> {
  const blocks: Array<{ label: string; text: string; kind: string }> = [];
  for (const item of sortNativeReferences(items)) {
    const label = providerLabel(item);
    const previous = blocks.at(-1);
    const preserve =
      providerId === 'soniox-v5-async' ||
      providerId === 'mistral-voxtral-mini-transcribe-2' ||
      providerId === 'elevenlabs-scribe-v2';
    if (previous?.label === label) {
      previous.text = appendProviderText(previous.text, item.text, item.kind ?? 'word', preserve);
      previous.kind = item.kind ?? previous.kind;
    } else {
      blocks.push({ label, text: item.text, kind: item.kind ?? 'word' });
    }
  }
  return blocks.map((block) => ({ label: block.label, tokens: normalizeScoringText(block.text) }));
}

function roleText(
  providerId: ProviderId,
  items: NativeReference[],
  mapping: Record<string, 'tutor' | 'student'>,
  role: 'tutor' | 'student',
): string {
  return providerText(
    providerId,
    sortNativeReferences(items).filter((item) => mapping[providerLabel(item)] === role),
  );
}

function wordCountsByLabel(providerId: ProviderId, segments: NativeSegment[]): Array<JsonRecord> {
  const identityKeys = new Map<string, string>();
  const rows = new Map<string, JsonRecord & { items: NativeReference[] }>();
  let nextKey = 1;
  for (const segment of segments) {
    const identity = `${segment.channelIndex ?? ''}\u0000${segment.speakerLabel ?? ''}`;
    const identityKey =
      segment.channelIndex === undefined && segment.speakerLabel === undefined
        ? 'unattributed'
        : identity;
    let label = identityKeys.get(identityKey);
    if (!label) {
      label = identityKey === 'unattributed' ? identityKey : `S${nextKey++}`;
      identityKeys.set(identityKey, label);
    }
    const row = rows.get(label) ?? {
      speakerKey: label,
      nativeSpeakerLabel: segment.speakerLabel,
      channelIndex: segment.channelIndex,
      nativeItemCount: 0,
      items: [],
    };
    row.nativeItemCount += 1;
    row.items.push({ ...segment, speakerKey: label });
    rows.set(label, row);
  }
  const renderedRows = [...rows.values()].map((row): JsonRecord => {
    const text = providerText(providerId, row.items);
    return {
      speakerKey: row.speakerKey,
      nativeSpeakerLabel: row.nativeSpeakerLabel,
      channelIndex: row.channelIndex,
      nativeItemCount: row.nativeItemCount,
      normalizedWordCount: normalizeScoringText(text).length,
      rawTextCharacters: text.length,
    };
  });
  const total = renderedRows.reduce((sum, row) => sum + row.normalizedWordCount, 0);
  return renderedRows
    .map(
      (row): JsonRecord => ({
        ...row,
        transcriptFraction: total ? row.normalizedWordCount / total : 0,
      }),
    )
    .sort((left: JsonRecord, right: JsonRecord) =>
      compareStrings(String(left.speakerKey), String(right.speakerKey)),
    );
}

function fixedSplitMapping(provider: LoadedProvider): Record<string, 'tutor' | 'student'> {
  const mapping: Record<string, 'tutor' | 'student'> = {};
  for (const window of provider.windows) {
    for (const item of window.nativeReferences) {
      const label = providerLabel(item);
      if (item.channelIndex === 0) mapping[label] = 'tutor';
      if (item.channelIndex === 1) mapping[label] = 'student';
    }
  }
  return mapping;
}

function charAlignment(referenceText: string, providerTextValue: string): TokenAlignment {
  return alignSequences(
    [...referenceText],
    [...providerTextValue],
    (left, right) => left === right,
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ratio(edits: number, denominator: number): number | null {
  return denominator ? edits / denominator : null;
}

function calculateWindowMetrics(
  provider: LoadedProvider,
  reference: ReferenceWindow,
  window: ProviderWindow,
  mapping: Record<string, 'tutor' | 'student'>,
): JsonRecord {
  const nativeItems = sortNativeReferences(window.nativeReferences);
  const rawChronological = window.chronologicalText;
  const normalizedReference = normalizeScoringText(reference.chronologicalText);
  const normalizedProvider = normalizeScoringText(rawChronological);
  const lexical = alignTokenStreams(normalizedReference, normalizedProvider);
  const chars = charAlignment(normalizedReference.join(' '), normalizedProvider.join(' '));
  const roleMetrics: JsonRecord = {};
  for (const role of ['tutor', 'student'] as const) {
    const referenceText = role === 'tutor' ? reference.tutorText : reference.studentText;
    const providerTextValue = roleText(provider.spec.providerId, nativeItems, mapping, role);
    const referenceTokens = normalizeScoringText(referenceText);
    const providerTokens = normalizeScoringText(providerTextValue);
    const alignment = alignTokenStreams(referenceTokens, providerTokens);
    roleMetrics[role] = {
      referenceWordCount: referenceTokens.length,
      providerWordCount: providerTokens.length,
      rawReferenceTokenCount: rawWhitespaceTokenCount(referenceText),
      rawProviderTokenCount: rawWhitespaceTokenCount(providerTextValue),
      substitutions: alignment.substitutions,
      deletions: alignment.deletions,
      insertions: alignment.insertions,
      wer: ratio(alignment.totalEdits, referenceTokens.length),
      rawReferenceTextCharacters: referenceText.length,
      rawProviderTextCharacters: providerTextValue.length,
    };
  }
  const tutor = roleMetrics.tutor as JsonRecord;
  const student = roleMetrics.student as JsonRecord;
  const saEdits =
    Number(tutor.substitutions) +
    Number(tutor.deletions) +
    Number(tutor.insertions) +
    Number(student.substitutions) +
    Number(student.deletions) +
    Number(student.insertions);
  const saReferenceWords = Number(tutor.referenceWordCount) + Number(student.referenceWordCount);
  return {
    windowId: reference.windowId,
    startMs: reference.startMs,
    endMs: reference.endMs,
    rawReferenceTextCharacters: reference.chronologicalText.length,
    rawProviderTextCharacters: rawChronological.length,
    rawReferenceTokenCount: rawWhitespaceTokenCount(reference.chronologicalText),
    rawProviderTokenCount: rawWhitespaceTokenCount(rawChronological),
    referenceWordCount: normalizedReference.length,
    providerWordCount: normalizedProvider.length,
    substitutions: lexical.substitutions,
    deletions: lexical.deletions,
    insertions: lexical.insertions,
    wer: ratio(lexical.totalEdits, normalizedReference.length),
    cer: ratio(chars.totalEdits, [...normalizedReference.join(' ')].length),
    characterEdits: chars.totalEdits,
    normalizedReferenceCharacterCount: [...normalizedReference.join(' ')].length,
    normalizedProviderCharacterCount: [...normalizedProvider.join(' ')].length,
    tutor: roleMetrics.tutor,
    student: roleMetrics.student,
    saWer: ratio(saEdits, saReferenceWords),
    attributionPenalty:
      ratio(saEdits, saReferenceWords) === null ||
      ratio(lexical.totalEdits, normalizedReference.length) === null
        ? null
        : ratio(saEdits, saReferenceWords)! -
          ratio(lexical.totalEdits, normalizedReference.length)!,
  };
}

function mappingForProvider(
  provider: LoadedProvider,
  referenceWindows: ReferenceWindow[],
): SpeakerMappingResult & { method: string; nativeSpeakerLabelCount: number } {
  const labels = wordCountsByLabel(provider.spec.providerId, provider.native.segments).map((row) =>
    String(row.speakerKey),
  );
  if (provider.spec.mode === 'trusted_split_control') {
    const mapping = fixedSplitMapping(provider);
    const objective = referenceWindows.reduce((sum, reference) => {
      const window = provider.windows.find(
        (candidate) => candidate.windowId === reference.windowId,
      )!;
      const tutor = normalizeScoringText(
        roleText(provider.spec.providerId, window.nativeReferences, mapping, 'tutor'),
      );
      const student = normalizeScoringText(
        roleText(provider.spec.providerId, window.nativeReferences, mapping, 'student'),
      );
      return (
        sum +
        editDistance(normalizeScoringText(reference.tutorText), tutor) +
        editDistance(normalizeScoringText(reference.studentText), student)
      );
    }, 0);
    return {
      mapping,
      bestObjective: objective,
      secondBestObjective: null,
      margin: null,
      labels: Object.keys(mapping).sort(),
      method: 'trusted_channel_topology: channel 0=tutor, channel 1=student',
      nativeSpeakerLabelCount: new Set(
        provider.native.segments.map((segment) => segment.speakerLabel).filter(Boolean),
      ).size,
    };
  }
  const inputWindows = referenceWindows.map((reference) => {
    const window = provider.windows.find((candidate) => candidate.windowId === reference.windowId)!;
    return {
      referenceTutorTokens: normalizeScoringText(reference.tutorText),
      referenceStudentTokens: normalizeScoringText(reference.studentText),
      providerItems: mappingItems(provider.spec.providerId, window.nativeReferences),
    };
  });
  const result = chooseGlobalSpeakerMapping({ labels, windows: inputWindows });
  return {
    ...result,
    method: 'exhaustive global two-role objective over all six frozen windows',
    nativeSpeakerLabelCount: new Set(
      provider.native.segments.map((segment) => segment.speakerLabel).filter(Boolean),
    ).size,
  };
}

function aggregateMetrics(windows: JsonRecord[]): JsonRecord {
  const referenceWords = windows.reduce(
    (sum, window) => sum + Number(window.referenceWordCount),
    0,
  );
  const edits = windows.reduce(
    (sum, window) =>
      sum + Number(window.substitutions) + Number(window.deletions) + Number(window.insertions),
    0,
  );
  const referenceChars = windows.reduce(
    (sum, window) => sum + Number(window.normalizedReferenceCharacterCount),
    0,
  );
  const charEdits = windows.reduce((sum, window) => sum + Number(window.characterEdits), 0);
  const macroWers = windows
    .map((window) => window.wer)
    .filter((value): value is number => typeof value === 'number');
  const roles: JsonRecord = {};
  for (const role of ['tutor', 'student'] as const) {
    const rows = windows.map((window) => window[role] as JsonRecord);
    const roleReferenceWords = rows.reduce((sum, row) => sum + Number(row.referenceWordCount), 0);
    const roleEdits = rows.reduce(
      (sum, row) =>
        sum + Number(row.substitutions) + Number(row.deletions) + Number(row.insertions),
      0,
    );
    roles[role] = {
      referenceWordCount: roleReferenceWords,
      providerWordCount: rows.reduce((sum, row) => sum + Number(row.providerWordCount), 0),
      rawReferenceTokenCount: rows.reduce(
        (sum, row) => sum + Number(row.rawReferenceTokenCount),
        0,
      ),
      rawProviderTokenCount: rows.reduce((sum, row) => sum + Number(row.rawProviderTokenCount), 0),
      substitutions: rows.reduce((sum, row) => sum + Number(row.substitutions), 0),
      deletions: rows.reduce((sum, row) => sum + Number(row.deletions), 0),
      insertions: rows.reduce((sum, row) => sum + Number(row.insertions), 0),
      wer: ratio(roleEdits, roleReferenceWords),
    };
  }
  const tutor = roles.tutor as JsonRecord;
  const student = roles.student as JsonRecord;
  const saEdits =
    Number(tutor.substitutions) +
    Number(tutor.deletions) +
    Number(tutor.insertions) +
    Number(student.substitutions) +
    Number(student.deletions) +
    Number(student.insertions);
  const saReferenceWords = Number(tutor.referenceWordCount) + Number(student.referenceWordCount);
  return {
    aggregateMicroWer: ratio(edits, referenceWords),
    macroMeanWindowWer: macroWers.length
      ? macroWers.reduce((sum, value) => sum + value, 0) / macroWers.length
      : null,
    aggregateCer: ratio(charEdits, referenceChars),
    referenceWordCount: referenceWords,
    providerWordCount: windows.reduce((sum, window) => sum + Number(window.providerWordCount), 0),
    rawReferenceTokenCount: windows.reduce(
      (sum, window) => sum + Number(window.rawReferenceTokenCount),
      0,
    ),
    rawProviderTokenCount: windows.reduce(
      (sum, window) => sum + Number(window.rawProviderTokenCount),
      0,
    ),
    substitutions: windows.reduce((sum, window) => sum + Number(window.substitutions), 0),
    deletions: windows.reduce((sum, window) => sum + Number(window.deletions), 0),
    insertions: windows.reduce((sum, window) => sum + Number(window.insertions), 0),
    tutor,
    student,
    saWer: ratio(saEdits, saReferenceWords),
    attributionPenalty:
      ratio(saEdits, saReferenceWords) === null || ratio(edits, referenceWords) === null
        ? null
        : ratio(saEdits, saReferenceWords)! - ratio(edits, referenceWords)!,
  };
}

function scoringSpec(campaignId: string, caseId: string): JsonRecord {
  return {
    schemaVersion: '1.0',
    kind: 'unified_audio_benchmark_scoring_spec',
    campaignId,
    caseId,
    frozenBeforeProviderResultScoring: true,
    lexicalNormalization: {
      unicodeNormalization: 'NFKC',
      caseHandling:
        'String.prototype.toLowerCase() for locale-independent Unicode-aware lowercasing',
      apostrophes: 'U+2018, U+2019, U+201B, and U+2032 become ASCII apostrophe U+0027',
      separators:
        'Every code point other than Unicode letters, marks, numbers, or whitespace becomes a space.',
      whitespace: 'Collapse Unicode whitespace and trim.',
      tokenization: 'Split the resulting string on one ASCII space.',
      prohibited: [
        'transliteration',
        'spell correction',
        'stemming',
        'lemmatization',
        'grammar correction',
        'synonym mapping',
        'translation',
        'production text normalization',
      ],
    },
    chronologicalMetrics: {
      unit: 'flattened chronological window text',
      windows: 'A-F, half-open [startMs,endMs)',
      segmentation: 'Provider/reference segment boundaries and timestamps are not scoring truth.',
      wer: 'micro total token edits / total reference tokens; macro arithmetic mean of six window WER values',
      cer: 'Levenshtein character edits over the normalized token strings joined by one space.',
    },
    speakerMapping: {
      mixed:
        'Exhaustive 2^N global mapping across all six windows minimizing tutor plus student token edit distance.',
      manyToOneAllowed: true,
      splitControl: 'Fixed trusted topology: channel 0=tutor, channel 1=student; no optimization.',
      unknownRoles:
        'No Teacher/Student inference from provider ordering; anonymous labels are mapped only for descriptive role-aware metrics.',
    },
    speakerMetrics: {
      saWer: '(tutor edits + student edits) / (tutor reference words + student reference words).',
      attributionPenalty: 'SA-WER - chronological micro WER.',
      diarizationErrorRate:
        'Not calculated because human timestamps are approximate alignment aids.',
    },
    fragmentation: {
      reported: [
        'native speaker-label count',
        'native identity count',
        'volume per native identity',
        'largest identity fraction',
        'very small clusters',
      ],
      verySmallClusterThreshold: 'normalizedWordCount <= 10',
      weightedScore: 'Not calculated.',
    },
    economics: {
      pricing: 'Selected immutable effective-dated snapshot is embedded in the operational output.',
      cost: 'Provider-observed actual, calculated snapshot estimate, and unknown/incomplete remain separate.',
      deepgram:
        'Unknown/incomplete unless the frozen run evidence itself supports stronger evidence.',
    },
    noCompositeScore: true,
  };
}

async function writeImmutableText(filePath: string, content: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(content, 'utf8');
  try {
    const existing = await readFile(filePath);
    if (!existing.equals(bytes))
      throw new Error(`Refusing to overwrite immutable scoring artifact: ${filePath}`);
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const handle = await open(filePath, 'wx');
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }
  return sha256Text(content);
}

async function writeImmutableJson(filePath: string, value: unknown): Promise<string> {
  return writeImmutableText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function verifyHash(filePath: string, expected: string, label: string): Promise<string> {
  const actual = await sha256File(filePath);
  if (actual !== expected)
    throw new Error(`${label} SHA-256 mismatch: expected ${expected}, observed ${actual}.`);
  return actual;
}

function runDirectory(root: string, campaignId: string, runId: string): string {
  return resolveUnderBenchmarkRoot(path.join('runs', campaignId, runId), root);
}

async function loadProvider(
  root: string,
  campaignId: string,
  caseId: string,
  spec: (typeof RUN_SPECS)[number],
  frozenWindows: FrozenWindowDefinition[],
  frozenWindowsPath: string,
  frozenWindowsHash: string,
  evaluationRoot: string,
): Promise<LoadedProvider> {
  const runDirectoryPath = runDirectory(root, campaignId, spec.runId);
  const run = await readJson<BenchmarkRun>(path.join(runDirectoryPath, 'run.json'));
  if (
    run.status !== 'success' ||
    run.campaignId !== campaignId ||
    run.caseId !== caseId ||
    run.providerId !== spec.providerId ||
    run.runMode !== spec.mode
  ) {
    throw new Error(`Run ${spec.runId} is not the expected successful ${spec.key} result.`);
  }
  const viewName = spec.runId.startsWith('deepgram-')
    ? 'deepgram-window-views.json'
    : `${spec.providerId.split('-')[0]}-window-views.json`;
  const viewPath = path.join(runDirectoryPath, viewName);
  const view = await readJson<JsonRecord>(viewPath);
  if (!run.nativeSegmentsPath || !run.comparableSegmentsPath) {
    throw new Error(`Run ${spec.runId} does not identify native/comparable evidence.`);
  }
  const nativePath = path.join(runDirectoryPath, run.nativeSegmentsPath);
  const native = await readJson<{ providerId: string; segments: NativeSegment[] }>(nativePath);
  if (!Array.isArray(native.segments))
    throw new Error(`Native evidence is malformed for ${spec.runId}.`);
  const rawResponsePath = run.rawResponsePaths?.at(-1);
  if (!rawResponsePath)
    throw new Error(`Run ${spec.runId} does not identify a final raw response.`);
  const canonical = validateAndCanonicalizeProviderWindowView({
    view,
    expectedCampaignId: campaignId,
    expectedCaseId: caseId,
    expectedProviderId: spec.providerId,
    expectedRunId: spec.runId,
    expectedRunMode: spec.mode,
    expectedFrozenWindowsPath: path
      .relative(runDirectoryPath, frozenWindowsPath)
      .split(path.sep)
      .join('/'),
    expectedNativeSegmentsPath: run.nativeSegmentsPath,
    expectedRawResponsePath: rawResponsePath,
    frozenWindows,
    frozenWindowsSha256: frozenWindowsHash,
    nativeArtifactSha256: await sha256File(nativePath),
    native,
  });
  const validatedViewPath = path.join(
    evaluationRoot,
    'validated-provider-window-views',
    `${spec.runId}.json`,
  );
  const viewHash = await writeImmutableJson(validatedViewPath, canonical.view);
  const rawPaths = (run.rawResponsePaths ?? []).map((relativePath) =>
    path.join(runDirectoryPath, relativePath),
  );
  const evidenceHashes: Record<string, string> = {
    native: await sha256File(nativePath),
    comparable: await sha256File(path.join(runDirectoryPath, run.comparableSegmentsPath)),
  };
  for (const [index, rawPath] of rawPaths.entries())
    evidenceHashes[`raw-${index + 1}`] = await sha256File(rawPath);
  return {
    spec,
    run,
    runDirectory: runDirectoryPath,
    view: canonical.view,
    native,
    windows: canonical.windows,
    viewHash,
    viewPath: validatedViewPath,
    evidenceHashes,
  };
}

function summarizeFragmentation(
  provider: LoadedProvider,
  mapping: Record<string, 'tutor' | 'student'>,
): JsonRecord {
  const rows = wordCountsByLabel(provider.spec.providerId, provider.native.segments);
  const nativeIdentityCount = rows.length;
  const totalWords = rows.reduce((sum, row) => sum + Number(row.normalizedWordCount), 0);
  return {
    nativeSpeakerLabelCount: new Set(
      provider.native.segments.map((segment) => segment.speakerLabel).filter(Boolean),
    ).size,
    nativeIdentityCount,
    identities: rows.map((row) => ({
      ...row,
      mappedRole: mapping[String(row.speakerKey)] ?? null,
    })),
    largestIdentityFraction: rows.length
      ? Math.max(...rows.map((row) => Number(row.transcriptFraction)))
      : 0,
    verySmallClusters: rows
      .filter((row) => Number(row.normalizedWordCount) <= 10)
      .map((row) => row.speakerKey),
    totalNativeItems: provider.native.segments.length,
    totalNormalizedWords: totalWords,
    identityKeyPolicy:
      'Stable local S1/S2 keys are based on the (channelIndex, native speaker label) identity; no role is inferred from order.',
  };
}

function parseUsageCost(usageJson: JsonRecord): JsonRecord | undefined {
  const entry = usageJson.usage_logs?.[0];
  if (!entry) return undefined;
  return {
    providerReportedCostUsd: Number(entry.cost_usd),
    inputCostUsd: Number(entry.input_cost_usd),
    inputAudioCostUsd: Number(entry.input_audio_cost_usd),
    inputTextCostUsd: Number(entry.input_text_cost_usd),
    outputCostUsd: Number(entry.output_cost_usd),
    outputTextCostUsd: Number(entry.output_text_cost_usd),
    inputAudioTokens: entry.input_audio_tokens,
    outputTextTokens: entry.output_text_tokens,
    inputAudioDurationMs: entry.input_audio_duration_ms,
    requestUuid: entry.uuid,
    usageModel: entry.model,
  };
}

function calculateOperationalCost(provider: LoadedProvider, snapshot: PriceSnapshot): JsonRecord {
  const snapshotCalculatedCost = calculateRunCost(provider.run, snapshot);
  let calculated = snapshotCalculatedCost;
  let actual: JsonRecord | undefined;
  if (provider.spec.providerId === 'soniox-v5-async') {
    const usagePath = path.join(provider.runDirectory, 'raw', '015-usage-logs.response');
    actual = parseUsageCost(JSON.parse(readFileSync(usagePath, 'utf8')) as JsonRecord);
    if (actual?.providerReportedCostUsd !== undefined) {
      calculated = {
        status: 'actual',
        amountUsd: actual.providerReportedCostUsd,
        priceSnapshotId: snapshot.snapshotId,
        basis: 'provider usage log cost_usd',
      };
    }
  }
  const sourceHours = provider.run.sourceWallClockDurationMs / 3_600_000;
  const amount = calculated.amountUsd;
  return {
    snapshotId: snapshot.snapshotId,
    snapshotEffectiveFrom: snapshot.effectiveFrom,
    snapshotCanonicalSha256: snapshot.canonicalSha256,
    snapshotEntry: snapshot.entries.find(
      (entry) =>
        entry.providerId === provider.run.providerId && entry.model === provider.run.requestedModel,
    ),
    sourceWallClockDurationMs: provider.run.sourceWallClockDurationMs,
    sourceChannels: provider.run.sourceChannels,
    preparedArtifactDurationMs: provider.run.preparedArtifactDurationMs,
    preparedArtifactChannels: provider.run.preparedArtifactChannels,
    providerReportedAudioDurationSec: provider.run.providerUsage?.audioDurationSec,
    providerBillableDurationSec: provider.run.providerUsage?.billableDurationSec,
    providerBillableChannels: provider.run.providerUsage?.billableChannels,
    processingElapsedMs: provider.run.elapsedMs,
    normalizedRealTimeFactor:
      provider.run.elapsedMs === undefined
        ? null
        : provider.run.elapsedMs / provider.run.sourceWallClockDurationMs,
    physicalAttemptCount: provider.run.attempts.length,
    costEvidenceStatus: calculated.status,
    costUsd: amount ?? null,
    normalizedUsdPerWallClockHour: amount === undefined ? null : amount / sourceHours,
    calculatedCostBasis: calculated.basis,
    costNote: calculated.note,
    snapshotCalculatedCost,
    providerObservedUsageCost: actual,
    retentionObservation: retentionObservation(provider),
  };
}

function retentionObservation(provider: LoadedProvider): string {
  if (provider.spec.providerId === 'soniox-v5-async')
    return 'Exact transcription and file objects were deleted and exact GET verification returned 404 in the saved operations evidence.';
  if (provider.spec.providerId === 'speechmatics-melia-1-batch')
    return 'Exact job deletion returned 200 and exact GET verification returned 404 in saved evidence.';
  return 'Synchronous response did not expose an exact persistent object/delete path in the saved run evidence; no account-wide cleanup was attempted.';
}

function markdownMetrics(metrics: JsonRecord): string {
  const { eligible, control } = partitionComparisonProviders(metrics.providers as JsonRecord[]);
  const formatRow = (provider: JsonRecord) => {
    const aggregate = provider.aggregate as JsonRecord;
    const format = (value: unknown) => (typeof value === 'number' ? value.toFixed(4) : 'n/a');
    return `| ${provider.displayName} | ${format(aggregate.aggregateMicroWer)} | ${format((aggregate.student as JsonRecord).wer)} | ${format((aggregate.tutor as JsonRecord).wer)} | ${format(aggregate.saWer)} | ${format(aggregate.attributionPenalty)} | ${format(aggregate.aggregateCer)} | ${provider.mapping.nativeSpeakerLabelCount} |`;
  };
  const lines = [
    '# Unified lexical and speaker-aware benchmark metrics',
    '',
    'This report is descriptive evidence for the six frozen configurations. It does not select a provider, calculate a weighted composite, or calculate a diarization error rate.',
    '',
    '## Eligible simple-upload candidates',
    '',
    '| Configuration | Chronological WER | Student WER | Tutor WER | SA-WER | Attribution penalty | CER | Native labels |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...eligible.map(formatRow),
    '',
    '## Non-ranked quality control',
    '',
    '| Configuration | Chronological WER | Student WER | Tutor WER | SA-WER | Attribution penalty | CER | Native labels |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...control.map(formatRow),
    '',
    'The eligible table is descriptively sorted by student WER and contains no quality control. The control is shown separately and is not a ranked candidate.',
    '',
    '## Method and limitations',
    '',
    '- Reference and provider text use the same NFKC, Unicode-aware lowercase, punctuation-separator, whitespace-collapse tokenization specified in `scoring-spec.json`.',
    '- Metrics are calculated on flattened chronological window text. Provider segmentation and approximate timestamps are not scoring truth.',
    '- Mixed anonymous speaker labels use one exhaustive global mapping across all six windows. The split control uses the trusted channel topology directly.',
    '- Speaker-aware WER is an attribution diagnostic, not a diarization error rate.',
    '- Fragmentation is reported descriptively without a weighted fragmentation score.',
    '- Ordinary lexical substitutions and severe pedagogical meaning changes require the separate blinded semantic review.',
  ];
  return `${lines.join('\n')}\n`;
}

function markdownOperational(operational: JsonRecord): string {
  const format = (value: unknown, digits = 4) =>
    typeof value === 'number' ? value.toFixed(digits) : 'n/a';
  const lines = [
    '# Operational and economic evidence',
    '',
    'This table is separate from quality metrics. Missing or unconfirmed billing semantics remain explicit.',
    '',
    '| Configuration | Duration ms | Elapsed ms | Real-time factor | Cost status | Lesson USD | USD / wall-clock hour | Attempts |',
    '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |',
    ...operational.providers.map(
      (provider: JsonRecord) =>
        `| ${provider.displayName} | ${provider.sourceWallClockDurationMs} | ${provider.processingElapsedMs ?? 'n/a'} | ${format(provider.normalizedRealTimeFactor)} | ${provider.costEvidenceStatus} | ${format(provider.costUsd, 6)} | ${format(provider.normalizedUsdPerWallClockHour, 6)} | ${provider.physicalAttemptCount} |`,
    ),
    '',
    `Pricing snapshot: ${operational.priceSnapshot.snapshotId}, effective ${operational.priceSnapshot.effectiveFrom}, canonical hash ${operational.priceSnapshot.canonicalSha256}.`,
    '',
    'Deepgram remains unknown/incomplete because diarization and multichannel billing semantics are not confirmed by these frozen run artifacts.',
  ];
  return `${lines.join('\n')}\n`;
}

function blindedReadme(): string {
  return `# Blinded semantic review

This package contains six frozen two-minute windows and anonymized candidate labels. It is a later independent review package containing only review text and candidate labels.

## Review protocol

1. Listen to each window using the stereo, tutor-only, student-only, and mixed convenience extracts.
2. Read the human reference and candidate text only as aids; judge what was actually spoken.
3. Preserve learner grammatical errors, false starts, self-corrections, repetitions, Russian/English switches, teacher errors that were actually spoken, and meaningful audible fillers.
4. Use the isolated channels to resolve tutor/student attribution. Do not infer identity from candidate label order.
5. Do not spend time chasing sub-second timestamp precision.
6. Mark genuinely unclear audio rather than guessing.

## Review categories

Record counts and short examples separately for:

- Severe pedagogical errors: reversed/lost/inserted negation; materially changed tense/aspect or modal meaning; silent correction of a learner error; materially misrecognized correction; lost or reordered repair; omitted important utterance or language stretch; or materially mishandled Russian/English switching.
- Speaker errors: learner text attributed to tutor or vice versa; damaged correction/response relationship; or fragmentation that makes learner extraction unreliable.
- Ordinary errors: lexical substitutions, place-name errors, punctuation differences, and harmless filler differences.

Do not turn this review into a scalar provider score. Return counts, examples, and uncertainty notes by blind label.\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const campaignId = args.campaign ?? '2026-08-elimination-01';
  const caseId = args.case ?? 'standard-lesson-2026-08-28';
  const environment = loadBenchmarkEnvironment();
  const root = getBenchmarkRoot(environment);
  const referenceRoot = resolveUnderBenchmarkRoot(
    path.join('references', campaignId, caseId),
    root,
  );
  const campaignEvaluationRoot = resolveUnderBenchmarkRoot(
    path.join('evaluation', campaignId, caseId),
    root,
  );
  const evaluationRoot = resolveUnderBenchmarkRoot(
    args['output-dir'] ??
      path.join('evaluation', campaignId, caseId, 'unified-scoring-final-2026-08-29-v3'),
    root,
  );

  const annotationPath = path.join(referenceRoot, 'annotations.json');
  const referenceViewsPath = path.join(referenceRoot, 'reference-views.json');
  const windowsPath = path.join(campaignEvaluationRoot, 'frozen-windows.json');
  await verifyHash(annotationPath, EXPECTED_REFERENCE_HASHES.annotations, 'annotations');
  await verifyHash(referenceViewsPath, EXPECTED_REFERENCE_HASHES.views, 'reference views');
  const frozenWindowsHash = await verifyHash(
    windowsPath,
    EXPECTED_REFERENCE_HASHES.windows,
    'frozen windows',
  );

  const frozenWindows = await readJson<JsonRecord>(windowsPath);
  const references = await readJson<JsonRecord>(referenceViewsPath);
  if (
    !Array.isArray(frozenWindows.windows) ||
    !Array.isArray(references.windows) ||
    frozenWindows.windows.length !== 6 ||
    references.windows.length !== 6
  ) {
    throw new Error('Frozen scoring inputs must contain exactly six windows.');
  }
  assertExactWindows(
    frozenWindows.windows.map((window: JsonRecord) => ({
      windowId: String(window.windowId),
      startMs: Number(window.startMs),
      endMs: Number(window.endMs),
    })),
    'frozen evidence',
  );
  const frozenWindowDefinitions = frozenWindows.windows as FrozenWindowDefinition[];
  const referenceWindows = WINDOW_IDS.map((windowId) => {
    const frozen = frozenWindows.windows.find((window: JsonRecord) => window.windowId === windowId);
    const reference = references.windows.find((window: JsonRecord) => window.windowId === windowId);
    if (
      !frozen ||
      !reference ||
      frozen.startMs !== reference.startMs ||
      frozen.endMs !== reference.endMs
    )
      throw new Error(`Frozen window ${windowId} is missing or mismatched.`);
    return reference as ReferenceWindow;
  });

  const specPath = path.join(evaluationRoot, 'scoring-spec.json');
  const specHash = await writeImmutableJson(specPath, scoringSpec(campaignId, caseId));
  const providers = [] as LoadedProvider[];
  for (const spec of RUN_SPECS)
    providers.push(
      await loadProvider(
        root,
        campaignId,
        caseId,
        spec,
        frozenWindowDefinitions,
        windowsPath,
        frozenWindowsHash,
        evaluationRoot,
      ),
    );

  const scoredProviders = providers.map((provider) => {
    const mapping = mappingForProvider(provider, referenceWindows);
    const windows = referenceWindows.map((reference) =>
      calculateWindowMetrics(
        provider,
        reference,
        provider.windows.find((window) => window.windowId === reference.windowId)!,
        mapping.mapping,
      ),
    );
    return {
      providerId: provider.spec.providerId,
      runMode: provider.spec.mode,
      runId: provider.spec.runId,
      displayName: provider.spec.displayName,
      eligibleSimpleUploadCandidate: provider.spec.simpleUploadCandidate,
      controlOnly: !provider.spec.simpleUploadCandidate,
      mapping,
      fragmentation: summarizeFragmentation(provider, mapping.mapping),
      aggregate: aggregateMetrics(windows),
      windows,
      inputView: {
        path: path.relative(root, provider.viewPath).split(path.sep).join('/'),
        sha256: provider.viewHash,
      },
    };
  });
  const comparisonPartitions = partitionComparisonProviders(scoredProviders);
  const metrics = {
    schemaVersion: '1.0',
    kind: 'unified_lexical_speaker_metrics',
    campaignId,
    caseId,
    scoringSpecSha256: specHash,
    referenceInputHashes: EXPECTED_REFERENCE_HASHES,
    scoringUnit: 'flattened chronological text in six frozen two-minute windows',
    noDiarizationErrorRate: true,
    noWeightedCompositeScore: true,
    providers: scoredProviders,
    eligibleSimpleUploadCandidates: comparisonPartitions.eligible,
    nonRankedQualityControls: comparisonPartitions.control,
  };
  const metricsPath = path.join(evaluationRoot, 'lexical-speaker-metrics.json');
  const metricsHash = await writeImmutableJson(metricsPath, metrics);
  const metricsReportPath = path.join(evaluationRoot, 'metrics-report.md');
  const metricsReportHash = await writeImmutableText(metricsReportPath, markdownMetrics(metrics));

  const snapshot = publicPriceSnapshot('public-2026-08-28');
  const operationalProviders = providers.map((provider) => ({
    providerId: provider.spec.providerId,
    runMode: provider.spec.mode,
    runId: provider.spec.runId,
    displayName: provider.spec.displayName,
    ...calculateOperationalCost(provider, snapshot),
  }));
  const operational = {
    schemaVersion: '1.0',
    kind: 'unified_operational_economic_evidence',
    campaignId,
    caseId,
    priceSnapshot: snapshot,
    providers: operationalProviders,
  };
  const operationalPath = path.join(evaluationRoot, 'operational-comparison.json');
  const operationalHash = await writeImmutableJson(operationalPath, operational);
  const operationalReportPath = path.join(evaluationRoot, 'operational-report.md');
  const operationalReportHash = await writeImmutableText(
    operationalReportPath,
    markdownOperational(operational),
  );

  const blind = createBlindLabelMapping(
    RUN_SPECS.map((spec) => spec.key),
    `semantic-review-blind-v1-${campaignId}`,
  );
  const blindDirectory = path.join(evaluationRoot, 'blinded-semantic-review');
  const blindWindows = referenceWindows.map((reference) => ({
    windowId: reference.windowId,
    startMs: reference.startMs,
    endMs: reference.endMs,
    reference: {
      chronologicalText: reference.chronologicalText,
      studentText: reference.studentText,
      tutorText: reference.tutorText,
    },
    candidates: scoredProviders
      .map((provider) => {
        const loadedProvider = providers.find(
          (candidate) => candidate.spec.runId === provider.runId,
        )!;
        const window = loadedProvider.windows.find(
          (candidate) => candidate.windowId === reference.windowId,
        )!;
        const providerMapping = provider.mapping.mapping as Record<string, 'tutor' | 'student'>;
        return {
          configurationKey: `${provider.providerId}:${provider.runMode}`,
          chronologicalText: window.chronologicalText,
          studentText: roleText(
            loadedProvider.spec.providerId,
            window.nativeReferences,
            providerMapping,
            'student',
          ),
          tutorText: roleText(
            loadedProvider.spec.providerId,
            window.nativeReferences,
            providerMapping,
            'tutor',
          ),
        };
      })
      .sort((left, right) => left.configurationKey.localeCompare(right.configurationKey)),
  }));
  const blindReview = createBlindedReviewPackage({
    campaignId,
    caseId,
    mapping: blind,
    windows: blindWindows,
  });
  const blindReviewPath = path.join(blindDirectory, 'review.json');
  const blindReviewHash = await writeImmutableJson(blindReviewPath, blindReview);
  const blindReadmePath = path.join(blindDirectory, 'README.md');
  const blindReadmeHash = await writeImmutableText(blindReadmePath, blindedReadme());
  const blindKeyPath = path.join(evaluationRoot, 'blind-label-key.json');
  const blindKeyHash = await writeImmutableJson(blindKeyPath, {
    schemaVersion: '1.0',
    kind: 'blinded-review-label-key',
    campaignId,
    caseId,
    ...blind,
    configurations: RUN_SPECS.map((spec) => ({
      key: spec.key,
      runId: spec.runId,
      providerId: spec.providerId,
      mode: spec.mode,
      model: providers.find((provider) => provider.spec.runId === spec.runId)!.run.requestedModel,
      controlOnly: !spec.simpleUploadCandidate,
    })),
  });

  const provenance = {
    schemaVersion: '1.0',
    kind: 'unified-scoring-freeze',
    campaignId,
    caseId,
    deterministic: true,
    scoringSpec: {
      relativePath: path.relative(root, specPath).split(path.sep).join('/'),
      sha256: specHash,
    },
    referenceInputs: {
      annotations: {
        relativePath: path.relative(root, annotationPath).split(path.sep).join('/'),
        sha256: EXPECTED_REFERENCE_HASHES.annotations,
      },
      views: {
        relativePath: path.relative(root, referenceViewsPath).split(path.sep).join('/'),
        sha256: EXPECTED_REFERENCE_HASHES.views,
      },
      frozenWindows: {
        relativePath: path.relative(root, windowsPath).split(path.sep).join('/'),
        sha256: EXPECTED_REFERENCE_HASHES.windows,
      },
    },
    providerInputViews: providers.map((provider) => ({
      key: provider.spec.key,
      runId: provider.spec.runId,
      relativePath: path.relative(root, provider.viewPath).split(path.sep).join('/'),
      sha256: provider.viewHash,
      evidenceHashes: provider.evidenceHashes,
    })),
    outputs: {
      metrics: {
        relativePath: path.relative(root, metricsPath).split(path.sep).join('/'),
        sha256: metricsHash,
      },
      metricsReport: {
        relativePath: path.relative(root, metricsReportPath).split(path.sep).join('/'),
        sha256: metricsReportHash,
      },
      operational: {
        relativePath: path.relative(root, operationalPath).split(path.sep).join('/'),
        sha256: operationalHash,
      },
      operationalReport: {
        relativePath: path.relative(root, operationalReportPath).split(path.sep).join('/'),
        sha256: operationalReportHash,
      },
      blindReview: {
        relativePath: path.relative(root, blindReviewPath).split(path.sep).join('/'),
        sha256: blindReviewHash,
      },
      blindReadme: {
        relativePath: path.relative(root, blindReadmePath).split(path.sep).join('/'),
        sha256: blindReadmeHash,
      },
      blindLabelKey: {
        relativePath: path.relative(root, blindKeyPath).split(path.sep).join('/'),
        sha256: blindKeyHash,
      },
    },
    invariants: {
      sixConfigurations: true,
      sixWindowsPerConfiguration: true,
      providerSegmentationNotScoringTruth: true,
      noDiarizationErrorRate: true,
      noWeightedScalarProviderScore: true,
      trustedSplitUsesChannelTopology: true,
      noProviderOutputChanged: true,
      networkRequests: 0,
      finalProviderSelectionDeferred: true,
    },
  };
  const provenancePath = path.join(evaluationRoot, 'scoring-freeze.json');
  const provenanceHash = await writeImmutableJson(provenancePath, provenance);
  console.log(
    JSON.stringify(
      {
        campaignId,
        caseId,
        scoringSpec: { path: specPath, sha256: specHash },
        metrics: { path: metricsPath, sha256: metricsHash },
        metricsReport: { path: metricsReportPath, sha256: metricsReportHash },
        operational: { path: operationalPath, sha256: operationalHash },
        operationalReport: { path: operationalReportPath, sha256: operationalReportHash },
        blindReview: { path: blindReviewPath, sha256: blindReviewHash },
        blindLabelKey: { path: blindKeyPath, sha256: blindKeyHash },
        scoringFreeze: { path: provenancePath, sha256: provenanceHash },
        networkRequests: 0,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
