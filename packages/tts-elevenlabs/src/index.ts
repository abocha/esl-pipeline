import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function buildStudyTextMp3(
  mdPath: string,
  opts: { voiceMapPath: string; outPath: string; preview?: boolean }
): Promise<{ path: string; duration?: number; hash: string }> {
  const hash = hashStudyText(mdPath + opts.voiceMapPath);
  const fileName = `${hash}.mp3`;
  const outputDir = resolve(opts.outPath || dirname(mdPath));
  const targetPath = resolve(outputDir, fileName);

  if (!opts.preview) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(targetPath, Buffer.from([]));
  }

  return {
    path: targetPath,
    hash,
    duration: undefined
  };
}
