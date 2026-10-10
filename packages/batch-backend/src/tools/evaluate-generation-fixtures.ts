import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  GENERATION_EVAL_FIXTURE_VERSION,
  GENERATION_EVAL_FIXTURES,
} from '../application/generation-eval-fixtures.js';
import {
  assertLiveGenerationEvalAccess,
  createBudgetedGenerationEvalExecutor,
  runGenerationEval,
} from '../application/generation-evaluator.js';
import { executeOpenAiStructuredGeneration } from '../application/generation-providers.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { closePgPool } from '../infrastructure/db.js';

const live = process.argv.includes('--live');
const reportFlag = process.argv.find((arg) => arg.startsWith('--report='));
const defaultReport = resolve(
  process.cwd(),
  'tmp',
  'generation-evals',
  `generation-eval-${new Date().toISOString().replaceAll(':', '-')}.json`,
);
const reportPath = reportFlag
  ? resolve(process.cwd(), reportFlag.slice('--report='.length))
  : defaultReport;

assertLiveGenerationEvalAccess({
  live,
  env: process.env,
  loadEnv: () => loadBatchBackendEnv(import.meta.url, 'generation-eval-cli'),
});

const config = loadConfig();
if (live && (!config.pg.enabled || config.nodeEnv === 'test')) {
  throw new Error(
    'Live generation evaluation requires PostgreSQL for shared daily-budget accounting.',
  );
}
const structured = createBudgetedGenerationEvalExecutor(config, ({ request }) =>
  executeOpenAiStructuredGeneration({ config: config.generation, request }),
);
const evaluation = await runGenerationEval({
  fixtures: GENERATION_EVAL_FIXTURES,
  live,
  structured,
}).finally(closePgPool);
const report = {
  version: GENERATION_EVAL_FIXTURE_VERSION,
  generatedAt: new Date().toISOString(),
  live,
  records: evaluation.records,
  verdict: evaluation.verdict,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(
  `${JSON.stringify({
    reportPath,
    live,
    fixtures: evaluation.records.length,
    verdict: evaluation.verdict.passed ? 'passed' : 'failed',
  })}\n`,
);
if (live && !evaluation.verdict.passed) {
  process.exitCode = 1;
}
