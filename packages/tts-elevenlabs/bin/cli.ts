#!/usr/bin/env node
import { buildStudyTextMp3 } from '../src/index.js';

const args = process.argv.slice(2);

// Helper to get flag value
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
};

// Helper to check if flag exists
const hasFlag = (name: string) => args.includes(name);

// Parse required flags
const md = flag('--md');
const voiceMap = flag('--voice-map');
const out = flag('--out') ?? process.cwd();
const preview = hasFlag('--preview');
const force = hasFlag('--force');

// Parse TTS strategy flags
const ttsStrategy = flag('--tts-strategy') ?? flag('-s');
const dialogueLanguage = flag('--dialogue-language');
const dialogueStability = flag('--dialogue-stability');
const dialogueSeed = flag('--dialogue-seed');

// Show help if requested
if (hasFlag('--help') || hasFlag('-h')) {
  console.log(String.raw`
Usage: tts-elevenlabs --md <file.md> --voice-map <voices.json> [options]

Required:
  --md <file>              Path to markdown file with study text
  --voice-map <file>       Path to voice mapping configuration (YAML/JSON)

Options:
  --out <dir>              Output directory (default: current directory)
  --preview                Preview mode - don't generate audio
  --force                  Force regeneration even if cached file exists
  
TTS Strategy Options:
  --tts-strategy, -s <strategy>  Strategy selection (default: auto)
                                Values: auto, dialogue, tts
                                - auto: choose based on content heuristics
                                - dialogue: force Text-to-Dialogue (Eleven v3)
                                - tts: force Text-to-Speech (configurable model)
  
  --dialogue-language <code>    Language code for dialogue mode (ISO 639-1)
                                Examples: en, es, fr, de
  
  --dialogue-stability <num>    Voice stability for dialogue mode (0-1)
                                Higher = more consistent, lower = more expressive
  
  --dialogue-seed <num>         Seed for deterministic dialogue generation
                                Use same seed for reproducible output

Examples:
  # Auto-detect mode based on content
  $ tts-elevenlabs --md lesson.md --voice-map voices.yml

  # Force dialogue strategy
  $ tts-elevenlabs --md lesson.md --voice-map voices.yml --tts-strategy dialogue

  # Force TTS strategy
  $ tts-elevenlabs --md lesson.md --voice-map voices.yml --tts-strategy tts

  # Dialogue mode with custom settings
  $ tts-elevenlabs --md lesson.md --voice-map voices.yml \
    --tts-strategy dialogue --dialogue-language en --dialogue-stability 0.7

  # Reproducible dialogue generation
  $ tts-elevenlabs --md lesson.md --voice-map voices.yml \
    --tts-strategy dialogue --dialogue-seed 42
`);
  process.exit(0);
}

// Validate required flags
if (!md || !voiceMap) {
  console.error('Error: --md and --voice-map are required\n');
  console.error('Run with --help for usage information');
  process.exit(1);
}

// Validate TTS strategy
if (ttsStrategy && !['auto', 'dialogue', 'tts'].includes(ttsStrategy)) {
  console.error(
    `Error: --tts-strategy must be one of: auto, dialogue, tts (got: ${ttsStrategy})`,
  );
  process.exit(1);
}

// Validate dialogue stability
let parsedStability: number | undefined;
if (dialogueStability !== undefined) {
  parsedStability = Number(dialogueStability);
  if (Number.isNaN(parsedStability) || parsedStability < 0 || parsedStability > 1) {
    console.error(
      `Error: --dialogue-stability must be a number between 0 and 1 (got: ${dialogueStability})`,
    );
    process.exit(1);
  }
}

// Validate dialogue seed
let parsedSeed: number | undefined;
if (dialogueSeed !== undefined) {
  parsedSeed = Number(dialogueSeed);
  if (Number.isNaN(parsedSeed) || !Number.isInteger(parsedSeed)) {
    console.error(`Error: --dialogue-seed must be an integer (got: ${dialogueSeed})`);
    process.exit(1);
  }
}

// Build options object
const options = {
  voiceMapPath: voiceMap,
  outPath: out,
  preview,
  force,
  ...(ttsStrategy && { ttsStrategy: ttsStrategy as 'auto' | 'dialogue' | 'tts' }),
  ...(dialogueLanguage && { dialogueLanguage }),
  ...(parsedStability !== undefined && { dialogueStability: parsedStability }),
  ...(parsedSeed !== undefined && { dialogueSeed: parsedSeed }),
};

buildStudyTextMp3(md, options)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
