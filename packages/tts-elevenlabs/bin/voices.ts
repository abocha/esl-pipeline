#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { syncVoices } from '../src/syncVoices.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();
const repoEnvPath = resolve(moduleDir, '../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

const program = new Command()
  .name('tts-voices')
  .description('Sync available ElevenLabs voices to a local JSON catalog')
  .option('--out <file>', 'Output file', 'configs/elevenlabs.voices.json')
  .action(async opts => {
    const res = await syncVoices(opts.out);
    console.log(`Wrote ${res.count} voices to ${res.outPath}`);
  });

program.parse();
