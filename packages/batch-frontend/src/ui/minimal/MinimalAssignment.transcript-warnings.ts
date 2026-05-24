const UNEXPECTED_TRANSCRIPT_CHARACTER_PATTERN = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/gu;

export function getTranscriptUnexpectedCharacterWarnings(transcriptText: string): string[] {
  return [...new Set(transcriptText.match(UNEXPECTED_TRANSCRIPT_CHARACTER_PATTERN) ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
}
