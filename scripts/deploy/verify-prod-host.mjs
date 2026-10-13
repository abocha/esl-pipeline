import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionEnv, assertRuntimeSecrets, productionEnv } from './production-paths.mjs';

export function verifyFirewall(firewall, port) {
  if (!/^[0-9]{1,5}$/u.test(port ?? '') || Number(port) < 1 || Number(port) > 65535) return false;
  const rules = firewall.split('\n').filter((line) => /\bALLOW(?: IN)?\b/u.test(line));
  const allowedPorts = new Set([port, '80', '443']);
  const safeRules =
    rules.length > 0 &&
    rules.every((line) => {
      const match = line.match(/^([0-9]+)\/tcp(?: \(v6\))?\s+ALLOW(?: IN)?\s+/u);
      return match && allowedPorts.has(match[1]);
    });
  return (
    /Status: active/u.test(firewall) &&
    /Default: deny \(incoming\), allow \(outgoing\), disabled \(routed\)/u.test(firewall) &&
    safeRules &&
    [...allowedPorts].every((p) => rules.some((line) => line.startsWith(`${p}/tcp `)))
  );
}

function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/u, '');
  const checks = [];
  function check(id, category, passed, requirement) {
    checks.push({ id, category, passed: Boolean(passed), requirement });
  }
  function run(command, args) {
    try {
      return execFileSync(command, args, {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  }
  function metadata(file, uid, gid, mode, directory = true) {
    try {
      const stat = lstatSync(file);
      return (
        !stat.isSymbolicLink() &&
        (directory ? stat.isDirectory() : stat.isFile()) &&
        stat.uid === uid &&
        stat.gid === gid &&
        (stat.mode & 0o7777) === mode
      );
    } catch {
      return false;
    }
  }
  function json(file) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
  check(
    'config-directory',
    'bootstrap',
    metadata('/etc/esl-pipeline', 0, 0, 0o750),
    'Protected production configuration directory',
  );
  check(
    'checkout',
    'bootstrap',
    root === '/opt/esl-pipeline',
    'Reviewed checkout at /opt/esl-pipeline',
  );
  check(
    'platform',
    'bootstrap',
    /\bID=ubuntu\b/u.test(readFileSync('/etc/os-release', 'utf8')) &&
      /VERSION_ID="24\.04"/u.test(readFileSync('/etc/os-release', 'utf8')),
    'Ubuntu 24.04 LTS',
  );
  check('systemd', 'bootstrap', existsSync('/run/systemd/system'), 'Running systemd manager');
  for (const directory of [
    'deploy',
    'deploy/backups',
    'deploy/backups/postgres',
    'ops',
    'ops/backups',
    'ops/backups/postgres',
    'ops/backups/postgres/remote-restore',
    'ops/logs',
    'ops/reports',
    'ops/run',
    'ops/state',
  ]) {
    const file = `/var/lib/esl-pipeline/${directory}`;
    check(file, 'bootstrap', metadata(file, 0, 0, 0o750), 'Root-owned directory, mode 0750');
  }
  check(
    'state-root',
    'bootstrap',
    metadata('/var/lib/esl-pipeline', 0, 0, 0o750),
    'Root-owned state root, mode 0750',
  );
  check(
    'checkout-permissions',
    'bootstrap',
    metadata(root, 0, 0, 0o750),
    'Root-owned checkout directory, mode 0750',
  );
  for (const directory of ['uploads', 'uploads/drafts', '.secrets']) {
    check(
      directory,
      'bootstrap',
      metadata(`${root}/${directory}`, directory === '.secrets' ? 0 : 1000, 1000, 0o750),
      'Mode 0750; uploads 1000:1000, secrets root:1000 for rootless backend',
    );
  }
  for (const pkg of [
    'docker.io',
    'docker-compose-v2',
    'unzip',
    'gnupg',
    'ufw',
    'openssh-server',
    'logrotate',
    'ca-certificates',
    'curl',
    'git',
    'jq',
    'xz-utils',
  ]) {
    check(
      pkg,
      'bootstrap',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg-query format, not JavaScript interpolation
      run('dpkg-query', ['-W', '-f=${Status}', pkg]) === 'install ok installed',
      `Ubuntu package ${pkg}`,
    );
  }
  check(
    'aws-cli',
    'bootstrap',
    /^aws-cli\/2\./u.test(run('aws', ['--version']) ?? ''),
    'AWS CLI v2; installer archive signature checked against repository-owned upstream signing key',
  );
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(
    'node',
    'bootstrap',
    major === 24 && minor >= 15,
    'Node 24.15+; fresh installation pinned by .nvmrc',
  );
  check(
    'compose-v2',
    'bootstrap',
    /^Docker Compose version v?2\./u.test(run('docker', ['compose', 'version']) ?? ''),
    'Docker Compose v2 plugin',
  );
  const docker = run('docker', ['info', '--format', '{{json .}}']);
  let dockerInfo;
  try {
    dockerInfo = JSON.parse(docker);
  } catch {
    dockerInfo = null;
  }
  check(
    'docker-active',
    'bootstrap',
    Boolean(dockerInfo) && run('systemctl', ['is-enabled', 'docker.service']) === 'enabled',
    'Local Docker daemon available and enabled',
  );
  const daemon = json('/etc/docker/daemon.json');
  check(
    'docker-log-config',
    'bootstrap',
    daemon?.['log-driver'] === 'json-file' &&
      daemon?.['log-opts']?.['max-size'] === '10m' &&
      daemon?.['log-opts']?.['max-file'] === '5',
    'Daemon defaults: json-file, max-size 10m, max-file 5',
  );
  // Docker reports the live driver; retention options are checked in its configuration. Apply refuses to change logging under an active daemon.
  check(
    'docker-log-driver',
    'bootstrap',
    dockerInfo?.LoggingDriver === 'json-file',
    'Live Docker daemon uses json-file; restart explicitly if existing daemon differs',
  );
  const journal = run('systemd-analyze', ['cat-config', 'systemd/journald.conf']) ?? '';
  function lastSetting(name) {
    return [...journal.matchAll(new RegExp(`^${name}=(.*)$`, 'gmu'))].at(-1)?.[1];
  }
  check(
    'journal-retention',
    'bootstrap',
    lastSetting('Storage') === 'persistent' &&
      lastSetting('SystemMaxUse') === '256M' &&
      lastSetting('MaxRetentionSec') === '1month',
    'Effective journald configuration: persistent, 256M, 1month',
  );
  for (const name of [
    'esl-postgres-backup',
    'esl-postgres-artifact-integrity',
    'esl-postgres-restore-drill',
    'esl-postgres-ops-alert',
    'esl-host-runtime-health',
  ]) {
    for (const extension of ['service', 'timer']) {
      const unit = `${name}.${extension}`;
      let matches = false;
      try {
        matches =
          metadata(`/etc/systemd/system/${unit}`, 0, 0, 0o644, false) &&
          readFileSync(`${root}/deploy/systemd/${unit}`).equals(
            readFileSync(`/etc/systemd/system/${unit}`),
          );
      } catch {
        /* recorded below */
      }
      check(unit, 'bootstrap', matches, 'Installed unit equals repository source, root:root 0644');
    }
    check(
      `${name}.enabled`,
      'bootstrap',
      run('systemctl', ['is-enabled', `${name}.timer`]) === 'enabled',
      'Timer enabled; activation is separately authorized deployment work',
    );
  }
  const port = process.argv[2];
  check(
    'ssh-listener',
    'operator',
    (run('ss', ['-H', '-ltn']) ?? '')
      .split('\n')
      .some((line) => line.split(/\s+/u)[3]?.endsWith(`:${port}`)),
    'The operator-approved SSH TCP port must be listening; bootstrap does not choose or change sshd configuration',
  );
  const firewall = run('ufw', ['status', 'verbose']) ?? '';
  check(
    'host-firewall',
    'operator',
    verifyFirewall(firewall, port),
    'Operator must preserve tested SSH access and configure UFW deny incoming, allow outgoing, routed disabled; only approved SSH TCP port and TCP 80/443 allowed. Bootstrap never edits/enables UFW. Docker published ports bypass UFW: retain repository loopback bindings.',
  );
  const envPath = productionEnv;
  let trustedEnv = false;
  let trustedSecrets = false;
  try {
    assertProductionEnv(envPath, root);
    trustedEnv = true;
  } catch {}
  try {
    assertRuntimeSecrets(root);
    trustedSecrets = true;
  } catch {}
  check(
    'trusted-config-paths',
    'operator',
    trustedEnv && trustedSecrets,
    'Protect all ancestors, tracked privileged code and runtime-only secrets; no backups or symlinks in secrets mount',
  );
  check(
    'external-env',
    'operator',
    trustedEnv && metadata(envPath, 0, 0, 0o600, false) && lstatSync(envPath).size > 0,
    'Provision nonempty root:root 0600 /etc/esl-pipeline/production.env securely; host scripts source it as shell code. Validate production values through existing env checklist before deployment.',
  );
  const googlePath = `${root}/.secrets/google-service-account.json`;
  check(
    'google-secret-permissions',
    'operator',
    !lstatSync(googlePath, { throwIfNoEntry: false }) ||
      metadata(googlePath, 0, 1000, 0o640, false),
    'If Google service-account auth is enabled, provision root:1000 0640 JSON here; absent file requires operator decision per provider configuration.',
  );
  const bootstrapComplete = checks
    .filter((item) => item.category === 'bootstrap')
    .every((item) => item.passed);
  const externalInputsPresent = checks
    .filter((item) => item.category === 'operator')
    .every((item) => item.passed);
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        bootstrapComplete,
        externalInputsPresent,
        productionReadiness: 'not-assessed',
        deploymentStatePresent: existsSync('/var/lib/esl-pipeline/deploy/current-images.env'),
        checks,
        nextStep:
          'Resolve operator checks and validate environment/provider/IAM/edge inputs in the deployment runbook. Separately authorize deployment or replacement-host recovery and timer activation. This verifies no database, backup, credentials, DNS, public reachability, or working application.',
      },
      null,
      2,
    ),
  );
  process.exitCode = bootstrapComplete ? (externalInputsPresent ? 0 : 2) : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
