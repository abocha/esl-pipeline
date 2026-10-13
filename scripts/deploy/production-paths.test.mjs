import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCheckout,
  assertDeployPaths,
  assertDeployState,
  assertProductionEnv,
  assertRuntimeSecrets,
  assertTrustedPath,
} from './production-paths.mjs';

function metadata({
  uid = 0,
  gid = 0,
  mode = 0o755,
  directory = true,
  link = false,
  nlink = 1,
} = {}) {
  return {
    uid,
    gid,
    mode,
    nlink,
    isDirectory: () => directory,
    isFile: () => !directory,
    isSymbolicLink: () => link,
  };
}
const env = '/etc/esl-pipeline/production.env';
function safeStat(path) {
  return metadata(path === env ? { mode: 0o600, directory: false } : {});
}

test('trusted path validates each ancestor and accepts root-only env and runtime-readable key metadata', () => {
  const visited = [];
  assertTrustedPath(env, { mode: 0o600 }, (path) => {
    visited.push(path);
    return safeStat(path);
  });
  assert.deepEqual(visited, [env, '/etc/esl-pipeline', '/etc', '/']);
  assertTrustedPath('/opt/esl-pipeline/.secrets/key.json', { gid: 1000, mode: 0o640 }, (path) =>
    metadata(path.endsWith('.json') ? { gid: 1000, mode: 0o640, directory: false } : {}),
  );
});

test('trusted path fails closed for replacement, redirection and unexpected permissions', () => {
  for (const [path, entry] of [
    [env, metadata({ directory: false, mode: 0o600, uid: 1000 })],
    [env, metadata({ directory: false, mode: 0o640 })],
    [env, metadata({ directory: false, mode: 0o600, link: true })],
    [env, metadata({ directory: false, mode: 0o600, nlink: 2 })],
    [env, metadata({ mode: 0o600 })],
    ['/etc/esl-pipeline', metadata({ uid: 1000 })],
    ['/etc/esl-pipeline', metadata({ mode: 0o775 })],
    ['/etc', metadata({ link: true })],
    ['/', metadata({ mode: 0o777 })],
    ['/etc/esl-pipeline', undefined],
  ])
    assert.throws(() =>
      assertTrustedPath(env, { mode: 0o600 }, (current) =>
        current === path ? entry : safeStat(current),
      ),
    );
  assert.throws(() => assertTrustedPath('relative.env'));
  assert.throws(() => assertTrustedPath('/etc/../etc/esl-pipeline/production.env'));
  assert.throws(
    () => assertProductionEnv('/opt/esl-pipeline/.env', '/opt/esl-pipeline'),
    /Production requires/,
  );
});

test('missing optional state leaf still requires a trusted parent', () => {
  assertTrustedPath(env, { optional: true }, (path) => (path === env ? undefined : safeStat(path)));
  assert.throws(() =>
    assertTrustedPath(env, { optional: true }, (path) =>
      path === env ? undefined : metadata({ uid: 1000 }),
    ),
  );
});

const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;
test(
  'Linux ownership, git cleanliness and runtime secret guard exercise real filesystem paths',
  { skip: !linuxRoot },
  (t) => {
    const root = mkdtempSync('/opt/esl53-guard-');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    chmodSync(root, 0o750);
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init');
    writeFileSync(join(root, 'script.sh'), '# reviewed code\n', { mode: 0o644 });
    git('add', 'script.sh');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-m',
      'fixture',
    );
    assertCheckout(root, { clean: true });
    // Image selection has no equality constraint on checkout HEAD.
    writeFileSync(join(root, 'script.sh'), '# partial pull\n');
    assert.throws(() => assertCheckout(root, { clean: true }), /unclean/);
    git('checkout', '--', 'script.sh');
    chmodSync(join(root, 'script.sh'), 0o664);
    assert.throws(() => assertCheckout(root), /writable/);
    chmodSync(join(root, 'script.sh'), 0o644);
    chownSync(join(root, 'script.sh'), 1000, 1000);
    assert.throws(() => assertCheckout(root), /root-owned/);
    chownSync(join(root, 'script.sh'), 0, 0);
    chmodSync(join(root, '.git/config'), 0o666);
    assert.throws(() => assertCheckout(root), /writable/);
    chmodSync(join(root, '.git/config'), 0o644);

    const secrets = join(root, '.secrets');
    mkdirSync(secrets, { mode: 0o750 });
    chownSync(secrets, 0, 1000);
    const key = join(secrets, 'google-service-account.json');
    writeFileSync(key, '{}', { mode: 0o640 });
    chownSync(key, 0, 1000);
    assertRuntimeSecrets(root);
    const probeCredential = () =>
      spawnSync(
        process.execPath,
        [
          '-e',
          `
      const fs = require('node:fs');
      if (process.getuid() !== 1000 || process.getgid() !== 1000) process.exit(2);
      try {
        fs.accessSync(process.argv[1], fs.constants.R_OK);
        try { fs.accessSync(process.argv[1], fs.constants.W_OK); process.exit(1); }
        catch { process.exit(0); }
      } catch { process.exit(1); }
    `,
          key,
        ],
        { uid: 1000, gid: 1000 },
      );
    // Host checkout is root-only. Runtime accesses the bind-mounted directory without traversing it.
    assert.equal(probeCredential().status, 1);
    chmodSync(root, 0o751);
    assert.equal(probeCredential().status, 0);
    chmodSync(root, 0o750);
    writeFileSync(join(secrets, '.env.backup'), 'fixture-only\n');
    assert.throws(() => assertRuntimeSecrets(root), /Unexpected runtime secret/);
    rmSync(join(secrets, '.env.backup'));
    rmSync(key);
    symlinkSync('/etc/passwd', key);
    assert.throws(() => assertRuntimeSecrets(root), /Unsafe path type/);
  },
);
