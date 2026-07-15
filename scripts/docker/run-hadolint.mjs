import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HADOLINT_IMAGE =
  'ghcr.io/hadolint/hadolint:v2.14.0@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e';

export function parseNullDelimitedPaths(value) {
  if (value === '') return [];
  if (!value.endsWith('\0')) {
    throw new Error('Git Dockerfile output must be null-delimited');
  }

  const paths = value.slice(0, -1).split('\0');
  if (paths.some((entry) => entry.length === 0)) {
    throw new Error('Git Dockerfile output contains an empty path');
  }

  return [...new Set(paths.map((entry) => entry.replace(/^\.\//u, '')))].sort();
}

export function buildGitDiscoveryInvocation({ repoRoot }) {
  return {
    command: 'git',
    args: ['ls-files', '-z', '--', ':(glob)**/Dockerfile*'],
    options: {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    },
  };
}

export function buildHadolintInvocation({ repoRoot, dockerfiles }) {
  if (dockerfiles.length === 0) {
    throw new Error('No tracked Dockerfiles found');
  }

  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '--mount',
      `type=bind,source=${repoRoot},target=/workspace,readonly`,
      '--workdir',
      '/workspace',
      HADOLINT_IMAGE,
      '/bin/hadolint',
      '--config',
      '.hadolint.yaml',
      '--no-color',
      ...dockerfiles,
    ],
  };
}

export function runHadolint({
  repoRoot,
  executeGit = spawnSync,
  spawn = spawnSync,
  log = console.log,
}) {
  const discovery = buildGitDiscoveryInvocation({ repoRoot });
  const gitResult = executeGit(discovery.command, discovery.args, discovery.options);
  if (gitResult.error) {
    throw new Error(`Git discovery failed: ${gitResult.error.message}`);
  }
  if (gitResult.status !== 0) {
    const detail = String(gitResult.stderr ?? '').trim();
    throw new Error(`Git discovery failed${detail ? `: ${detail}` : ''}`);
  }

  const dockerfiles = parseNullDelimitedPaths(String(gitResult.stdout ?? ''));
  if (dockerfiles.length === 0) {
    throw new Error('No tracked Dockerfiles found');
  }

  log(`[hadolint] linting ${dockerfiles.length} tracked Dockerfiles: ${dockerfiles.join(', ')}`);
  const invocation = buildHadolintInvocation({ repoRoot, dockerfiles });
  const result = spawn(invocation.command, invocation.args, {
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Docker failed to start: ${result.error.message}`);
  }
  if (!Number.isInteger(result.status)) {
    throw new Error(`Docker exited without a status${result.signal ? ` (${result.signal})` : ''}`);
  }
  return result.status;
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    process.exitCode = runHadolint({ repoRoot });
  } catch (error) {
    console.error(`[hadolint] error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
