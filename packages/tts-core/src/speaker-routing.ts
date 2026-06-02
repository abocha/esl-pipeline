export type SpeakerRoutingHint = 'narrator' | 'dialogue' | 'system';

const NARRATOR_PATTERN = /\b(narrator|narration|storyteller|voiceover|voice over|announcer)\b/i;
const SYSTEM_PATTERN = /\b(system|assistant|ai|bot|chatbot)\b/i;

export function resolveSpeakerRoutingHint(value: unknown): SpeakerRoutingHint | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (NARRATOR_PATTERN.test(normalized)) return 'narrator';
  if (SYSTEM_PATTERN.test(normalized)) return 'system';
  return 'dialogue';
}
