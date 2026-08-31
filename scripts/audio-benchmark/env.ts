import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkEnvFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.env.audio-benchmark.local',
);

export function loadBenchmarkEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  let fileContents = '';
  try {
    fileContents = readFileSync(benchmarkEnvFile, 'utf8');
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error('Unable to read .env.audio-benchmark.local.');
    }
  }
  return mergeBenchmarkEnvironment(fileContents, environment);
}

export function mergeBenchmarkEnvironment(
  fileContents: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const processValues = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
  return { ...parseBenchmarkEnv(fileContents), ...processValues };
}

export function parseBenchmarkEnv(fileContents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, line] of fileContents.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) throw new Error(`Invalid benchmark env assignment on line ${index + 1}.`);
    values[match[1]!] = unquoteEnvValue(match[2]!);
  }
  return values;
}

function unquoteEnvValue(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
