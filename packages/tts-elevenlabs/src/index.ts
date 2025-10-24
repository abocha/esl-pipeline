import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { extractStudyText } from '@esl-pipeline/md-extractor';
import { concatMp3Segments } from './ffmpeg.js';

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
    const voiceId = getVoiceIdForLine(line, voiceMap, studyText.type);
    if (!voiceId) continue;

    // Create a temporary file for this line's audio
    const lineHash = createHash('sha256').update(`${line}-${voiceId}`).digest('hex');
    const lineFileName = `${lineHash}.mp3`;
    const lineFilePath = resolve(outputDir, lineFileName);

    // Placeholder - actual ElevenLabs API call would go here
    // For MVP, we'll create dummy audio data
    const dummyAudio = Buffer.from(`dummy audio for: ${line}`); // In real implementation, this would be API response
    await writeFile(lineFilePath, dummyAudio);

    audioFiles.push(lineFilePath);
    totalDuration += line.length * 0.1; // Rough estimate: 0.1 seconds per character
  }

  // Concatenate audio files using ffmpeg
  if (audioFiles.length === 1) {
    // Single file, just copy it
    await copyFile(audioFiles[0]!, targetPath);
  } else if (audioFiles.length > 1) {
    // Multiple files, concatenate with ffmpeg
    await concatMp3Segments(audioFiles.filter(Boolean), targetPath, true);
  }

  return {
    path: targetPath,
    duration: Math.round(totalDuration * 100) / 100, // Round to 2 decimal places
    hash
  };
}

function getVoiceIdForLine(line: string, voiceMap: Record<string, string>, type: 'dialogue' | 'monologue'): string | undefined {
  if (type === 'monologue') {
    return voiceMap['default'] || Object.values(voiceMap)[0];
  }

  // For dialogue, parse speaker from line
  const match = line.match(/^[\s]*[\[\(]?([A-Za-zА-Яа-яЁё0-9 _.-]{1,32})[\]\)]?:\s+/);
  if (match && match[1]) {
    const speaker = match[1].trim();
    return voiceMap[speaker] || voiceMap['default'];
  }

  return voiceMap['default'];
}
