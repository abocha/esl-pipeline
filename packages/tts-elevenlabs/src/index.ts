import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile, copyFile, unlink } from 'node:fs/promises';
import yaml from 'js-yaml';
import { extractStudyText } from '@esl-pipeline/md-extractor';
import { pickVoiceForSpeaker, loadVoicesCatalog } from "./assign.js";
import { access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { concatMp3Segments, synthSilenceMp3 } from './ffmpeg.js';

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function buildStudyTextMp3(
  mdPath: string,
  opts: { voiceMapPath: string; outPath: string; preview?: boolean; force?: boolean }
): Promise<{ path: string; duration?: number; hash: string }> {
  // Read and extract study text
  const mdContent = readFileSync(mdPath, 'utf-8');
  const studyText = extractStudyText(mdContent);
  const normalizedText = studyText.lines.join('\n');

  // Load voice map
  const voiceMapContent = readFileSync(opts.voiceMapPath, 'utf-8');
  const voiceMap = yaml.load(voiceMapContent) as Record<string, string>;

  // Generate hash based on study text and voice map
  const hashInput = JSON.stringify({ text: normalizedText, voices: voiceMap });
  const hash = hashStudyText(hashInput);
  const fileName = `${hash}.mp3`;
  const outputDir = resolve(opts.outPath || dirname(mdPath));
  const targetPath = resolve(outputDir, fileName);

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined
    };
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Check if cached file exists
  if (!opts.force) {
    try {
      const cachedContent = readFileSync(targetPath);
      // If file exists and not empty, return cached result
      if (cachedContent.length > 0) {
        return {
          path: targetPath,
          hash,
          duration: undefined // Would need to parse from audio metadata
        };
      }
    } catch {
      // File doesn't exist, proceed with generation
    }
  }

  // Generate TTS for each line or chunk
  const audioFiles: string[] = [];
  let totalDuration = 0;

  for (const line of studyText.lines) {
    const voiceId = await getVoiceIdForLine(line, voiceMap as any, studyText.type);
    if (!voiceId) continue;

    // Create a temporary file for this line's audio
    const lineHash = createHash('sha256').update(`${line}-${voiceId}`).digest('hex');
    const lineFileName = `${lineHash}.mp3`;
    const lineFilePath = resolve(outputDir, lineFileName);

    // Placeholder path: synthesize a valid MP3 segment so ffmpeg can concatenate it
    // Duration heuristic: short base + ~45ms per character (bounded 0.5s..4s)
    const dur = Math.max(0.5, Math.min(4, 0.25 + line.length * 0.045));
    await synthSilenceMp3(lineFilePath, dur);

    audioFiles.push(lineFilePath);
    totalDuration += line.length * 0.1; // Rough estimate: 0.1 seconds per character

  }
    if (audioFiles.length === 0) {
    throw new Error('TTS produced 0 segments. Check voices.yml (default/auto) and study-text content.');
  }
  
  // Concatenate audio files using ffmpeg
  if (audioFiles.length === 1) {
    // Single file, just copy it
    await copyFile(audioFiles[0]!, targetPath);
  } else if (audioFiles.length > 1) {
    // Multiple files, concatenate with ffmpeg
    await concatMp3Segments(audioFiles.filter(Boolean), targetPath, true);
  }

  try {
    if (audioFiles.length === 1) {
      await copyFile(audioFiles[0]!, targetPath);
    } else if (audioFiles.length > 1) {
      await concatMp3Segments(audioFiles, targetPath, true);
    }
  } finally {
    // best-effort cleanup; ignore errors
    await Promise.allSettled(audioFiles.map(p => unlink(p)));
  }

  return {
    path: targetPath,
    duration: Math.round(totalDuration * 100) / 100, // Round to 2 decimal places
    hash
  };
}

type VoiceMap = {
  // manual overrides:
  [speaker: string]: string;
} & {
  default?: string;
  auto?: boolean;
};

function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(":");
  if (idx > 0 && idx < 40) {
    return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

async function getVoiceIdForLine(
  line: string,
  voiceMap: VoiceMap,
  mode: "monologue" | "dialogue"
): Promise<string | undefined> {
  // 1) manual override by exact speaker
  const { speaker } = parseSpeaker(line);
  if (speaker && voiceMap[speaker]) return voiceMap[speaker];

  // 2) manual default
  if (voiceMap.default) return voiceMap.default;

  // 3) auto mode (if enabled) — pick by gender/role
  if (voiceMap.auto) {
    const role =
      mode === "monologue"
        ? "narrator"
        : speaker?.toLowerCase() === "narrator"
        ? "narrator"
        : "student";
    const picked = await pickVoiceForSpeaker(speaker || "Narrator", { role: role as any });
    return picked || undefined;
  }

  // 4) final fallback: try catalog’s first voice, or undefined
  const catalog = await loadVoicesCatalog().catch(() => ({ voices: [] }));
  return catalog.voices[0]?.id;
}
