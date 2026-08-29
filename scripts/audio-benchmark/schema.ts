export const BENCHMARK_SCHEMA_VERSION = '1.0';
export const BENCHMARK_RUNNER_VERSION = '1.0.0';
export const PREPARATION_VERSION = 'downmix-mono-pcm-s16le-16k-v1';

export const providerIds = [
  'soniox-v5-async',
  'speechmatics-melia-1-batch',
  'mistral-voxtral-mini-transcribe-2',
  'deepgram-nova-3',
  'elevenlabs-scribe-v2',
] as const;

export type ProviderId = (typeof providerIds)[number];
export type CorpusTopology = 'mixed_recording' | 'trusted_split_two_channel';
export const benchmarkRunModes = [
  'mixed_diarized',
  'trusted_split_control',
  'original_source_compatibility',
] as const;
export type BenchmarkRunMode = (typeof benchmarkRunModes)[number];
export type ProviderRequestMode = 'async_file' | 'batch' | 'direct';
export type PreparationKind = 'controlled_downmix_to_mono';
export type AttemptPhase = 'upload' | 'submit' | 'poll' | 'result' | 'transcribe';
export type AttemptOutcome = 'started' | 'succeeded' | 'failed' | 'uncertain';

export type SourceMedia = {
  relativePath: string;
  sha256: string;
  bytes: number;
  container?: string;
  codec?: string;
  wallClockDurationMs: number;
  channels: number;
  sampleRateHz?: number;
};

export type PreparedMedia = {
  relativePath: string;
  sha256: string;
  bytes: number;
  durationMs: number;
  channels: number;
  sampleRateHz: number;
  preparationVersion: string;
  kind: PreparationKind;
};

export type BenchmarkCase = {
  caseId: string;
  topology: CorpusTopology;
  tags: string[];
  source: SourceMedia;
  prepared?: PreparedMedia;
};

export type BenchmarkManifest = {
  schemaVersion: string;
  campaignId: string;
  runnerVersion: string;
  createdAt: string;
  corpusHash: string;
  preparationVersion: string;
  cases: BenchmarkCase[];
};

export type NativeSegment = {
  index: number;
  kind: string;
  startMs?: number;
  endMs?: number;
  text: string;
  speakerLabel?: string;
  language?: string;
  isAudioEvent?: boolean | null;
  channelIndex?: number;
  confidence?: number;
  logprob?: number;
};

export type ComparableSegment = {
  index: number;
  startMs?: number;
  endMs?: number;
  speakerKey?: string;
  nativeSpeakerLabel?: string;
  channelIndex?: number;
  language?: string;
  text: string;
};

export type ProviderUsage = {
  audioDurationSec?: number;
  billableDurationSec?: number;
  billableChannels?: number;
  source: 'provider' | 'calculated' | 'unknown';
  rawUsage?: Record<string, unknown>;
};

export type AttemptRecord = {
  attemptId: string;
  phase: AttemptPhase;
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  method?: string;
  endpoint?: string;
  requestFingerprint?: string;
  requestRisk?: 'none' | 'paid' | 'external_state';
  httpStatus?: number;
  outcome: AttemptOutcome;
  responsePath?: string;
  errorCategory?: string;
  errorMessage?: string;
};

export type ExternalReference = {
  kind: 'file' | 'job' | 'transcription';
  id: string;
};

export type BenchmarkRun = {
  schemaVersion: string;
  runId: string;
  campaignId: string;
  caseId: string;
  providerId: ProviderId;
  requestedModel: string;
  returnedModel?: string;
  providerMetadata?: Record<string, unknown>;
  requestMode: ProviderRequestMode;
  runMode: BenchmarkRunMode;
  sourceSha256: string;
  preparedSha256?: string;
  sourceWallClockDurationMs: number;
  sourceChannels: number;
  sourceContainer?: string;
  sourceCodec?: string;
  preparedArtifactDurationMs?: number;
  preparedArtifactChannels?: number;
  preparedArtifactSampleRateHz?: number;
  mediaIngest: {
    inputArtifact: 'prepared_artifact' | 'original_source';
    originalSourceDirect: 'not_tested' | 'accepted' | 'rejected';
  };
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  attempts: AttemptRecord[];
  externalReferences?: ExternalReference[];
  rawResponsePaths?: string[];
  nativeSegmentsPath?: string;
  comparableSegmentsPath?: string;
  providerUsage?: ProviderUsage;
  actualBillingAmountUsd?: number;
  status: 'success' | 'failed' | 'uncertain';
  errorCategory?: string;
  errorMessage?: string;
};

export type OutputPaths = {
  runDirectory: string;
  runRecord: string;
  rawDirectory: string;
  nativeSegments: string;
  comparableSegments: string;
};
