import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('PR CI exposes scoped evidence jobs and an always-running aggregate gate', () => {
  assert.match(ci, /^ {2}change-scope:/mu);
  assert.match(ci, /^ {2}ci-gate:/mu);
  assert.match(jobBlock('ci-gate'), /if: \$\{\{ always\(\) \}\}/u);
  assert.doesNotMatch(ci, /if: \$\{\{ needs\.change-scope\.outputs\.[a-z_]+ \}\}/u);

  for (const [job, scope] of [
    ['build-code-quality', 'runtime'],
    ['unit-component', 'runtime'],
    ['deterministic-integration-media', 'integration'],
    ['backend-db-integration', 'backend_db_worker'],
    ['telegram-compose-smoke', 'telegram'],
    ['production-backend-packaging', 'production_backend'],
  ]) {
    const block = jobBlock(job);
    assert.match(block, /needs: change-scope/u, `${job} must need change-scope`);
    assert.match(
      block,
      new RegExp(
        `if: \\$\\{\\{ fromJSON\\(needs\\.change-scope\\.outputs\\.${scope}\\) \\}\\}`,
        'u',
      ),
      `${job} must use an explicit Boolean condition`,
    );
    assert.match(jobBlock('ci-gate'), new RegExp(`- ${job}(?:\\n|$)`, 'u'));
  }

  assert.match(jobBlock('ci-gate'), /- change-scope(?:\n|$)/u);
  assert.match(jobBlock('ci-gate'), /- repository-policy(?:\n|$)/u);
  assert.doesNotMatch(jobBlock('repository-policy'), /^ {4}(?:needs|if):/mu);

  const scope = jobBlock('change-scope');
  assert.match(scope, /maintenance_only: \$\{\{ steps\.scope\.outputs\.maintenance_only \}\}/u);
  assert.match(
    scope,
    /production_backend: \$\{\{ steps\.projection\.outputs\.production_backend \}\}/u,
  );
  const combine = namedStep(scope, 'Combine bootstrap and projection');
  assert.match(
    combine,
    /MAINTENANCE_ONLY: \$\{\{ steps\.projection\.outputs\.maintenance_only \}\}/u,
  );
  assert.match(combine, /maintenance_only=false/u);
  assert.match(combine, /maintenance_only=\$MAINTENANCE_ONLY/u);
});

test('CI keeps one manifest-guarded PostgreSQL and Redis service job', () => {
  const serviceJob = jobBlock('backend-db-integration');

  assert.match(serviceJob, /postgres:\s*\n\s+image: postgres:18/u);
  assert.match(serviceJob, /redis:\s*\n\s+image: redis:8/u);
  assert.match(serviceJob, /test:db:migrations/u);
  assert.match(serviceJob, /test:db:postgres/u);
  assert.match(serviceJob, /test:integration:worker/u);
  assert.match(serviceJob, /if: always\(\)[\s\S]*backend-db-integration-artifacts/u);
});

for (const lane of [
  {
    job: 'repository-policy',
    directory: 'tmp/ci-logs/repository-policy',
    artifact: 'repository-policy-logs',
  },
  {
    job: 'build-code-quality',
    directory: 'tmp/ci-logs/build-code-quality',
    artifact: 'build-code-quality-logs',
  },
  {
    job: 'unit-component',
    directory: 'tmp/ci-logs/unit-component',
    artifact: 'unit-component-logs',
  },
  {
    job: 'deterministic-integration-media',
    directory: 'tmp/ci-logs/deterministic-integration-media',
    artifact: 'deterministic-integration-media-logs',
  },
]) {
  test(`${lane.artifact} retains actionable logs and a manifest`, () => {
    const job = jobBlock(lane.job);

    assert.match(job, /set -o pipefail/u);
    assert.match(job, new RegExp(escapeRegExp(lane.directory), 'u'));
    assert.match(job, /tee/u);
    assert.match(job, /manifest\.json/u);
    assert.match(job, /"command"/u);
    assert.match(job, /"conclusion"/u);
    assert.match(job, /"logPath"/u);
    assert.match(
      job,
      new RegExp(`if: always\\(\\)[\\s\\S]*name: ${escapeRegExp(lane.artifact)}`, 'u'),
    );
    assert.match(job, /retention-days: 14/u);
  });
}

