import { createSttEngine } from './engine.js';
import type {
  SttEngine,
  SttProviderAdapter,
  SttProviderId,
  SttTranscribeContext,
  SttTranscriptionResult,
} from './types.js';

let defaultEngine: SttEngine = createSttEngine();

export function configureSttEngine(engine: SttEngine): void {
  defaultEngine = engine;
}

export function registerSttProviders(providers: SttProviderAdapter[]): void {
  defaultEngine.registerProviders(providers);
}

export function registerSttProvider(provider: SttProviderAdapter): void {
  defaultEngine.registerProvider(provider);
}

export function getRegisteredSttProvider(id: SttProviderId): SttProviderAdapter | undefined {
  return defaultEngine.getProvider(id);
}

export async function transcribeAudio(args: {
  provider?: SttProviderId;
  context: SttTranscribeContext;
  configByProvider: Partial<Record<SttProviderId, unknown>>;
}): Promise<SttTranscriptionResult> {
  return defaultEngine.transcribe(args);
}

export async function validateSttProviderConfig(args: {
  provider?: SttProviderId;
  configByProvider: Partial<Record<SttProviderId, unknown>>;
}): Promise<void> {
  await defaultEngine.validateProviderConfig(args);
}

export { createSttEngine } from './engine.js';
export {
  formatSpeakerLabel,
  formatTimestamp,
  formatTranscriptFromSegments,
  mergeSegments,
  normalizeSegmentEnds,
  normalizeTranscriptText,
} from './format.js';
export type {
  SttEngine,
  SttProviderAdapter,
  SttProviderId,
  SttTranscribeContext,
  SttTranscriptionResult,
  TranscriptMode,
  TranscriptSegment,
} from './types.js';
