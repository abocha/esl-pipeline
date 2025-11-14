import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  DialogueInput,
  DialogueSynthesisOptions,
  DialogueSynthesisResult,
  DialogueChunk,
} from './types.js';
import { concatMp3Segments } from './ffmpeg.js';

const DEFAULT_DIALOGUE_MODEL_ID = 'eleven_v3';
const DEFAULT_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_22050_32';
const MAX_DIALOGUE_INPUTS = 100;
const MAX_TOTAL_CHARS = 5000;
const DIALOGUE_TIMEOUT_MS = 60000;

/**
 * Splits large dialogue arrays into manageable chunks
 * @param inputs - Array of dialogue inputs
 * @param maxInputs - Maximum number of inputs per chunk (default: 100)
 * @param maxChars - Maximum total characters per chunk (default: 5000)
 * @returns Array of chunks with metadata
 */
export function chunkDialogueInputs(
  inputs: DialogueInput[],
  maxInputs = MAX_DIALOGUE_INPUTS,
  maxChars = MAX_TOTAL_CHARS
): DialogueChunk[] {
  if (inputs.length === 0) {
    return [];
  }

  const chunks: DialogueChunk[] = [];
  let currentChunk: DialogueInput[] = [];
  let currentChars = 0;

  for (const input of inputs) {
    const inputChars = input.text.length;

    // Start new chunk if limits exceeded
    if (
      currentChunk.length >= maxInputs ||
      (currentChunk.length > 0 && currentChars + inputChars > maxChars)
    ) {
      chunks.push({
        inputs: currentChunk,
        chunkIndex: chunks.length,
        totalChunks: 0, // Will be updated after loop
      });
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(input);
    currentChars += inputChars;
  }

  // Add final chunk if not empty
  if (currentChunk.length > 0) {
    chunks.push({
      inputs: currentChunk,
      chunkIndex: chunks.length,
      totalChunks: 0,
    });
  }

  // Update totalChunks for all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.totalChunks = totalChunks;
  }

  return chunks;
}

/**
 * Creates deterministic hash for caching dialogue synthesis
 * @param inputs - Dialogue inputs (text + voice_id)
 * @param options - Synthesis options affecting output
 * @returns SHA-256 hash string
 */
export function buildDialogueHash(
  inputs: DialogueInput[],
  options: Partial<DialogueSynthesisOptions>
): string {
  const hashInput = {
    inputs: inputs.map(i => ({ text: i.text, voice_id: i.voice_id })),
    modelId: options.modelId ?? DEFAULT_DIALOGUE_MODEL_ID,
    languageCode: options.languageCode,
    stability: options.stability,
    seed: options.seed,
  };

  return createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
}

/**
 * Calls ElevenLabs Text-to-Dialogue API for a single chunk
 * @param chunk - Array of dialogue inputs
 * @param options - Synthesis options
 * @param apiKey - ElevenLabs API key
 * @returns Audio buffer
 * @throws Error with API response details on failure
 */
export async function synthesizeDialogueChunk(
  chunk: DialogueInput[],
  options: DialogueSynthesisOptions,
  apiKey: string
): Promise<Buffer> {
  if (!apiKey) {
    throw new Error('Missing ELEVENLABS_API_KEY');
  }

  if (chunk.length === 0) {
    throw new Error('Cannot synthesize empty dialogue chunk');
  }

  const outputFormat = options.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const modelId = options.modelId ?? DEFAULT_DIALOGUE_MODEL_ID;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DIALOGUE_TIMEOUT_MS);

  try {
    const url = new URL('https://api.elevenlabs.io/v1/text-to-dialogue');
    url.searchParams.set('output_format', outputFormat);

    const body: Record<string, unknown> = {
      inputs: chunk,
      model_id: modelId,
    };

    if (options.languageCode) {
      body.language_code = options.languageCode;
    }

    if (options.stability !== undefined) {
      body.settings = { stability: options.stability };
    }

    if (options.seed !== undefined) {
      body.seed = options.seed;
    }

    if (options.applyTextNormalization) {
      body.apply_text_normalization = options.applyTextNormalization;
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Text-to-Dialogue API failed (${response.status} ${response.statusText}): ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error('Text-to-Dialogue API returned no body');
    }

    // Convert web ReadableStream to Buffer
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Text-to-Dialogue API request timed out after ${DIALOGUE_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Main orchestration function for dialogue synthesis
 * Handles chunking, synthesis, concatenation, and caching
 * @param options - Synthesis options including inputs
 * @param apiKey - ElevenLabs API key
 * @param outputDir - Directory for output files
 * @returns Synthesis result with path, duration, and hash
 */
export async function synthesizeDialogue(
  options: DialogueSynthesisOptions,
  apiKey: string,
  outputDir: string
): Promise<DialogueSynthesisResult> {
  if (!options.inputs || options.inputs.length === 0) {
    throw new Error('Dialogue synthesis requires at least one input');
  }

  // Generate hash for caching
  const hash = buildDialogueHash(options.inputs, options);

  // Chunk inputs if necessary
  const chunks = chunkDialogueInputs(options.inputs);

  if (chunks.length === 0) {
    throw new Error('Failed to chunk dialogue inputs');
  }

  // Synthesize each chunk
  const chunkFiles: string[] = [];
  const tempFiles: string[] = [];

  try {
    for (const chunk of chunks) {
      const chunkHash =
        chunks.length > 1 ? `${hash}-chunk${chunk.chunkIndex}` : hash;
      const chunkFileName = `${chunkHash}.mp3`;
      const chunkFilePath = resolve(outputDir, chunkFileName);

      // Synthesize chunk
      const audioBuffer = await synthesizeDialogueChunk(
        chunk.inputs,
        options,
        apiKey
      );

      // Write to file
      await new Promise<void>((resolvePromise, reject) => {
        const writeStream = createWriteStream(chunkFilePath);
        writeStream.on('error', reject);
        writeStream.on('finish', resolvePromise);
        writeStream.write(audioBuffer);
        writeStream.end();
      });

      chunkFiles.push(chunkFilePath);
      if (chunks.length > 1) {
        tempFiles.push(chunkFilePath);
      }
    }

    // Determine final output path
    let finalPath: string;
    let duration: number | undefined;

    if (chunkFiles.length === 1) {
      // Single chunk - use directly
      finalPath = chunkFiles[0]!;
    } else {
      // Multiple chunks - concatenate
      const finalFileName = `${hash}.mp3`;
      finalPath = resolve(outputDir, finalFileName);

      await concatMp3Segments(chunkFiles, finalPath, true);

      // Clean up temp chunk files
      const { unlink } = await import('node:fs/promises');
      await Promise.allSettled(tempFiles.map(f => unlink(f)));
    }

    // Calculate approximate duration
    try {
      const stats = await stat(finalPath);
      if (stats.size > 0) {
        // Approximate duration based on file size and bitrate
        const match = DEFAULT_OUTPUT_FORMAT.match(/mp3_\d+_(\d+)/);
        if (match) {
          const kbps = Number.parseInt(match[1]!, 10);
          if (kbps) {
            const seconds = (stats.size * 8) / (kbps * 1000);
            duration = Math.round(seconds * 100) / 100;
          }
        }
      }
    } catch {
      // Duration calculation is optional
    }

    return {
      audioPath: finalPath,
      duration,
      hash,
    };
  } catch (error) {
    // Clean up any created files on error
    const { unlink } = await import('node:fs/promises');
    await Promise.allSettled([...chunkFiles, ...tempFiles].map(f => unlink(f)));
    throw error;
  }
}