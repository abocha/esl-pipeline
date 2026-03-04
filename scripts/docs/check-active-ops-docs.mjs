#!/usr/bin/env node
import { formatCheckResult, runDocsChecks } from './docs-check-lib.mjs';

const result = runDocsChecks('ops');
const output = formatCheckResult(result);

if (result.errors.length > 0) {
  console.error(output);
  process.exit(1);
}

console.log(output);
