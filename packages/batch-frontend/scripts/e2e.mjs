import { spawnSync } from 'node:child_process';

function runPlaywright(args) {
  const result = spawnSync('npx', ['playwright', ...args], {
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

const extraArgs = process.argv.slice(2);
const sanitizedArgs = extraArgs[0] === '--' ? extraArgs.slice(1) : extraArgs;

if (sanitizedArgs.length > 0) {
  const status = runPlaywright(['test', ...sanitizedArgs]);
  process.exit(status);
}

const gateCode = runPlaywright(['test', '--project=chromium', '--project=webkit']);
runPlaywright(['test', '--project=firefox']);
process.exit(gateCode);
