export function estimateDurationFromFileSize(
  bytes: number,
  outputFormat: string | undefined,
): number | undefined {
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (!outputFormat) return undefined;

  const match = outputFormat.match(/mp3_\d+_(\d+)/);
  if (!match) return undefined;

  const kbps = Number.parseInt(match[1] ?? '', 10);
  if (!kbps) return undefined;

  const seconds = (bytes * 8) / (kbps * 1000);
  return Math.round(seconds * 100) / 100;
}
