import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getFfmpegPath } from "@esl-pipeline/ffmpeg-binary";

/** Run ffmpeg with args; rejects on non-zero exit. */
export async function runFfmpeg(args: string[], label = "ffmpeg"): Promise<void> {
  const bin = await getFfmpegPath();
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn(bin, args, { stdio: "inherit" });
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
  const abs = segmentPaths.map((p) => resolve(p));

  const listFile = join(tmpdir(), `ffconcat_${Date.now()}.txt`);
  const lines = abs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, lines, "utf8");

  const argsFast = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile];
  const argsReenc = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-b:a", "128k", outFile];

  try {
    if (reencode) {
      await runFfmpeg(argsReenc, "ffmpeg-concat-reencode");
    } else {
      try {
        await runFfmpeg(argsFast, "ffmpeg-concat-fast");
      } catch {
        await runFfmpeg(argsReenc, "ffmpeg-concat-reencode");
      }
    }
  } finally {
    try { await unlink(listFile); } catch {}
  }
}

// ADD at top of file (if not already present)
export async function synthSilenceMp3(outFile: string, seconds: number): Promise<void> {
  const dur = Math.max(0.3, Math.min(seconds, 10)); // keep sane bounds
  // mono 22050Hz is fine; libmp3lame is included in BtbN builds
  const args = [
    "-y",
    "-f", "lavfi",
    "-t", String(dur),
    "-i", "anullsrc=channel_layout=mono:sample_rate=22050",
    "-c:a", "libmp3lame",
    "-q:a", "7",       // variable bitrate, smaller file
    outFile
  ];
  await runFfmpeg(args, "ffmpeg-synth-silence");
}
