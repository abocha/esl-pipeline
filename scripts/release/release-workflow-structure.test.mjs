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
  assert.match(decision, /ref: main/u);
  assert.match(decision, /resolve-release-bump-from-pr\.mjs/u);
  assert.match(decision, /--changed-files "\$\{RELEASE_CHANGED_FILES\}"/u);
  assert.match(decision, /--json/u);
  assert.match(decision, /should_release/u);

  const releaseJob = jobBlock(release, 'release');
  assert.match(releaseJob, /needs: release-decision/u);
  assert.match(releaseJob, /needs\.release-decision\.outputs\.should_release == 'true'/u);
});

test('production images remain coupled to a successful release job', () => {
  const images = jobBlock(release, 'publish-images');
  assert.match(images, /needs: release/u);
  assert.match(images, /RELEASE_SHA: \$\{\{ needs\.release\.outputs\.release_sha \}\}/u);
  assert.match(images, /RELEASE_TAG: \$\{\{ needs\.release\.outputs\.release_tag \}\}/u);
});
