#!/usr/bin/env node
import { Command } from 'commander';
import { loadCliEnv } from '@esl-pipeline/shared-infrastructure';

import { DEFAULT_VOICES_OUT, syncVoices } from '../src/syncVoices.js';

interface VoicesCliOptions {
  out: string;
}

loadCliEnv({
  moduleUrl: import.meta.url,
  memoizeKey: 'tts-voices-cli',
});

const program = new Command()
  .name('tts-voices')
  .description('Sync available ElevenLabs voices to a local JSON catalog')
  .option('--out <file>', 'Output file', DEFAULT_VOICES_OUT)
  .action(async (opts: VoicesCliOptions) => {
    const res = await syncVoices(opts.out);
    console.log(`Wrote ${res.count} voices to ${res.outPath}`);
  });

program.parse();
