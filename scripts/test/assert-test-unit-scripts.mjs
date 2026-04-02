#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const packagesRoot = path.join(repoRoot, 'packages');
const testFilePattern = /\.(integration\.)?test\.(ts|tsx)$/u;

function hasTestFiles(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'dist' || entry.name === 'node_modules') {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (testFilePattern.test(entry.name)) {
        return true;
      }
    }
  }

  return false;
}

const packages = readdirSync(packagesRoot)
  .map((name) => path.join(packagesRoot, name))
  .filter((pkgPath) => statSync(pkgPath).isDirectory());

const failures = [];

for (const packagePath of packages) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  if (!existsSync(packageJsonPath) || !hasTestFiles(packagePath)) {
    continue;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.scripts?.['test:unit']) {
    failures.push(path.relative(repoRoot, packageJsonPath));
  }
}

if (failures.length > 0) {
  console.error(
    [
      'Packages with test files must define a "test:unit" script:',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`[test:unit guard] validated ${packages.length} packages`);
