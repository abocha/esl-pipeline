#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { uploadFile } from '../src/index.js';

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
  .action(async opts => {
    try {
      const result = await uploadFile(opts.file, {
        backend: 's3',
        public: opts.publicRead,
        presignExpiresIn: opts.presign,
        prefix: opts.prefix,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (e: any) {
      console.error(e?.message || String(e));
      process.exit(1);
    }
  });

program.parse();
