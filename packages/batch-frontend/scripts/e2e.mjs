import { spawnSync } from 'node:child_process';

function runPlaywright(args) {
  const result = spawnSync('npx', ['playwright', ...args], {
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

const gateCode = runPlaywright(['test', '--project=chromium', '--project=webkit']);

runPlaywright(['test', '--project=firefox']);

process.exit(gateCode);
