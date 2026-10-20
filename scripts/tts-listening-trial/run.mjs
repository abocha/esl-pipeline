// Isolated, explicitly invoked live-provider experiment. No production imports or routing changes.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const samples = JSON.parse(readFileSync(join(here, 'samples.json'), 'utf8'));
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? fallback;
const provider = option('provider', '');
const project = option('project', '');
const selected = option('sample', 'all');
const model = option('model', 'gemini-3.8-flash-tts');
const out = resolve(option('out', join(root, 'tmp/tts-listening-trial')));
if (!['google', 'inworld'].includes(provider))
  throw new Error('Pass --provider=google or --provider=inworld. This makes billable API calls.');
if (provider === 'google' && !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project))
  throw new Error('Pass an explicit --project=PROJECT_ID.');
if (provider === 'google' && !['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'].includes(model))
  throw new Error('Unsupported trial model.');
const chosen = samples.filter((sample) => selected === 'all' || sample.id === selected);
if (!chosen.length) throw new Error('Unknown sample.');
mkdirSync(out, { recursive: true });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const command = (name, commandArgs) =>
  execFileSync(name, commandArgs, { encoding: 'utf8', windowsHide: true });
const probe = (path) =>
  JSON.parse(
    command('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_name,sample_rate,channels',
      '-of',
      'json',
      path,
    ]),
  );
// Windows uses a fixed PowerShell command for gcloud's .cmd wrapper; no input interpolation.
let token;
let inworld;
if (provider === 'google') {
  token = (
    process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& gcloud.cmd auth print-access-token --quiet',
          ],
          { encoding: 'utf8', windowsHide: true },
        )
      : command('gcloud', ['auth', 'print-access-token', '--quiet'])
  ).trim();
} else {
  const env = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
  const apiKey = env.ESL_TTS_PROVIDER_INWORLD_API_KEY || env.INWORLD_API_KEY;
  if (!apiKey) throw new Error('Inworld key is absent from the repository .env.');
  const require = createRequire(join(root, 'packages/tts-provider-inworld/package.json'));
  const { InworldTTS } = require('@inworld/tts');
  inworld = InworldTTS({ apiKey, maxRetries: 0, timeout: 180000 });
}

