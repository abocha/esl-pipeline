// packages/batch-backend/src/infrastructure/ttdg-runner.ts
import { spawn } from 'node:child_process';

export interface TtdgRunConfig {
  command: string;
  workdir: string;
  cwd?: string;
  extraArgs?: string;
}

export interface TtdgRunResult {
  outputs: string[];
  rawSummary: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

export async function runTtdg({
  command,
  workdir,
  cwd,
  extraArgs,
}: TtdgRunConfig): Promise<TtdgRunResult> {
  if (!command || command.trim().length === 0) {
    throw new Error('TTDG command is not configured');
  }

  const sanitizedWorkdir = workdir.trim();
  if (!sanitizedWorkdir) {
    throw new Error('TTDG workdir is empty');
  }

  const args = [extraArgs, '--json-summary', '--workdir', `"${sanitizedWorkdir}"`]
    .filter(Boolean)
    .join(' ');
  const fullCommand = `${command} ${args}`.trim();

  return await new Promise((resolve, reject) => {
    const child = spawn(fullCommand, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ttdg failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
        return;
      }

      const rawSummary = extractJsonSummary(stdout);
      if (!rawSummary) {
        reject(
          new Error(
            `Unable to parse ttdg --json-summary output${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
        return;
      }

      const outcomes = Array.isArray(rawSummary.outcomes) ? rawSummary.outcomes : [];
      const outputs = outcomes
        .map((outcome) => {
          if (!outcome || typeof outcome !== 'object') return null;
          if (outcome.success !== true) return null;
          return typeof outcome.output === 'string' ? outcome.output : null;
        })
        .filter((value): value is string => value !== null && value !== '');

      resolve({ outputs, rawSummary, stdout, stderr });
    });
  });
}

function extractJsonSummary(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace === -1) return null;

  for (let start = trimmed.lastIndexOf('{', lastBrace); start >= 0; ) {
    const candidate = trimmed.slice(start, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try earlier brace.
    }
    start = trimmed.lastIndexOf('{', start - 1);
  }

  return null;
}