test('bootstrap scope check is mechanically independent from the classifier', () => {
  const script = markedScript('ci-bootstrap');
  assert.doesNotMatch(script, /run-ci-scope/u);
  assert.doesNotMatch(script, /workspace-change-scope/u);
  assert.match(script, /git diff --name-status -z/u);
});

test('PR repository policy scopes only freshness age while keeping docs structure blocking', () => {
  const policy = jobBlock('repository-policy');
  const docsCheck = namedStep(policy, 'Docs sanity checks');
  const healthReport = namedStep(policy, 'Generate docs health report');

  assert.match(docsCheck, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(docsCheck, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(docsCheck, /pnpm docs:check:pr -- --from "\$BASE_SHA" --to "\$HEAD_SHA"/u);
  assert.match(
    healthReport,
    /pnpm docs:health:report -- --pr --from "\$BASE_SHA" --to "\$HEAD_SHA"/u,
  );
  assert.doesNotMatch(docsCheck, /pnpm docs:check(?!:pr)/u);
});

test('aggregate gate evaluator accepts only successful selected lanes', () => {
  const evaluator = markedScript('ci-gate-evaluator');
  const baseResults = {
    'change-scope': 'success',
    'repository-policy': 'success',
    'build-code-quality': 'success',
    'unit-component': 'success',
    'deterministic-integration-media': 'success',
    'backend-db-integration': 'success',
    'telegram-compose-smoke': 'success',
    'production-backend-packaging': 'success',
  };
  const allSelected = {
    runtime: 'true',
    integration: 'true',
    backend_db_worker: 'true',
    telegram: 'true',
    production_backend: 'true',
  };

  assert.equal(runEvaluator(evaluator, baseResults, allSelected), 0);
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'change-scope': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'repository-policy': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'build-code-quality': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'unit-component': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(
      evaluator,
      { ...baseResults, 'deterministic-integration-media': 'failure' },
      allSelected,
    ),
    0,
  );
  assert.notEqual(
    runEvaluator(
      evaluator,
      { ...baseResults, 'deterministic-integration-media': 'skipped' },
      allSelected,
    ),
    0,
  );
  assert.equal(
    runEvaluator(
      evaluator,
      { ...baseResults, 'deterministic-integration-media': 'skipped' },
      { ...allSelected, integration: 'false' },
    ),
    0,
  );
  assert.equal(
    runEvaluator(
      evaluator,
      { ...baseResults, 'build-code-quality': 'skipped', 'unit-component': 'skipped' },
      { ...allSelected, runtime: 'false' },
    ),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'telegram-compose-smoke': 'cancelled' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(
      evaluator,
      { ...baseResults, 'production-backend-packaging': 'failure' },
      allSelected,
    ),
    0,
  );

  const backendOnlySelected = {
    runtime: 'false',
    integration: 'false',
    backend_db_worker: 'true',
    telegram: 'false',
    production_backend: 'false',
  };
  const backendOnlyResults = {
    ...baseResults,
    'build-code-quality': 'skipped',
    'unit-component': 'skipped',
    'deterministic-integration-media': 'skipped',
    'telegram-compose-smoke': 'skipped',
    'production-backend-packaging': 'skipped',
  };

  assert.equal(runEvaluator(evaluator, backendOnlyResults, backendOnlySelected), 0);
  for (const outcome of ['failure', 'skipped', 'cancelled']) {
    assert.notEqual(
      runEvaluator(
        evaluator,
        { ...backendOnlyResults, 'backend-db-integration': outcome },
        backendOnlySelected,
      ),
      0,
      `selected backend DB/worker result ${outcome} must fail the gate`,
    );
  }
  const missingBackendResult = { ...backendOnlyResults };
  delete missingBackendResult['backend-db-integration'];
  assert.notEqual(
    runEvaluator(evaluator, missingBackendResult, backendOnlySelected),
    0,
    'missing selected backend DB/worker evidence must fail the gate',
  );
  assert.equal(
    runEvaluator(
      evaluator,
      { ...backendOnlyResults, 'backend-db-integration': 'skipped' },
      { ...backendOnlySelected, backend_db_worker: 'false' },
    ),
    0,
    'skipped backend DB/worker evidence is allowed when the scope is unselected',
  );

  const maintenanceOnlySelected = {
    runtime: 'false',
    integration: 'false',
    backend_db_worker: 'false',
    telegram: 'false',
    production_backend: 'false',
  };
  const maintenanceOnlyResults = {
    ...baseResults,
    'build-code-quality': 'skipped',
    'unit-component': 'skipped',
    'deterministic-integration-media': 'skipped',
    'backend-db-integration': 'skipped',
    'telegram-compose-smoke': 'skipped',
    'production-backend-packaging': 'skipped',
  };
  assert.equal(
    runEvaluator(evaluator, maintenanceOnlyResults, maintenanceOnlySelected),
    0,
    'maintenance-only scope may skip application evidence while repository policy succeeds',
  );
  assert.notEqual(
    runEvaluator(
      evaluator,
      { ...maintenanceOnlyResults, 'unit-component': 'failure' },
      maintenanceOnlySelected,
    ),
    0,
    'unexpected failure in an unselected lane must still fail the gate',
  );
});

test('unit/component lane keeps a conservative worker budget and measurement evidence', () => {
  const unit = jobBlock('unit-component');
  assert.match(unit, /UNIT_WORKSPACE_CONCURRENCY:\s*['"]2['"]/u);
  assert.match(unit, /UNIT_MAX_WORKERS:\s*['"]1['"]/u);
  assert.match(unit, /--workspace-concurrency="\$UNIT_WORKSPACE_CONCURRENCY"/u);
  assert.match(unit, /--maxWorkers="\$UNIT_MAX_WORKERS"/u);
  assert.match(unit, /nproc/u);
  assert.match(unit, /free -h/u);
  assert.match(unit, /\/usr\/bin\/time -v/u);
  assert.match(unit, /unit-resource-usage\.txt/u);
});

test('integration/media lane installs FFmpeg and runs backend media coverage', () => {
  const media = jobBlock('deterministic-integration-media');
  assert.match(media, /apt-get update/u);
  assert.match(media, /apt-get install --yes --no-install-recommends ffmpeg/u);
  assert.match(media, /pnpm test:integration/u);
  assert.match(media, /pnpm --filter @esl-pipeline\/batch-backend test:media/u);
  const stepNames = [...media.matchAll(/^ {6}- name: (.+)$/gmu)].map((match) => match[1]);
  const integrationIndex = stepNames.indexOf('Integration tests');
  assert.deepEqual(
    stepNames.slice(integrationIndex, integrationIndex + 3),
    [
      'Integration tests',
      'Install FFmpeg for recording media tests',
      'Backend recording media tests',
    ],
    'FFmpeg installation must run after deterministic integration and immediately before media',
  );
});

test('production backend packaging matches the release build path', () => {
  const packaging = jobBlock('production-backend-packaging');
  assert.match(packaging, /docker\/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c/u);
  assert.match(packaging, /docker\/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a/u);
  assert.match(packaging, /file: packages\/batch-backend\/Dockerfile/u);
  assert.match(packaging, /platforms: linux\/amd64/u);
  assert.match(packaging, /pull: true/u);
  assert.match(packaging, /push: false/u);
});

test('runtime lanes keep duplicated builds without sharding or matrix fanout', () => {
  assert.match(jobBlock('build-code-quality'), /pnpm build/u);
  assert.match(jobBlock('unit-component'), /pnpm build/u);
  assert.doesNotMatch(ci, /^\s+matrix:/mu);
  assert.doesNotMatch(ci, /--shard(?:=|\s)/u);
});

test('code-quality lint still reports when its build prerequisite fails', () => {
  const quality = jobBlock('build-code-quality');
  assert.match(namedStep(quality, 'Lint'), /^\s+if: always\(\)$/mu);
  assert.doesNotMatch(namedStep(quality, 'Typecheck'), /^\s+if: always\(\)$/mu);
});

test('diagnostics run weekly or manually and preserve producer failures', () => {
  const diagnostics = readFileSync(
    new URL('../../.github/workflows/ci-diagnostics.yml', import.meta.url),
    'utf8',
  );
  assert.match(diagnostics, /^ {2}schedule:/mu);
  assert.match(diagnostics, /cron: ['"]17 5 \* \* 1['"]/u);
  assert.match(diagnostics, /^ {2}workflow_dispatch:/mu);
  assert.doesNotMatch(diagnostics, /continue-on-error:/u);

  for (const [job, producerCommand, reportCommand, artifactPath] of [
    ['coverage-report', 'pnpm test:coverage:core', 'pnpm test:coverage:report', 'tmp/coverage'],
    ['unit-timings', 'pnpm test:timings:unit', 'pnpm test:timings:report', 'tmp/test-timings'],
  ]) {
    const block = workflowJobBlock(diagnostics, job);
    assert.match(block, /id: producer/u);
    assert.ok(block.includes(producerCommand));
    assert.ok(block.includes(reportCommand));
    assert.ok(block.includes(`path: ${artifactPath}`));
    for (const step of ['Generate', 'Upload', 'Fail when producer failed']) {
      assert.match(
        block,
        new RegExp(`- name: ${step}[^\\n]*\\n\\s+if: \\$\\{\\{ always\\(\\) \\}\\}`, 'u'),
      );
    }
    assert.match(block, /PRODUCER_OUTCOME: \$\{\{ steps\.producer\.outcome \}\}/u);
  }
});

test('static tooling bootstrap verifies bundled shellcheck before extracting verified actionlint', () => {
  const bootstrap = namedStep(jobBlock('repository-policy'), 'Verify repo hygiene tools');
  assert.doesNotMatch(bootstrap, /apt-get (?:update|install)/u);
  assert.match(bootstrap, /command -v shellcheck/u);
  assert.match(bootstrap, /shellcheck --version/u);
  assert.match(bootstrap, /actionlint_version=1\.7\.11/u);
  assert.match(
    bootstrap,
    /actionlint_archive="actionlint_\$\{actionlint_version\}_linux_amd64\.tar\.gz"/u,
  );
  assert.match(
    bootstrap,
    /https:\/\/github\.com\/rhysd\/actionlint\/releases\/download\/v\$\{actionlint_version\}\/\$\{actionlint_archive\}/u,
  );
  assert.match(
    bootstrap,
    /actionlint_sha256=900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a/u,
  );

  const dollar = '$';
  const archiveVariable = `${dollar}{actionlint_archive}`;
  const checksumVariable = `${dollar}{actionlint_sha256}`;
  const download = bootstrap.indexOf(`--output "$RUNNER_TEMP/${archiveVariable}"`);
  const verify = bootstrap.indexOf(
    `echo "${checksumVariable}  $RUNNER_TEMP/${archiveVariable}" | sha256sum --check`,
  );
  const extract = bootstrap.indexOf(
    `tar -xzf "$RUNNER_TEMP/${archiveVariable}" -C "$RUNNER_TEMP/actionlint-bin"`,
  );
  assert.ok(download >= 0 && download < verify && verify < extract);
});

test('tooling tests remain an unconditional static guard', () => {
  const step = namedStep(jobBlock('repository-policy'), 'Tooling tests');
  assert.match(step, /run: \|[\s\S]*pnpm test:tooling 2>&1 \| tee/u);
  assert.doesNotMatch(step, /^\s+if:/mu);
});

test('diagnostic workflows use explicit concurrency and bounded artifact retention', () => {
  const diagnostics = readFileSync(
    new URL('../../.github/workflows/ci-diagnostics.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    diagnostics,
    /^concurrency:\n {2}group: ci-diagnostics-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/mu,
  );
  for (const [job, step] of [
    ['coverage-report', 'Upload coverage report artifact'],
    ['unit-timings', 'Upload unit timing artifact'],
  ]) {
    assert.match(namedStep(workflowJobBlock(diagnostics, job), step), /retention-days: 30/u);
  }

  for (const [job, step] of [
    ['repository-policy', 'Upload docs health artifact on failure'],
    ['backend-db-integration', 'Upload backend db + worker artifacts'],
    ['telegram-compose-smoke', 'Upload Telegram compose smoke artifacts'],
  ]) {
    assert.match(namedStep(jobBlock(job), step), /retention-days: 14/u);
  }
});

function jobBlock(job) {
  return workflowJobBlock(ci, job);
}

function workflowJobBlock(workflow, job) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `missing ${job} job`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9_-]+:$/u.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

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

function markedScript(marker) {
  const startToken = `${marker}:start`;
  const endToken = `${marker}:end`;
  const start = ci.indexOf(startToken);
  const end = ci.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `missing ${marker} start marker`);
  assert.notEqual(end, -1, `missing ${marker} end marker`);
  return ci
    .slice(start + startToken.length, end)
    .replace(/^\r?\n/u, '')
    .replace(/\r?\n\s*$/u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s{10}/u, ''))
    .join('\n');
}

function runEvaluator(script, results, scopes) {
  return spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      CI_RESULTS: JSON.stringify(results),
      CI_SCOPES: JSON.stringify(scopes),
    },
    encoding: 'utf8',
  }).status;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
