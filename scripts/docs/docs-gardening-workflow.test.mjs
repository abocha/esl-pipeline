import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/docs-gardening.yml', import.meta.url),
  'utf8',
);

test('gardening preserves the complete report set for thirty days', () => {
  const upload = namedStep(workflow, 'Upload docs gardening artifacts');
  assert.deepEqual(
    upload
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('tmp/')),
    [
      'tmp/docs-gardening.json',
      'tmp/docs-gardening-issue.json',
      'tmp/docs-gardening-issue.md',
      'tmp/docs-health-report.json',
      'tmp/docs-health-report.md',
      'tmp/docs-plan-lifecycle.json',
      'tmp/docs-plan-lifecycle.md',
      'tmp/docs-stale-active.json',
      'tmp/docs-stale-active.md',
    ],
  );
  assert.match(upload, /retention-days: 30/u);
});

test('rolling issue lookup paginates through repository history', () => {
  const update = namedStep(workflow, 'Update rolling docs-gardening issue');
  assert.match(update, /const issues = await github\.paginate\(github\.rest\.issues\.listForRepo/u);
  assert.match(update, /const existing = issues\.find/u);
  assert.match(update, /!candidate\.pull_request/u);
  assert.doesNotMatch(update, /const \{ data: issues \} = await/u);
});

function namedStep(block, name) {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const indent = lines[start].match(/^\s*/u)[0].length;
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      line.match(/^\s*/u)[0].length === indent &&
      line.trim().startsWith('- name:'),
  );
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}
