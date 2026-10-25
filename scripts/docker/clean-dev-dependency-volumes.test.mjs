import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const helperPath = fileURLToPath(new URL('./clean-dev-dependency-volumes.mjs', import.meta.url));
const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

function createFixture({ listStatus = 0, removeStatus = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clean-dev-dependency-volumes-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const dockerStub = `
const fs = require('node:fs');
const args = process.platform === 'win32' ? ['volume', ...process.argv.slice(2)] : process.argv.slice(2);
const root = process.env.CLEAN_DEV_VOLUMES_TEST_DIR;
const scenario = JSON.parse(fs.readFileSync(root + '/scenario.json', 'utf8'));
fs.appendFileSync(root + '/events.jsonl', JSON.stringify(args) + '\\n');
if (args[0] !== 'volume') process.exit(64);
if (args[1] === 'ls') {
  if (scenario.listStatus) process.exit(scenario.listStatus);
  process.stdout.write(scenario.volumes.join('\\n') + '\\n');
  process.exit(0);
}
if (args[1] === 'rm') {
  process.stdout.write('fake docker rm\\n');
  process.exit(scenario.removeStatus || 0);
}
process.exit(65);
`;

  if (process.platform === 'win32') {
    // A copied Node executable gives spawnSync('docker') a real .exe while keeping the fake CLI
    // portable. Node executes the extensionless `volume` fixture as CommonJS from the fixture cwd.
    const dockerExecutable = join(bin, 'docker.exe');
    copyFileSync(process.execPath, dockerExecutable);
    const nodeDll = join(dirname(process.execPath), 'node.dll');
    if (existsSync(nodeDll)) copyFileSync(nodeDll, join(bin, 'node.dll'));
    writeFileSync(join(root, 'volume'), dockerStub);
  } else {
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env node\n${dockerStub}`, { mode: 0o755 });
  }

  const volumes = [
    'esl-pipeline_workspace_node_modules',
    'other_workspace_node_modules',
    'esl-pipeline_postgres_data',
    'esl-pipeline_uploads',
    'esl-pipeline_pkg_orchestrator_node_modules',
  ];
  writeFileSync(join(root, 'scenario.json'), JSON.stringify({ listStatus, removeStatus, volumes }));

  return { root, bin, volumes };
}

function runHelper(fixture, args = [], ambientProject = 'other') {
  const env = { ...process.env };
  env.PATH = `${fixture.bin}${delimiter}${process.env.PATH ?? ''}`;
  env.CLEAN_DEV_VOLUMES_TEST_DIR = fixture.root;
  env.COMPOSE_PROJECT_NAME = ambientProject;
  return spawnSync(process.execPath, [helperPath, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env,
  });
}

function readEvents(fixture) {
  const path = join(fixture.root, 'events.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

test('package cleanup alias pins both stop and volume cleanup to esl-pipeline', () => {
  const scripts = rootPackage.scripts;
  assert.match(scripts['docker:dev:down'], /compose -p esl-pipeline/u);
  assert.equal(
    scripts['docker:dev:clean-deps'],
    'pnpm docker:dev:down && node scripts/docker/clean-dev-dependency-volumes.mjs --project-name esl-pipeline',
  );
});

test('explicit project selection overrides ambient Compose project and removes allowlisted volumes only', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runHelper(fixture, ['--project-name', 'esl-pipeline']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /esl-pipeline_workspace_node_modules/u);
  assert.match(result.stdout, /esl-pipeline_pkg_orchestrator_node_modules/u);
  assert.doesNotMatch(result.stdout, /other_workspace_node_modules|postgres_data|uploads/u);
  assert.deepEqual(readEvents(fixture), [
    ['volume', 'ls', '--format', '{{.Name}}'],
    [
      'volume',
      'rm',
      'esl-pipeline_workspace_node_modules',
      'esl-pipeline_pkg_orchestrator_node_modules',
    ],
  ]);
  assert.ok(
    result.stdout.indexOf('esl-pipeline_pkg_orchestrator_node_modules') <
      result.stdout.indexOf('fake docker rm'),
    'candidate volumes are listed before Docker removal starts',
  );
});

test('standalone helper continues to honor COMPOSE_PROJECT_NAME', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runHelper(fixture, [], 'other');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readEvents(fixture), [
    ['volume', 'ls', '--format', '{{.Name}}'],
    ['volume', 'rm', 'other_workspace_node_modules'],
  ]);
});

test('volume listing failure stops before removal and propagates Docker failure', (t) => {
  const fixture = createFixture({ listStatus: 17 });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runHelper(fixture, ['--project-name', 'esl-pipeline']);

  assert.equal(result.status, 17);
  assert.match(result.stderr, /Unable to list Docker volumes/u);
  assert.deepEqual(readEvents(fixture), [['volume', 'ls', '--format', '{{.Name}}']]);
});

test('volume removal failure remains nonzero after printing exact candidates', (t) => {
  const fixture = createFixture({ removeStatus: 23 });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runHelper(fixture, ['--project-name', 'esl-pipeline']);

  assert.equal(result.status, 23);
  assert.ok(
    result.stdout.indexOf('esl-pipeline_pkg_orchestrator_node_modules') <
      result.stdout.indexOf('fake docker rm'),
  );
  assert.match(result.stderr, /Failed to remove one or more dependency volumes/u);
});
