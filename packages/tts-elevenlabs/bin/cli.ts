#!/usr/bin/env node
import { buildStudyTextMp3 } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const md = flag('--md');
const voiceMap = flag('--voice-map');
const out = flag('--out') ?? process.cwd();
const preview = args.includes('--preview');

if (!md || !voiceMap) {
  console.error('Usage: tts-elevenlabs --md <file.md> --voice-map voices.json --out ./out [--preview]');
  process.exit(1);
}

buildStudyTextMp3(md, { voiceMapPath: voiceMap, outPath: out, preview })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
