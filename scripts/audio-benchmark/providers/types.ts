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
  method: 'POST' | 'GET';
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

export type ParsedProviderResponse = {
  nativeSegments: NativeSegment[];
  returnedModel?: string;
  usage?: ProviderUsage;
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
  execute(input: ProviderInput, request: ProviderRequestClient): Promise<ProviderExecution>;
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
