import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyBackendTests,
  readBackendTestRouting,
  validateBackendTestRouting,
} from '../test/backend-test-routing-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const testsDir = path.join(repoRoot, 'packages', 'batch-backend', 'tests');
const backendPackage = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'batch-backend', 'package.json'), 'utf8'),
);
const testFiles = discoverTestFiles(testsDir);
const sourceImports = Object.fromEntries(
  testFiles.map((file) => [file, readFileSync(path.join(testsDir, file), 'utf8')]),
);

test('every backend test has one operational route matched by package scripts', () => {
  const routing = readBackendTestRouting(repoRoot);
  const classifications = classifyBackendTests({ testFiles, routing });
  const violations = validateBackendTestRouting({
    classifications,
    backendScripts: backendPackage.scripts,
    sourceImports,
  });

  assert.deepEqual(violations, [], violations.join('\n'));
});

function discoverTestFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.posix.join(prefix, entry.name);
      return entry.isDirectory()
        ? discoverTestFiles(path.join(directory, entry.name), relativePath)
        : [relativePath];
    })
    .filter((file) => file.endsWith('.test.ts'))
    .sort();
}
