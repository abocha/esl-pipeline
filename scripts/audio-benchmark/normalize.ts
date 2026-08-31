import type { ComparableSegment, NativeSegment, ProviderId } from './schema';

export function deriveComparableSegments(
  nativeSegments: NativeSegment[],
  providerId?: ProviderId,
): ComparableSegment[] {
  const preserveProviderText =
    providerId === 'soniox-v5-async' || providerId === 'mistral-voxtral-mini-transcribe-2';
  const speakerKeys = new Map<string, string>();
  let nextSpeakerNumber = 1;
  const derived: ComparableSegment[] = [];

  for (const native of nativeSegments) {
    const previous = derived.at(-1);
    const identity = speakerIdentity(native.channelIndex, native.speakerLabel);
    const previousIdentity = previous
      ? speakerIdentity(previous.channelIndex, previous.nativeSpeakerLabel)
      : undefined;
    const sameSpeaker =
      previous &&
      identity !== undefined &&
      previousIdentity !== undefined &&
      identity === previousIdentity;
    const sameLanguage =
      previous && (!previous.language || !native.language || previous.language === native.language);

    if (sameSpeaker && sameLanguage) {
      previous.text = appendProviderText(
        previous.text,
        native.text,
        native.kind,
        preserveProviderText,
      );
      previous.endMs = native.endMs ?? previous.endMs;
      if (!previous.language) previous.language = native.language;
      continue;
    }

    const speakerKey = identity
      ? getAnonymousSpeakerKey(identity, speakerKeys, () => nextSpeakerNumber++)
      : undefined;
    derived.push({
      index: derived.length,
      startMs: native.startMs,
      endMs: native.endMs,
      speakerKey,
      nativeSpeakerLabel: native.speakerLabel,
      channelIndex: native.channelIndex,
      language: native.language,
      text: native.text,
    });
  }

  return derived;
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

function speakerIdentity(
  channelIndex: number | undefined,
  speakerLabel: string | undefined,
): string | undefined {
  if (channelIndex === undefined && speakerLabel === undefined) return undefined;
  return `${channelIndex ?? ''}\u0000${speakerLabel ?? ''}`;
}

function appendProviderText(
  existing: string,
  next: string,
  kind: string,
  preserveProviderText: boolean,
): string {
  if (!existing) return next;
  if (preserveProviderText) return `${existing}${next}`;
  if (!next || /^\s/u.test(next) || /\s$/u.test(existing)) return `${existing}${next}`;
  if (
    kind === 'punctuation' ||
    /^[,.;:!?%)}\]]/u.test(next) ||
    /^[([{]/u.test(existing.at(-1) ?? '')
  ) {
    return `${existing}${next}`;
  }
  return `${existing} ${next}`;
}
