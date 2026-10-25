#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { loadApplicationEnv } from '@esl-pipeline/shared-infrastructure';

import { uploadFile } from '../src/index.js';

loadApplicationEnv({
  moduleUrl: import.meta.url,
  memoizeKey: 'storage-uploader-cli',
});

try {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      prefix: { type: 'string' },
      'public-read': { type: 'boolean' },
      presign: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(`Usage: storage-uploader [options]

Upload files to storage backends

Options:
  --file <path>        Local file to upload (required)
  --prefix <prefix>    Key prefix for uploaded file
  --public-read       Make the uploaded file publicly readable
  --presign <seconds>  Generate presigned URL with specified expiration in seconds
  -h, --help          Display help`);
  } else {
    if (!values.file) throw new Error("required option '--file <path>' not specified");
    const presign = values.presign === undefined ? undefined : Number(values.presign);
    if (presign !== undefined && (!Number.isSafeInteger(presign) || presign <= 0)) {
      throw new Error('--presign must be a positive integer number of seconds');
    }
    const result = await uploadFile(values.file, {
      backend: 's3',
      public: Boolean(values['public-read']),
      presignExpiresIn: presign,
      prefix: values.prefix,
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
