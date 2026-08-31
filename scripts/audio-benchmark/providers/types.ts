import type {
  AttemptPhase,
  BenchmarkRunMode,
  ExternalReference,
  NativeSegment,
  ProviderId,
  ProviderRequestMode,
  ProviderUsage,
} from '../schema';

export type ProviderInput = {
  providerId: ProviderId;
  runMode: BenchmarkRunMode;
  inputPath: string;
  fileName: string;
  sourceChannels: number;
  preparedChannels: number;
  sourceDurationMs: number;
  preparedDurationMs: number;
  options: Record<string, unknown>;
  environment?: NodeJS.ProcessEnv;
  runId?: string;
  selectedInputSha256?: string;
  recordExternalReference?: (reference: ExternalReference) => Promise<void>;
};

export type MultipartBody = {
  kind: 'multipart';
  filePath: string;
  fileField: string;
  fileName: string;
  fields: Record<string, string>;
};

export type RequestBody =
  | { kind: 'json'; value: Record<string, unknown> }
  | MultipartBody
  | { kind: 'binary'; filePath: string; contentType: string };

export type RequestStep = {
  phase: AttemptPhase;
  method: 'POST' | 'GET' | 'WS';
  url: string;
  headers?: Record<string, string>;
  body?: RequestBody;
  credentialEnv: string;
  description: string;
  requestRisk?: 'none' | 'paid' | 'external_state';
};

export type RequestIntent = {
  providerId: ProviderId;
  runMode: BenchmarkRunMode;
  requestMode: ProviderRequestMode;
  model: string;
  credentialEnv: string;
  steps: RequestStep[];
  warnings: string[];
};

export type ProviderHttpResponse = {
  status: number;
  body: string;
  responsePath?: string;
};

export type ProviderRequest = Omit<RequestStep, 'phase' | 'description'>;
export type ProviderRequestClient = (
  phase: AttemptPhase,
  request: ProviderRequest,
) => Promise<ProviderHttpResponse>;

export type ProviderStreamRequest = {
  url: string;
  config: Record<string, unknown>;
  filePath: string;
  fileName: string;
  sampleRateHz: number;
  channels: number;
  chunkBytes: number;
  credentialEnv: string;
  description: string;
  requestRisk?: 'none' | 'paid' | 'external_state';
  pacing: 'unpaced' | number;
  endOfAudioDelayMs: number;
  quietPeriodBeforeCloseMs: number;
  physicalCloseGraceMs: number;
  maxWaitMs: number;
};

export type ProviderStreamEvent = {
  sequence: number;
  elapsedMs: number;
  direction: 'client' | 'server' | 'transport';
  kind:
    | 'socket_open'
    | 'config'
    | 'audio_chunk'
    | 'end_turn'
    | 'close_stream'
    | 'server_message'
    | 'socket_error'
    | 'socket_close'
    | 'client_close';
  phase?: 'before_logical_completion' | 'after_logical_completion';
  rawMessage?: string;
  audioOffsetBytes?: number;
  audioBytes?: number;
  audioSha256?: string;
  closeCode?: number;
  closeReason?: string;
  errorMessage?: string;
};

export type ProviderStreamEvidence = {
  rawMessages: string[];
  logicalResultMessages: string[];
  postCompletionTransportMessages: string[];
  events: ProviderStreamEvent[];
  outboundAudioBytes: number;
  outboundAudioSha256: string;
  outboundAudioChunkCount: number;
  sendElapsedMs: number;
  audioStartedElapsedMs?: number;
  audioFinishedElapsedMs?: number;
  endTurnSentElapsedMs?: number;
  closeStreamSentElapsedMs?: number;
  finalResultElapsedMs?: number;
  usageElapsedMs?: number;
  logicalCompletionElapsedMs?: number;
  physicalSocketBehavior:
    | 'provider_closed_before_usage'
    | 'client_closed_after_usage'
    | 'client_close_not_observed'
    | 'not_closed_before_failure';
  clientCloseRequested: boolean;
  physicalCloseObserved: boolean;
  cleanupGraceExhausted: boolean;
  physicalCloseElapsedMs?: number;
  totalElapsedMs: number;
  providerSideWork: boolean;
};

export type ProviderStreamResponse = ProviderStreamEvidence & {
  responsePath?: string;
};

export type ProviderStreamClient = (
  phase: AttemptPhase,
  request: ProviderStreamRequest,
) => Promise<ProviderStreamResponse>;

export type ParsedProviderResponse = {
  nativeSegments: NativeSegment[];
  returnedModel?: string;
  usage?: ProviderUsage;
  providerMetadata?: Record<string, unknown>;
};

export type ProviderExecution = ParsedProviderResponse & {
  rawResponsePaths: string[];
};

export type ProviderAdapter = {
  id: ProviderId;
  displayName: string;
  requestMode: ProviderRequestMode;
  model: string;
  credentialEnv: string;
  buildIntent(input: ProviderInput): RequestIntent;
  parseResponse(body: unknown): ParsedProviderResponse;
  execute(
    input: ProviderInput,
    request: ProviderRequestClient,
    stream?: ProviderStreamClient,
  ): Promise<ProviderExecution>;
};

export class ProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly outcome: 'failed' | 'uncertain',
    readonly category: string,
  ) {
    super(message);
    this.name = 'ProviderExecutionError';
  }
}
