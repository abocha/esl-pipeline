import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const release = readFileSync(
  new URL('../../.github/workflows/release-on-merge.yml', import.meta.url),
  'utf8',
);
const recovery = readFileSync(
  new URL('../../.github/workflows/recover-release-image-bundle.yml', import.meta.url),
  'utf8',
);

function jobBlock(workflow, job) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${job}:`);
  assert.ok(start >= 0, `missing job ${job}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-zA-Z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

test('production image cache export failures do not block publication', () => {
  const images = jobBlock(release, 'publish-images');
  for (const target of ['batch-backend', 'batch-frontend', 'telegram-ops-bot']) {
    assert.match(
      images,
      new RegExp(`cache-to: type=gha,mode=max,scope=${target},ignore-error=true`, 'u'),
    );
  }
});

test('release image recovery reuses selected manifests and verifies the complete bundle', () => {
  assert.match(recovery, /workflow_dispatch:/u);
  assert.match(recovery, /--prefer-index=false/u);
  for (const target of ['batch-backend', 'batch-frontend', 'telegram-ops-bot']) {
    assert.match(recovery, new RegExp(`reuse_${target.replaceAll('-', '_')}:`, 'u'));
    assert.match(recovery, new RegExp(`verify_image ${target}`, 'u'));
  }
});
