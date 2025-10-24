import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";

/** Run ffmpeg with args; rejects on non-zero exit. */
export function runFfmpeg(args: string[], label = "ffmpeg"): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found (ffmpeg-static)"));
    const proc = spawn(ffmpegPath as unknown as string, args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

/**
 * Concatenate MP3 segments using the concat demuxer.
 * If `reencode` is true, re-encodes to MP3 (slower but tolerant).
 */
export async function concatMp3Segments(
  segmentPaths: string[],
  outFile: string,
  reencode = false
): Promise<void> {
  if (segmentPaths.length === 0) throw new Error("No segments to concatenate");
  const abs = segmentPaths.map(p => resolve(p));

  // Build concat list file
  const listFile = join(tmpdir(), `ffconcat_${Date.now()}.txt`);
  const lines = abs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, lines, "utf8");

  // Try stream copy (fast). If caller requested reencode, do it directly.
  const argsFast = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile];
  const argsReenc = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-b:a", "128k", outFile];

  try {
    if (reencode) {
      await runFfmpeg(argsReenc, "ffmpeg-concat-reencode");
    } else {
      try {
        await runFfmpeg(argsFast, "ffmpeg-concat-fast");
      } catch {
        // fall back to re-encode if stream copy fails
        await runFfmpeg(argsReenc, "ffmpeg-concat-reencode");
      }
    }
  } finally {
    try { await unlink(listFile); } catch {}
  }
}