import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(
  new URL('../../.github/workflows/recover-release-image-bundle.yml', import.meta.url),
  'utf8',
);

test('release image recovery reuses selected manifests and verifies the complete bundle', () => {
  assert.match(recovery, /workflow_dispatch:/u);
  assert.match(recovery, /--prefer-index=false/u);
  for (const target of ['batch-backend', 'batch-frontend', 'telegram-ops-bot']) {
    assert.match(recovery, new RegExp(`reuse_${target.replaceAll('-', '_')}:`, 'u'));
    assert.match(recovery, new RegExp(`verify_image ${target}`, 'u'));
  }
});
