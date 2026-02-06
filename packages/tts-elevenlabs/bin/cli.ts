#!/usr/bin/env node
import { Command, InvalidOptionArgumentError } from 'commander';

import { buildStudyTextMp3 } from '../src/index.js';
import type { BuildStudyTextOptions } from '../src/types.js';

type TtsStrategy = NonNullable<BuildStudyTextOptions['ttsStrategy']>;

const parseTtsStrategy = (value: string): TtsStrategy => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'dialogue' || normalized === 'tts') {
    return normalized;
  }
  throw new InvalidOptionArgumentError(
    `Unknown TTS strategy "${value}". Use one of: auto, dialogue, tts.`,
  );
};

const parseDialogueStability = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidOptionArgumentError(
      `--dialogue-stability must be a number between 0 and 1 (got: ${value})`,
    );
  }
  return parsed;
};

const parseDialogueSeed = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidOptionArgumentError(`--dialogue-seed must be an integer (got: ${value})`);
  }
  return parsed;
};

interface CliOptions {
  md: string;
  voiceMap: string;
  out: string;
  preview?: boolean;
  force?: boolean;
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}

const program = new Command()
  .name('tts-elevenlabs')
  .description('Generate study-text audio using ElevenLabs')
  .requiredOption('--md <file>', 'Path to markdown file with study text')
  .requiredOption('--voice-map <file>', 'Path to voice mapping configuration (YAML/JSON)')
  .option('--out <dir>', 'Output directory', process.cwd())
  .option('--preview', 'Preview mode - do not generate audio')
  .option('--force', 'Force regeneration even if cached file exists')
  .option('--tts-strategy <strategy>', 'Strategy: auto, dialogue, or tts', parseTtsStrategy)
  .option('--dialogue-language <code>', 'Dialogue language code (e.g. en, es)')
  .option(
    '--dialogue-stability <value>',
    'Dialogue stability (0.0-1.0)',
    parseDialogueStability,
  )
  .option('--dialogue-seed <value>', 'Dialogue seed', parseDialogueSeed)
  .action(async (options: CliOptions) => {
    const result = await buildStudyTextMp3(options.md, {
      voiceMapPath: options.voiceMap,
      outPath: options.out,
      preview: Boolean(options.preview),
      force: Boolean(options.force),
      ttsStrategy: options.ttsStrategy,
      dialogueLanguage: options.dialogueLanguage,
      dialogueStability: options.dialogueStability,
      dialogueSeed: options.dialogueSeed,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

