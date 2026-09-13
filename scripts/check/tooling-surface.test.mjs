import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const frontendPkg = JSON.parse(
  readFileSync(new URL('packages/batch-frontend/package.json', root), 'utf8'),
);
const backendPkg = JSON.parse(
  readFileSync(new URL('packages/batch-backend/package.json', root), 'utf8'),
);
const biomeConfig = JSON.parse(readFileSync(new URL('biome.json', root), 'utf8'));
const prettierConfig = JSON.parse(readFileSync(new URL('.prettierrc.json', root), 'utf8'));
const frontendViteConfig = readFileSync(
  new URL('packages/batch-frontend/vite.config.ts', root),
  'utf8',
);

const retiredFiles = [
  'scripts/deps/safe-upgrade.mjs',
  'scripts/deps/pin-shared-deps.mjs',
  'scripts/deps/README.md',
  'scripts/check/run-agent-check-fast.mjs',
  'scripts/test/run-agent-vitest.mjs',
  'scripts/check/affected-check-lib.mjs',
  'scripts/check/affected-check-lib.test.mjs',
  'scripts/check/agent-check-lib.mjs',
  'scripts/check/execution-lane-lib.mjs',
  'scripts/check/full-check-lib.mjs',
  'scripts/check/run-affected-check.mjs',
  'scripts/check/run-affected-check-lib.mjs',
  'scripts/check/run-full-check.mjs',
  'scripts/test/agent-vitest-lib.mjs',
  'scripts/test/run-agent-vitest-lane.mjs',
  'scripts/docker/prepare-host-paths.sh',
  'scripts/setup-agent-env.sh',
  'scripts/git/gh-auth-from-env.sh',
  'eslint.config.js',
];

const retiredScripts = [
  'deps:check',
  'deps:pin',
  'deps:upgrade:safe',
  'docker:backup',
  'docker:dev',
  'docker:dev:build',
  'docs:gardening',
  'hadolint',
  'smoke',
  'test:env',
  'test:timings:frontend',
  'test:topo',
  'lint:eslint:specialized',
  'check',
  'check:agent',
  'check:fast',
  'check:fast:agent',
  'check:fast:dry-run',
  'check:pre-pr',
  'check:pre-pr:agent',
  'test:check-routing',
  'test:unit:prebuilt:fast',
  'test:unit:prebuilt:fast:agent',
  'test:agent:html-publisher',
  'test:backend:db:worker:agent',
  'test:integration:prebuilt:agent',
  'test:unit:agent',
  'test:unit:prebuilt:agent',
];

test('retired tooling files and aliases stay absent', () => {
  for (const file of retiredFiles) {
    assert.equal(existsSync(new URL(file, root)), false, file);
  }
  for (const script of retiredScripts) {
    assert.equal(pkg.scripts[script], undefined, script);
  }
});

test('canonical replacements remain available', () => {
  for (const script of [
    'deps:audit',
    'deps:audit:strict',
    'docker:db:backup',
    'docker:up',
    'docker:up:build',
    'docs:garden',
    'test:timings:unit',
  ]) {
    assert.equal(typeof pkg.scripts[script], 'string', script);
  }
});

test('focused and hosted tooling surfaces remain available without local aggregate aliases', () => {
  assert.equal(pkg.scripts['test:tooling'], 'node --test "scripts/**/*.test.mjs"');
  assert.equal(typeof pkg.scripts['test:unit'], 'string');
  assert.equal(typeof pkg.scripts['test:unit:prebuilt'], 'string');
  assert.equal(
    pkg.scripts['test:backend:db:worker'],
    'node scripts/test/run-backend-db-worker-check.mjs',
  );
});

test('docker lint composes the canonical compose and Dockerfile lanes', () => {
  assert.equal(
    pkg.scripts['docker:lint'],
    'pnpm docker:lint:compose && pnpm docker:lint:dockerfiles',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose'],
    'dclint docker-compose.yml docker-compose.prod.yml --max-warnings 0',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose:fix'],
    'dclint docker-compose.yml docker-compose.prod.yml --fix',
  );
  assert.equal(pkg.scripts['docker:lint:dockerfiles'], 'node scripts/docker/run-hadolint.mjs');
});

test('Biome owns code and package-manifest tooling while Prettier remains docs-only', () => {
  for (const dependency of [
    '@eslint-react/eslint-plugin',
    '@vitest/eslint-plugin',
    'eslint',
    'eslint-config-prettier',
    'eslint-plugin-react-refresh',
    'globals',
    'prettier-plugin-packagejson',
    'typescript-eslint',
  ]) {
    assert.equal(pkg.devDependencies[dependency], undefined, dependency);
  }
  assert.equal(pkg.devDependencies['@biomejs/biome'], '2.5.13');
  assert.equal(pkg.scripts['lint:eslint:specialized'], undefined);
  assert.match(pkg.scripts['format:biome'], /assist-enabled=true/u);
  assert.doesNotMatch(pkg.scripts['format:prettier'], /package\.json/u);
  assert.doesNotMatch(pkg.scripts['format:prettier:write'], /package\.json/u);
  assert.equal(frontendPkg.devDependencies.eslint, undefined);
  assert.doesNotMatch(frontendPkg.scripts.lint, /eslint/u);
  assert.doesNotMatch(backendPkg.scripts.lint, /eslint/u);
  assert.equal(prettierConfig.plugins, undefined);
});

test('Biome config keeps the intentional React, hook, and test protections', () => {
  assert.equal(biomeConfig.assist.actions.source.useSortedPackageJson.level, 'on');
  assert.equal(biomeConfig.linter.rules.correctness.useExhaustiveDependencies, 'warn');
  assert.deepEqual(biomeConfig.linter.rules.style.useComponentExportOnlyModules, {
    level: 'warn',
    options: { allowConstantExport: true },
  });
  assert.equal(biomeConfig.linter.rules.suspicious.noFocusedTests, 'error');
  assert.equal(biomeConfig.linter.rules.suspicious.noSkippedTests, 'warn');
  assert.equal(biomeConfig.linter.rules.nursery.noConditionalExpect, 'warn');
  assert.equal(biomeConfig.linter.rules.nursery.noIdenticalTestTitle, 'error');
  assert.equal(
    biomeConfig.overrides.find((override) =>
      override.includes.includes('packages/batch-frontend/src/context/**/*.{ts,tsx}'),
    ).linter.rules.style.useComponentExportOnlyModules,
    'off',
  );
});

test('frontend Vite config has no dead Vitest test configuration', () => {
  assert.match(frontendViteConfig, /from 'vite'/u);
  assert.doesNotMatch(frontendViteConfig, /vitest\/config/u);
  assert.doesNotMatch(frontendViteConfig, /^\s*test:\s*\{/mu);
  assert.doesNotMatch(frontendViteConfig, /eslint-disable/u);
});
