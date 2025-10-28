#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, type OptionValues } from 'commander';
import { uploadFile } from '../src/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();

const repoEnvPath = resolve(moduleDir, '../../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

const program = new Command()
  .name('storage-uploader')
  .description('Upload files to storage backends')
  .requiredOption('--file <path>', 'Local file to upload')
  .option('--prefix <prefix>', 'Key prefix for uploaded file')
  .option('--public-read', 'Make the uploaded file publicly readable')
  .option(
    '--presign <seconds>',
    'Generate presigned URL with specified expiration in seconds',
    parseInt
  )
  .action(async (opts: OptionValues) => {
    try {
      const result = await uploadFile(opts.file as string, {
        backend: 's3',
        public: !!opts.publicRead,
        presignExpiresIn: opts.presign as number | undefined,
        prefix: opts.prefix as string | undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error((e as Error)?.message ?? String(e));
      process.exit(1);
    }
  });

// In ESM you can top-level await:
await program.parseAsync();