for (const sample of chosen) {
  const label = provider === 'google' ? model : 'inworld-tts-2';
  const prefix = `${sample.id}-${label}`;
  const metadataPath = join(out, `${prefix}.json`);
  if (existsSync(metadataPath)) {
    console.log(`${prefix}: already generated; preserved (no new charge)`);
    continue;
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const inputSha256 = sha256(JSON.stringify(sample.turns));
  let usage;
  let requestCount = 0;
  const voices =
    provider === 'google' ? { Alex: 'Puck', Maya: 'Kore' } : { Alex: 'Dennis', Maya: 'Ashley' };
  try {
    if (provider === 'google') {
      const speakers = [...new Set(sample.turns.map((turn) => turn.speaker))];
      const request = {
        contents: [
          {
            role: 'user',
            parts: sample.turns.map((turn) => ({
              text: turn.text,
              ...(speakers.length === 2 ? { speechMetadata: { speaker: turn.speaker } } : {}),
            })),
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig:
            speakers.length === 2
              ? {
                  multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: speakers.map((speaker) => ({
                      speaker,
                      voiceConfig: { voice: voices[speaker] },
                    })),
                  },
                }
              : { voiceConfig: { voice: voices[speakers[0]] } },
        },
      };
      writeFileSync(join(out, `${prefix}.request.json`), JSON.stringify(request, null, 2));
      const response = await fetch(
        `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(240000),
        },
      );
      requestCount++;
      const body = await response.json();
      if (!response.ok) {
        // Do not expose raw provider errors or credential-bearing request headers.
        const safe = {
          status: response.status,
          code: body.error?.status,
          message: String(body.error?.message ?? '')
            .replaceAll(token, '[REDACTED]')
            .slice(0, 1600),
        };
        writeFileSync(join(out, `${prefix}.failure.json`), JSON.stringify(safe, null, 2));
        throw new Error(`Google HTTP ${response.status}: ${safe.code}; see local failure record.`);
      }
      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const audioParts = parts.filter((part) => part.inlineData?.data);
      if (audioParts.length !== 1)
        throw new Error(`Expected one unary audio part, received ${audioParts.length}.`);
      const audio = Buffer.from(audioParts[0].inlineData.data, 'base64');
      if (audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE')
        throw new Error('Expected complete WAV output.');
      writeFileSync(join(out, `${prefix}.wav`), audio);
      usage = body.usageMetadata;
      writeFileSync(
        join(out, `${prefix}.response-metadata.json`),
        JSON.stringify(
          {
            usageMetadata: usage,
            modelVersion: body.modelVersion,
            responseId: body.responseId,
            finishReason: body.candidates[0].finishReason,
            mimeType: audioParts[0].inlineData.mimeType,
          },
          null,
          2,
        ),
      );
    } else {
      const parts = [];
      for (const [i, turn] of sample.turns.entries()) {
        const audio = await inworld.generate({
          text: turn.text,
          voice: voices[turn.speaker],
          model: 'inworld-tts-2',
          encoding: 'MP3',
          sampleRate: 24000,
          deliveryMode: 'BALANCED',
          language: 'en-US',
        });
        requestCount++;
        const mp3 = join(out, `${prefix}-turn-${i}.mp3`);
        const wav = join(out, `${prefix}-turn-${i}.wav`);
        writeFileSync(mp3, audio);
        command('ffmpeg', [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-i',
          mp3,
          '-ar',
          '24000',
          '-ac',
          '1',
          wav,
        ]);
        parts.push(wav);
        if (i < sample.turns.length - 1) {
          const gap = sample.turns[i + 1].speaker === turn.speaker ? '0.180' : '0.320';
          const silence = join(out, `${prefix}-gap-${i}.wav`);
          command('ffmpeg', [
            '-nostdin',
            '-v',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'anullsrc=r=24000:cl=mono',
            '-t',
            gap,
            silence,
          ]);
          parts.push(silence);
        }
      }
      const concatPath = join(out, `${prefix}.concat.txt`);
      writeFileSync(
        concatPath,
        parts
          .map((path) => `file '${path.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`)
          .join('\n'),
      );
      command('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatPath,
        '-c:a',
        'pcm_s16le',
        join(out, `${prefix}.wav`),
      ]);
    }
    const generationMs = Math.round(performance.now() - started);
    const wavPath = join(out, `${prefix}.wav`);
    // Same loudness target for the listening copies; retain original WAVs for inspection.
    const mp3Path = join(out, `${prefix}.mp3`);
    command('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-i',
      wavPath,
      '-af',
      'loudnorm=I=-18:TP=-1.5:LRA=11',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      '128k',
      mp3Path,
    ]);
    const media = probe(wavPath);
    const durationSeconds = Number(media.format.duration);
    const characters = sample.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    const outputTokens =
      usage?.candidatesTokensDetails?.find((detail) => detail.modality === 'AUDIO')?.tokenCount ??
      durationSeconds * 25;
    const inputTokens = usage?.promptTokenCount;
    const audioRate = model.includes('lite') ? 6 : 9;
    const estimatedUsd2026 =
      provider === 'google'
        ? (outputTokens * audioRate) / 1e6 + ((inputTokens ?? 0) * 0.5) / 1e6
        : (characters * 25) / 1e6;
    const result = {
      sample: sample.id,
      provider,
      model: label,
      startedAt,
      project: provider === 'google' ? project : undefined,
      inputSha256,
      voices,
      requestCount,
      generationMs,
      durationSeconds,
      media: media.streams,
      characters,
      usage,
      estimatedUsd2026,
      estimatedUsd2027: provider === 'google' ? estimatedUsd2026 * 2 : estimatedUsd2026,
      costBasis:
        provider === 'google'
          ? 'Audio output tokens (reported modality count, otherwise duration at 25/sec) plus reported text input, published list prices. Ancillary text output has no listed rate here. Not a billing receipt.'
          : 'Authored characters at $25/million; not an account invoice.',
      audioSha256: sha256(readFileSync(wavPath)),
      listeningFile: `${prefix}.mp3`,
      originalFile: `${prefix}.wav`,
      baseline:
        'Fixed voices, plain text, no planner or ranker. Inworld is per-turn with 320ms switch gaps; Google is one native request.',
    };
    writeFileSync(metadataPath, JSON.stringify(result, null, 2));
    console.log(
      `${prefix}: ${durationSeconds.toFixed(1)}s audio, ${generationMs}ms generation, ${requestCount} requests, estimated $${estimatedUsd2026.toFixed(5)}`,
    );
  } catch (error) {
    console.error(
      `${prefix}: ${provider === 'google' ? error.message : `Inworld failed (${error.name}); raw error suppressed.`}`,
    );
    process.exitCode = 1;
    break;
  }
}
