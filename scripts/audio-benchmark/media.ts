import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type MediaProbe = {
  durationMs: number;
  channels: number;
  sampleRateHz: number;
  container?: string;
  codec?: string;
};

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const result = await execFile(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'format=duration,format_name:stream=channels,sample_rate,codec_name',
      '-of',
      'json',
      filePath,
    ],
    { windowsHide: true },
  );
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ channels?: number; sample_rate?: string; codec_name?: string }>;
  };
  const stream = parsed.streams?.[0];
  const durationMs = Number(parsed.format?.duration) * 1000;
  const channels = stream?.channels;
  const sampleRateHz = Number(stream?.sample_rate);
  if (!Number.isFinite(durationMs) || !channels || !Number.isFinite(sampleRateHz)) {
    throw new Error(`ffprobe returned incomplete audio metadata for ${filePath}`);
  }
  return {
    durationMs: Math.round(durationMs),
    channels,
    sampleRateHz,
    container: parsed.format?.format_name?.split(',')[0],
    codec: stream?.codec_name,
  };
}
