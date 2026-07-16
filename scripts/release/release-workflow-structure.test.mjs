import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guard = readFileSync(
  new URL('../../.github/workflows/release-label-guard.yml', import.meta.url),
  'utf8',
);
const release = readFileSync(
  new URL('../../.github/workflows/release-on-merge.yml', import.meta.url),
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

function assertChangedFileCollection(workflowBlock) {
  assert.match(workflowBlock, /actions\/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd/u);
  assert.match(workflowBlock, /github\.paginate\(github\.rest\.pulls\.listFiles/u);
  assert.match(
    workflowBlock,
    /expectedFileCount:\s*context\.payload\.pull_request\.changed_files/u,
  );
  assert.match(workflowBlock, /previous_filename/u);
  assert.match(workflowBlock, /RELEASE_CHANGED_FILES/u);
}

test('release label guard validates release:none against complete PR file records', () => {
  assert.match(guard, /^  pull-requests: read$/mu);
  const job = jobBlock(guard, 'validate-release-label');
  assertChangedFileCollection(job);
  assert.match(job, /--changed-files "\$\{RELEASE_CHANGED_FILES\}"/u);
});

test('merge workflow revalidates policy before deciding whether to release', () => {
  const decision = jobBlock(release, 'release-decision');
  assertChangedFileCollection(decision);
  assert.doesNotMatch(decision, /name: Collect release policy file records\n\s+if:/u);
  assert.match(decision, /ref: main/u);
  assert.match(decision, /resolve-release-bump-from-pr\.mjs/u);
  assert.match(decision, /--changed-files "\$\{RELEASE_CHANGED_FILES\}"/u);
  assert.match(decision, /--json/u);
  assert.match(decision, /should_release/u);
  assert.match(decision, /resolve-production-image-scope\.mjs/u);
  assert.match(decision, /build_backend/u);
  assert.match(decision, /build_frontend/u);
  assert.match(decision, /build_bot/u);

  const releaseJob = jobBlock(release, 'release');
  assert.match(releaseJob, /needs: release-decision/u);
  assert.match(releaseJob, /needs\.release-decision\.outputs\.should_release == 'true'/u);
});

test('production images remain coupled to a successful release job', () => {
  const images = jobBlock(release, 'publish-images');
  assert.match(images, /needs: \[release-decision, release\]/u);
  assert.match(images, /RELEASE_SHA: \$\{\{ needs\.release\.outputs\.release_sha \}\}/u);
  assert.match(images, /RELEASE_TAG: \$\{\{ needs\.release\.outputs\.release_tag \}\}/u);
  assert.match(images, /PREVIOUS_TAG: \$\{\{ needs\.release\.outputs\.previous_tag \}\}/u);
});

test('production images use pinned Docker actions and preserve a complete release bundle', () => {
  const images = jobBlock(release, 'publish-images');
  assert.match(images, /docker\/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c/u);
  assert.match(images, /docker\/login-action@af1e73f918a031802d376d3c8bbc3fe56130a9b0/u);
  assert.match(images, /docker\/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a/u);
  for (const target of ['batch-backend', 'batch-frontend', 'telegram-ops-bot']) {
    assert.match(images, new RegExp(`scope=${target}`, 'u'));
  }
  assert.match(images, /docker buildx imagetools create/u);
  assert.match(images, /docker buildx imagetools create\s+\\\s+--prefer-index=false/u);
  assert.match(images, /PREVIOUS_TAG/u);
});
