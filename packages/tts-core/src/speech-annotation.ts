import { ConfigurationError } from '@esl-pipeline/contracts';

import { normalizeSpeechCueText } from './speech-plan-analysis.js';

export const CONTEXTUAL_SPEECH_ANNOTATION_VERSION = 'contextual-bracket-annotation-v1' as const;
export const SPEECH_ANNOTATION_OPEN = '<tts-annotation>' as const;
export const SPEECH_ANNOTATION_CLOSE = '</tts-annotation>' as const;

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}'’_-]/u;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u;

export interface ValidatedSpeechAnnotationText {
  synthesisText: string;
  annotationCount: number;
}

export function validateSpeechAnnotationText(
  sourceText: string,
  synthesisText: string,
): ValidatedSpeechAnnotationText {
  assertSourceHasNoReservedDelimiter(sourceText);

  let cursor = 0;
  let reconstructed = '';
  let canonical = '';
  let annotationCount = 0;

  while (cursor < synthesisText.length) {
    const openAt = synthesisText.indexOf(SPEECH_ANNOTATION_OPEN, cursor);
    const strayCloseAt = synthesisText.indexOf(SPEECH_ANNOTATION_CLOSE, cursor);
    if (strayCloseAt >= 0 && (openAt < 0 || strayCloseAt < openAt)) {
      throw new ConfigurationError('Speech annotation text contains an unmatched close marker.');
    }
    if (openAt < 0) {
      const authoredTail = synthesisText.slice(cursor);
      reconstructed += authoredTail;
      canonical += authoredTail;
      cursor = synthesisText.length;
      break;
    }

    const authoredChunk = synthesisText.slice(cursor, openAt);
    reconstructed += authoredChunk;
    canonical += authoredChunk;

    const bodyStart = openAt + SPEECH_ANNOTATION_OPEN.length;
    const closeAt = synthesisText.indexOf(SPEECH_ANNOTATION_CLOSE, bodyStart);
    if (closeAt < 0) {
      throw new ConfigurationError('Speech annotation text contains an unmatched open marker.');
    }
    const nestedOpenAt = synthesisText.indexOf(SPEECH_ANNOTATION_OPEN, bodyStart);
    if (nestedOpenAt >= 0 && nestedOpenAt < closeAt) {
      throw new ConfigurationError('Speech annotation text must not contain nested markers.');
    }

    const insertionOffset = reconstructed.length;
    if (
      splitsSurrogatePair(sourceText, insertionOffset) ||
      !isValidInsertionBoundary(
        Array.from(sourceText.slice(0, insertionOffset)).at(-1),
        Array.from(sourceText.slice(insertionOffset))[0],
      )
    ) {
      throw new ConfigurationError('Speech annotation is not at a valid authored-text boundary.');
    }
    const annotation = normalizeSpeechCueText(
      'freeFormDirection',
      synthesisText.slice(bodyStart, closeAt),
    );
    if (!annotation) {
      throw new ConfigurationError('Speech annotation body must not be empty.');
    }
    canonical += `${SPEECH_ANNOTATION_OPEN}${annotation}${SPEECH_ANNOTATION_CLOSE}`;
    annotationCount += 1;
    cursor = closeAt + SPEECH_ANNOTATION_CLOSE.length;
  }

  if (reconstructed !== sourceText) {
    throw new ConfigurationError('Speech annotation text changed the authored text.');
  }
  return { synthesisText: canonical, annotationCount };
}

export function assertSourceHasNoReservedDelimiter(sourceText: string): void {
  if (sourceText.includes(SPEECH_ANNOTATION_OPEN) || sourceText.includes(SPEECH_ANNOTATION_CLOSE)) {
    throw new ConfigurationError('Authored text contains a reserved annotation delimiter.');
  }
}

function isValidInsertionBoundary(left?: string, right?: string): boolean {
  if (left === undefined || right === undefined) return true;
  if (WORD_CHARACTER.test(left) && WORD_CHARACTER.test(right)) return false;
  if (PUNCTUATION_OR_SYMBOL.test(left) && PUNCTUATION_OR_SYMBOL.test(right)) return false;
  return true;
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return false;
  const left = value.charCodeAt(offset - 1);
  const right = value.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}
