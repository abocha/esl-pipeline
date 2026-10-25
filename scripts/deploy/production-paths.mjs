import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { posix, resolve as nativeResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { dirname, isAbsolute, resolve } = posix;

export const productionEnv = '/etc/esl-pipeline/production.env';

// Check the entire path before reading or sourcing configuration. No secret values are read.
export function assertTrustedPath(
  path,
  { directory = false, gid = 0, mode, optional = false } = {},
  stat = lstatSync,
) {
  if (!isAbsolute(path) || resolve(path) !== path)
    throw new Error(`Expected canonical absolute path: ${path}`);
  let current = path;
  let leaf = true;
  while (true) {
    const entry = stat(current, { throwIfNoEntry: false });
    if (!entry) {
      if (!optional || !leaf) throw new Error(`Missing trusted path: ${current}`);
    } else {
      if (entry.isSymbolicLink() || !(leaf && !directory ? entry.isFile() : entry.isDirectory()))
        throw new Error(`Unsafe path type: ${current}`);
      if (entry.uid !== 0 || (entry.mode & 0o022) !== 0)
        throw new Error(`Path must be root-owned and not group/other writable: ${current}`);
      if (leaf && (entry.gid !== gid || (mode !== undefined && (entry.mode & 0o7777) !== mode)))
        throw new Error(`Unexpected ownership or permissions: ${current}`);
      if (leaf && !directory && entry.nlink !== 1)
        throw new Error(`Refusing multiply linked file: ${current}`);
    }
    if (current === dirname(current)) break;
    current = dirname(current);
    leaf = false;
  }
}

export function assertCheckout(root, { clean = false } = {}) {
  assertTrustedPath(root, { directory: true, mode: 0o750 });
  // Production is a root-owned ordinary clone; linked worktrees need operator reconciliation.
  assertTrustedPath(`${root}/.git`, { directory: true });
  function checkGitDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      assertTrustedPath(path, { directory: entry.isDirectory() });
      if (entry.isDirectory()) checkGitDirectory(path);
    }
  }
  checkGitDirectory(`${root}/.git`);
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  for (const file of tracked) assertTrustedPath(`${root}/${file}`);
  if (
    clean &&
    execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal'], {
      encoding: 'utf8',
    }).trim()
  )
    throw new Error(
      'Production checkout is unclean or partially updated; reconcile before deployment',
    );
  // Never require checkout HEAD to equal the selected published image SHA.
}

export function assertProductionEnv(env, root, { clean = false } = {}) {
  if (env !== productionEnv) throw new Error(`Production requires ${productionEnv}`);
  assertTrustedPath(env, { mode: 0o600 });
  if (lstatSync(env).size === 0) throw new Error('Production env is empty');
  assertCheckout(root, { clean });
}

export function assertRuntimeSecrets(root) {
  const directory = `${root}/.secrets`;
  assertTrustedPath(directory, { directory: true, gid: 1000, mode: 0o750 });
  for (const name of readdirSync(directory)) {
    if (name !== 'google-service-account.json')
      throw new Error(
        `Unexpected runtime secret entry: ${directory}/${name}; move operator backups outside runtime mounts`,
      );
    assertTrustedPath(`${directory}/${name}`, { gid: 1000, mode: 0o640 });
  }
}

export function assertDeployPaths(root, state, env = productionEnv) {
  assertProductionEnv(env, root, { clean: true });
  assertRuntimeSecrets(root);
  assertDeployState(state);
}

export function assertDeployState(state) {
  assertTrustedPath(state, { directory: true, mode: 0o750 });
  for (const name of [
    'current-images.env',
    'previous-images.env',
    'known-good-images.env',
    'deploy.lock',
    'deployments.log',
    'rollback-compatibility.json',
    'rollback-compatibility.json.tmp',
    'requested-migrations.json',
    'previous-migrations.json',
    'applied-migrations.json',
    'pending-compatibility.json',
    ...readdirSync(state).filter((name) => /^pending-[0-9a-f]{40}\.env$/u.test(name)),
  ])
    assertTrustedPath(`${state}/${name}`, { optional: true });
  assertTrustedPath(`${state}/backups`, { directory: true });
  assertTrustedPath(`${state}/backups/postgres`, { directory: true });
}

export function assertOpsState(state) {
  assertTrustedPath(state, { directory: true, mode: 0o750 });
  for (const name of [
    'backups',
    'backups/postgres',
    'backups/postgres/remote-restore',
    'logs',
    'reports',
    'run',
    'state',
  ])
    assertTrustedPath(`${state}/${name}`, { directory: true });
  for (const name of [
    'reports/artifact-integrity-report-latest.json',
    'reports/restore-drill-report-latest.json',
    'state/postgres-ops-alert-state.json',
    'state/host-runtime-health-alert-state.json',
  ])
    assertTrustedPath(`${state}/${name}`, { optional: true });
}

if (nativeResolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const [command, root, argument, env] = process.argv.slice(2);
    if (command === 'env') assertProductionEnv(argument, root);
    else if (command === 'checkout') assertCheckout(root, { clean: true });
    else if (command === 'deploy') assertDeployPaths(root, argument, env);
    else if (command === 'ops-state') assertOpsState(root);
    else
      throw new Error(
        'Usage: production-paths.mjs env|checkout|deploy <checkout> [env-or-state-path] [selected-env]; ops-state <state>',
      );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
