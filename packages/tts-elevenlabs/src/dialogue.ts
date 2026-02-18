import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { InfrastructureError } from '@esl-pipeline/contracts';

import { estimateDurationFromFileSize } from './audioDuration.js';
import { getElevenClient } from './eleven.js';
import { concatMp3Segments } from './ffmpeg.js';
import {
  classifyElevenLabsVoiceProviderError,
  formatElevenLabsProviderError,
} from './provider-runtime.js';
import type {
  DialogueChunk,
  DialogueInput,
  DialogueSynthesisOptions,
  DialogueSynthesisResult,
} from './types.js';

const DEFAULT_DIALOGUE_MODEL_ID = 'eleven_v3';
const DEFAULT_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_22050_32';
const MAX_DIALOGUE_INPUTS = 100;
const MAX_TOTAL_CHARS = 5000;
const DIALOGUE_TIMEOUT_SECONDS = 60;
const DIALOGUE_MAX_RETRIES = 2;
type DialogueConvertBody = Parameters<ReturnType<typeof getElevenClient>['textToDialogue']['convert']>[0];
type DialogueOutputFormat = NonNullable<DialogueConvertBody['outputFormat']>;

interface NormalizedDialogueInput {
  text: string;
  voiceId: string;
}

function normalizeDialogueInput(input: DialogueInput): NormalizedDialogueInput {
  const text = typeof input.text === 'string' ? input.text : '';
  const voiceId = typeof input.voiceId === 'string' ? input.voiceId : input.voice_id;

  if (!voiceId || !voiceId.trim()) {
    throw new Error(`Dialogue input is missing voiceId for text: "${text.slice(0, 64)}"`);
  }

  return { text, voiceId };
}

function normalizeDialogueInputs(inputs: DialogueInput[]): NormalizedDialogueInput[] {
  return inputs.map((input) => normalizeDialogueInput(input));
}

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
  maxChars = MAX_TOTAL_CHARS,
): DialogueChunk[] {
  const normalizedInputs = normalizeDialogueInputs(inputs);
  if (normalizedInputs.length === 0) {
    return [];
  }

  const chunks: DialogueChunk[] = [];
  let currentChunk: DialogueInput[] = [];
  let currentChars = 0;

  for (const input of normalizedInputs) {
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
 * @param inputs - Dialogue inputs (text + voiceId)
 * @param options - Synthesis options affecting output
 * @returns SHA-256 hash string
 */
export function buildDialogueHash(
  inputs: DialogueInput[],
  options: Partial<DialogueSynthesisOptions>,
): string {
  const normalizedInputs = normalizeDialogueInputs(inputs);
  const hashInput = {
    inputs: normalizedInputs.map((i) => ({ text: i.text, voiceId: i.voiceId })),
    modelId: options.modelId ?? DEFAULT_DIALOGUE_MODEL_ID,
    outputFormat: options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    languageCode: options.languageCode,
    stability: options.stability,
    seed: options.seed,
    applyTextNormalization: options.applyTextNormalization ?? 'auto',
  };

  return createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
}

function resolveDialogueClient(apiKey: string): ElevenLabsClient {
  const key = apiKey.trim();
  if (key) {
    return new ElevenLabsClient({ apiKey: key });
  }
  return getElevenClient();
}

async function readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
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
}

/**
 * Calls ElevenLabs Text-to-Dialogue API for a single chunk using the official SDK.
 * @param chunk - Array of dialogue inputs
 * @param options - Synthesis options
 * @param apiKey - ElevenLabs API key
 * @returns Audio buffer
 * @throws Error with API response details on failure
 */
export async function synthesizeDialogueChunk(
  chunk: DialogueInput[],
  options: DialogueSynthesisOptions,
  apiKey: string,
): Promise<Buffer> {
  if (chunk.length === 0) {
    throw new Error('Cannot synthesize empty dialogue chunk');
  }

  if (!apiKey && !process.env.ELEVENLABS_API_KEY && !process.env.ELEVENLABS_API_TOKEN) {
    throw new Error('Missing ELEVENLABS_API_KEY');
  }

  const normalizedChunk = normalizeDialogueInputs(chunk);
  const outputFormat = (options.outputFormat ?? DEFAULT_OUTPUT_FORMAT) as DialogueOutputFormat;
  const modelId = options.modelId ?? DEFAULT_DIALOGUE_MODEL_ID;
  const client = resolveDialogueClient(apiKey);

  try {
    const stream = await client.textToDialogue.convert(
      {
        inputs: normalizedChunk,
        modelId,
        outputFormat,
        languageCode: options.languageCode,
        settings: options.stability === undefined ? undefined : { stability: options.stability },
        seed: options.seed,
        applyTextNormalization: options.applyTextNormalization,
      },
      {
        timeoutInSeconds: options.timeoutInSeconds ?? DIALOGUE_TIMEOUT_SECONDS,
        maxRetries: options.maxRetries ?? DIALOGUE_MAX_RETRIES,
      },
    );
    return await readStreamToBuffer(stream);
  } catch (error: unknown) {
    const formatted = formatElevenLabsProviderError(error);
    const category = classifyElevenLabsVoiceProviderError({
      error,
      messageForClassification: formatted,
    });
    throw new InfrastructureError(
      `Text-to-Dialogue synthesis failed [${category}]: ${formatted}`,
    );
  }
}

function ensureApiKey(apiKey: string): void {
  if (apiKey.trim().length > 0) return;
  if (process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_TOKEN) return;
  throw new Error('Missing ELEVENLABS_API_KEY');
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
  outputDir: string,
): Promise<DialogueSynthesisResult> {
  const normalizedInputs = normalizeDialogueInputs(options.inputs ?? []);
  if (normalizedInputs.length === 0) {
    throw new Error('Dialogue synthesis requires at least one input');
  }
  ensureApiKey(apiKey);

  const normalizedOptions: DialogueSynthesisOptions = {
    ...options,
    inputs: normalizedInputs,
  };

  // Generate hash for caching
  const hash = buildDialogueHash(normalizedInputs, normalizedOptions);
  const outputFormat = normalizedOptions.outputFormat ?? DEFAULT_OUTPUT_FORMAT;

  // Chunk inputs if necessary
  const chunks = chunkDialogueInputs(normalizedInputs);

  if (chunks.length === 0) {
    throw new Error('Failed to chunk dialogue inputs');
  }

  // Synthesize each chunk
  const chunkFiles: string[] = [];
  const tempFiles: string[] = [];

  try {
    for (const chunk of chunks) {
      const chunkHash = chunks.length > 1 ? `${hash}-chunk${chunk.chunkIndex}` : hash;
      const chunkFileName = `${chunkHash}.mp3`;
      const chunkFilePath = resolve(outputDir, chunkFileName);

      // Synthesize chunk
      const audioBuffer = await synthesizeDialogueChunk(chunk.inputs, normalizedOptions, apiKey);

      // Write to file
      await new Promise<void>((resolve, reject) => {
        const writeStream = createWriteStream(chunkFilePath);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
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
      await Promise.allSettled(tempFiles.map((f) => unlink(f)));
    }

    // Calculate approximate duration
    try {
      const stats = await stat(finalPath);
      if (stats.size > 0) {
        duration = estimateDurationFromFileSize(stats.size, outputFormat);
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
    await Promise.allSettled([...chunkFiles, ...tempFiles].map((f) => unlink(f)));
    throw error;
  }
}
