import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url);
const selfPath = 'scripts/check/no-legacy-pronunciation-helper.test.mjs';
const forbiddenPatterns = [
  ['edge', '-tts'].join(''),
  ['EDGE', '_TTS'].join(''),
  ['ESL', '_EDGE', '_TTS'].join(''),
  ['Edge', ' TTS'].join(''),
];

function listTrackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

test('repo no longer contains legacy pronunciation helper integration references', () => {
  const violations = [];

  for (const file of listTrackedFiles()) {
    if (file === selfPath) continue;

    const target = new URL(file, repoRoot);
    if (!existsSync(target)) continue;

    const contents = readFileSync(target, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (contents.includes(pattern)) {
        violations.push(`${file}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
