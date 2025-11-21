#!/usr/bin/env node
import { Command } from 'commander';

import { syncVoices } from '../src/syncVoices.js';

interface VoicesCliOptions {
  out: string;
}

const program = new Command()
  .name('tts-voices')
  .description('Sync available ElevenLabs voices to a local JSON catalog')
  .option('--out <file>', 'Output file', 'configs/elevenlabs.voices.json')
  .action(async (opts: VoicesCliOptions) => {
    const res = await syncVoices(opts.out);
    console.log(`Wrote ${res.count} voices to ${res.outPath}`);
  });

program.parse();
