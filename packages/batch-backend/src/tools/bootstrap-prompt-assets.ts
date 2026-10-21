import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTemplateAsset } from '../application/import-template-asset.js';
import { resolveRepoPath } from '../application/prompt-assembly.js';
import { getPromptOptions } from '../application/prompt-options.js';
import { scanTemplateAssets } from '../application/template-assets.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { loadConfig } from '../config/env.js';
import {
  getTemplateById,
  listTemplates,
  setTemplateActiveRevision,
} from '../domain/template-repository.js';
import {
  activateTemplateRevision,
  deprecateActiveTemplateRevision,
  getLatestTemplateRevisionByHash,
} from '../domain/template-revision-repository.js';
import { closePgPool } from '../infrastructure/db.js';

const PROMPT_EXTENSIONS = new Set(['.md', '.txt']);

interface CliOptions {
  dryRun: boolean;
}

interface ScannedAsset {
  id: string;
  absolutePath: string;
  content: string;
  hash: string;
  label: string;
}

interface BootstrapStats {
  scannedFiles: number;
  templatesDiscovered: number;
  createdRevisions: number;
  reusedRevisions: number;
  activatedRevisions: number;
  retiredTemplates: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
  };

  for (const arg of argv) {
    if (!arg || arg === '--') continue;
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizePromptId(id: string): string {
  const normalized = path.posix
    .normalize(id.replaceAll('\\', '/').replace(/^\/+/, '').trim())
    .trim();

  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('Discovered prompt file with invalid id.');
  }
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('Discovered prompt file outside prompt root.');
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!PROMPT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported prompt extension for ${normalized}`);
  }

  return normalized;
}

function resolveConfiguredRoot(configuredPath: string, type: 'template'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new Error(`PROMPT_${type.toUpperCase()}_PATH must be configured.`);
  }

  const candidate = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : resolveRepoPath(configuredPath);

  return path.dirname(candidate);
}

function resolveConfiguredDefaultId(configuredPath: string, type: 'template'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new Error(`PROMPT_${type.toUpperCase()}_PATH must be configured.`);
  }

  const normalized = configuredPath.replaceAll('\\', '/').trim();
  return normalizePromptId(path.posix.basename(normalized));
}

export async function scanAssets(params: { templateRoot: string }): Promise<{
  templates: ScannedAsset[];
  scannedFiles: number;
}> {
  const templates = await scanTemplateAssets(path.resolve(params.templateRoot));
  return { templates, scannedFiles: templates.length };
}

export async function importTemplates(
  assets: ScannedAsset[],
  dryRun: boolean,
  stats: BootstrapStats,
): Promise<void> {
  for (const asset of assets) {
    const existing = await getTemplateById(asset.id);

    const byHash = await getLatestTemplateRevisionByHash(asset.id, asset.hash);
    let revisionId = byHash?.id ?? null;

    if (!dryRun) revisionId = (await importTemplateAsset(asset)).id;

    if (byHash) {
      stats.reusedRevisions += 1;
    } else {
      stats.createdRevisions += 1;
    }

    if (!existing?.activeRevisionId && revisionId) {
      if (!dryRun) {
        await activateTemplateRevision(asset.id, revisionId);
        await setTemplateActiveRevision(asset.id, revisionId);
      }
      stats.activatedRevisions += 1;
    }
  }
}

async function retireMissingTemplateAssets(
  activeTemplateIds: readonly string[],
  dryRun: boolean,
  stats: BootstrapStats,
): Promise<void> {
  if (activeTemplateIds.length === 0) {
    return;
  }

  let offset = 0;
  const allowlist = new Set(activeTemplateIds);

  while (true) {
    const listed = await listTemplates({
      limit: 500,
      offset,
      order: 'asc',
    });

    for (const template of listed.items) {
      if (!template.activeRevisionId) continue;
      if (allowlist.has(template.id)) continue;

      if (!dryRun) {
        await deprecateActiveTemplateRevision(template.id);
        await setTemplateActiveRevision(template.id, null);
      }
      stats.retiredTemplates += 1;
    }

    offset += listed.items.length;
    if (offset >= listed.total || listed.items.length === 0) {
      break;
    }
  }
}

function printSummary(params: {
  mode: 'dry-run' | 'apply';
  stats: BootstrapStats;
  templateRoot: string;
  defaultTemplateId: string;
}): void {
  console.log(`[prompt-assets-bootstrap] mode=${params.mode}`);
  console.log(`[prompt-assets-bootstrap] templateRoot=${params.templateRoot}`);
  console.log(`[prompt-assets-bootstrap] defaultTemplateId=${params.defaultTemplateId}`);
  console.log(`[prompt-assets-bootstrap] scannedFiles=${params.stats.scannedFiles}`);
  console.log(`[prompt-assets-bootstrap] templatesDiscovered=${params.stats.templatesDiscovered}`);
  console.log(`[prompt-assets-bootstrap] createdRevisions=${params.stats.createdRevisions}`);
  console.log(`[prompt-assets-bootstrap] reusedRevisions=${params.stats.reusedRevisions}`);
  console.log(`[prompt-assets-bootstrap] activatedRevisions=${params.stats.activatedRevisions}`);
  console.log(`[prompt-assets-bootstrap] retiredTemplates=${params.stats.retiredTemplates}`);
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-bootstrap-prompt-assets');
  configureHostRunPgRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (config.orchestrator.configProvider !== 'local') {
    throw new Error(
      'Prompt assets bootstrap requires local config provider (ESL_PIPELINE_CONFIG_PROVIDER=local).',
    );
  }

  if (!config.pg.enabled) {
    throw new Error('Prompt assets bootstrap requires Postgres (PG_ENABLED=true).');
  }

  const templateRoot = resolveConfiguredRoot(config.prompt.templatePath, 'template');
  const defaultTemplateId = resolveConfiguredDefaultId(config.prompt.templatePath, 'template');

  const scanned = await scanAssets({ templateRoot });
  const stats: BootstrapStats = {
    scannedFiles: scanned.scannedFiles,
    templatesDiscovered: scanned.templates.length,
    createdRevisions: 0,
    reusedRevisions: 0,
    activatedRevisions: 0,
    retiredTemplates: 0,
  };

  if (scanned.templates.length === 0) {
    throw new Error(
      'No template assets discovered. Ensure template files exist under template root.',
    );
  }

  const hasDefaultTemplate = scanned.templates.some((item) => item.id === defaultTemplateId);

  if (!hasDefaultTemplate) {
    throw new Error(`Configured defaults were not discovered (template=${defaultTemplateId}).`);
  }

  let stage = 'import-or-activation';
  try {
    await importTemplates(scanned.templates, options.dryRun, stats);
    stage = 'retirement';
    await retireMissingTemplateAssets(
      scanned.templates.map((item) => item.id),
      options.dryRun,
      stats,
    );

    printSummary({
      mode: options.dryRun ? 'dry-run' : 'apply',
      stats,
      templateRoot,
      defaultTemplateId,
    });

    if (options.dryRun) {
      const dryDefaultTemplate = stats.templatesDiscovered > 0 ? defaultTemplateId : null;
      console.log(
        `[prompt-assets-bootstrap] projectedReadiness templateDefault=${dryDefaultTemplate}`,
      );
      return;
    }

    stage = 'readiness';
    const promptOptions = await getPromptOptions({ config });
    if (!promptOptions.defaults.templateId) {
      throw new Error(
        'Bootstrap finished but defaults are not active in DB. Verify prompt files and rerun bootstrap.',
      );
    }

    console.log(
      `[prompt-assets-bootstrap] readiness=ok templateDefault=${promptOptions.defaults.templateId}`,
    );
  } catch (error) {
    if (options.dryRun) throw error;
    throw new Error(
      `operation_failed: stage=${stage} confirmed createdRevisions=${stats.createdRevisions} reusedRevisions=${stats.reusedRevisions} activatedRevisions=${stats.activatedRevisions} retiredTemplates=${stats.retiredTemplates}. ` +
        'The failing operation outcome is unknown and may include persisted changes. ' +
        'Read persisted template/revision state and rerun the same bootstrap; imported revisions remain available for supported activation recovery.',
      { cause: error },
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[prompt-assets-bootstrap] failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePgPool();
    });
}
