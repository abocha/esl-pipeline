import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoPath } from '../application/prompt-assembly.js';
import { getPromptOptions } from '../application/prompt-options.js';
import { scanTemplateAssets } from '../application/template-assets.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { loadConfig } from '../config/env.js';
import { getProfileById, upsertProfile } from '../domain/profile-repository.js';
import {
  activateProfileRevision,
  getLatestProfileRevisionByHash,
  insertProfileRevision,
} from '../domain/profile-revision-repository.js';
import {
  getTemplateById,
  listTemplates,
  setTemplateActiveRevision,
  upsertTemplate,
} from '../domain/template-repository.js';
import {
  activateTemplateRevision,
  deprecateActiveTemplateRevision,
  getLatestTemplateRevisionByHash,
  insertTemplateRevision,
} from '../domain/template-revision-repository.js';
import { closePgPool } from '../infrastructure/db.js';

const PROMPT_EXTENSIONS = new Set(['.md', '.txt']);
const LEGACY_PROFILE_MARKER = 'INSERT PROFILE HERE';

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
  profilesDiscovered: number;
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

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function formatLabel(id: string): string {
  const base = path.basename(id, path.extname(id));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : id;
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

function resolveConfiguredRoot(configuredPath: string, type: 'template' | 'profile'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new Error(`PROMPT_${type.toUpperCase()}_PATH must be configured.`);
  }

  const candidate = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : resolveRepoPath(configuredPath);

  return path.dirname(candidate);
}

function resolveConfiguredDefaultId(configuredPath: string, type: 'template' | 'profile'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new Error(`PROMPT_${type.toUpperCase()}_PATH must be configured.`);
  }

  const normalized = configuredPath.replaceAll('\\', '/').trim();
  return normalizePromptId(path.posix.basename(normalized));
}

function assertDistinctRoots(templateRoot: string, profileRoot: string): void {
  const resolvedTemplateRoot = path.resolve(templateRoot);
  const resolvedProfileRoot = path.resolve(profileRoot);
  const overlap =
    isWithinRoot(resolvedTemplateRoot, resolvedProfileRoot) ||
    isWithinRoot(resolvedProfileRoot, resolvedTemplateRoot);
  if (!overlap) {
    return;
  }

  throw new Error(
    `Prompt template and profile roots must be distinct and non-overlapping (templateRoot=${resolvedTemplateRoot}, profileRoot=${resolvedProfileRoot}).`,
  );
}

async function collectPromptFiles(rootDir: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootDir);
  const stats = await fs.stat(resolvedRoot).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Prompt root does not exist: ${resolvedRoot}`);
  }

  const files: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PROMPT_EXTENSIONS.has(ext)) continue;
      files.push(path.resolve(candidate));
    }
  }

  await visit(resolvedRoot);
  return files;
}

function assertNoLegacyTemplateMarker(content: string, assetPath: string): void {
  if (!content.includes(LEGACY_PROFILE_MARKER)) {
    return;
  }

  throw new Error(
    `Template asset contains retired legacy marker ${LEGACY_PROFILE_MARKER}: ${assetPath}`,
  );
}

async function scanAssetRoot(
  rootDir: string,
  kind: 'template' | 'profile',
): Promise<ScannedAsset[]> {
  const files = await collectPromptFiles(rootDir);
  const assets: ScannedAsset[] = [];

  for (const absolutePath of files.sort((a, b) => a.localeCompare(b))) {
    const content = await fs.readFile(absolutePath, 'utf8');
    if (kind === 'template') {
      assertNoLegacyTemplateMarker(content, absolutePath);
    }

    const id = normalizePromptId(path.relative(rootDir, absolutePath).split(path.sep).join('/'));
    assets.push({
      id,
      absolutePath,
      content,
      hash: hashContent(content),
      label: formatLabel(id),
    });
  }

  return assets;
}

export async function scanAssets(params: { templateRoot: string; profileRoot: string }): Promise<{
  templates: ScannedAsset[];
  profiles: ScannedAsset[];
  scannedFiles: number;
}> {
  assertDistinctRoots(params.templateRoot, params.profileRoot);
  const [templates, profiles] = await Promise.all([
    scanTemplateAssets(path.resolve(params.templateRoot)),
    scanAssetRoot(path.resolve(params.profileRoot), 'profile'),
  ]);

  const discoveredFiles = new Set<string>([
    ...templates.map((item) => item.absolutePath),
    ...profiles.map((item) => item.absolutePath),
  ]);

  return {
    templates,
    profiles,
    scannedFiles: discoveredFiles.size,
  };
}

export async function importTemplates(
  assets: ScannedAsset[],
  dryRun: boolean,
  stats: BootstrapStats,
): Promise<void> {
  for (const asset of assets) {
    const existing = await getTemplateById(asset.id);
    const current = dryRun
      ? existing
      : await upsertTemplate({
          id: asset.id,
          label: existing?.label ?? asset.label,
          activeRevisionId: existing?.activeRevisionId ?? null,
        });

    const byHash = await getLatestTemplateRevisionByHash(asset.id, asset.hash);
    let revisionId = byHash?.id ?? null;

    if (byHash) {
      stats.reusedRevisions += 1;
    } else {
      stats.createdRevisions += 1;
      if (!dryRun) {
        const inserted = await insertTemplateRevision({
          templateId: asset.id,
          content: asset.content,
          contentHash: asset.hash,
          source: existing ? 'update' : 'create',
          // Insert as draft to avoid violating single-active constraints;
          // activation is handled explicitly below when needed.
          status: 'draft',
          createdBy: null,
          restoredFromRevisionId: null,
        });
        revisionId = inserted.id;
      }
    }

    if (!current?.activeRevisionId && revisionId) {
      stats.activatedRevisions += 1;
      if (!dryRun) {
        await activateTemplateRevision(asset.id, revisionId);
        await setTemplateActiveRevision(asset.id, revisionId);
      }
    }
  }
}

async function importProfiles(
  assets: ScannedAsset[],
  dryRun: boolean,
  stats: BootstrapStats,
): Promise<void> {
  for (const asset of assets) {
    const existing = await getProfileById(asset.id);
    const current = dryRun
      ? existing
      : await upsertProfile({
          id: asset.id,
          label: existing?.label ?? asset.label,
          activeRevisionId: existing?.activeRevisionId ?? null,
        });

    const byHash = await getLatestProfileRevisionByHash(asset.id, asset.hash);
    let revisionId = byHash?.id ?? null;

    if (byHash) {
      stats.reusedRevisions += 1;
    } else {
      stats.createdRevisions += 1;
      if (!dryRun) {
        const inserted = await insertProfileRevision({
          profileId: asset.id,
          content: asset.content,
          contentHash: asset.hash,
          source: existing ? 'update' : 'create',
          // Insert as draft to avoid violating single-active constraints;
          // activation is handled explicitly below when needed.
          status: 'draft',
          createdBy: null,
          restoredFromRevisionId: null,
        });
        revisionId = inserted.id;
      }
    }

    if (!current?.activeRevisionId && revisionId) {
      stats.activatedRevisions += 1;
      if (!dryRun) {
        await activateProfileRevision(asset.id, revisionId);
      }
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

      stats.retiredTemplates += 1;
      if (!dryRun) {
        await deprecateActiveTemplateRevision(template.id);
        await setTemplateActiveRevision(template.id, null);
      }
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
  profileRoot: string;
  defaultTemplateId: string;
  defaultProfileId: string;
}): void {
  console.log(`[prompt-assets-bootstrap] mode=${params.mode}`);
  console.log(`[prompt-assets-bootstrap] templateRoot=${params.templateRoot}`);
  console.log(`[prompt-assets-bootstrap] profileRoot=${params.profileRoot}`);
  console.log(`[prompt-assets-bootstrap] defaultTemplateId=${params.defaultTemplateId}`);
  console.log(`[prompt-assets-bootstrap] defaultProfileId=${params.defaultProfileId}`);
  console.log(`[prompt-assets-bootstrap] scannedFiles=${params.stats.scannedFiles}`);
  console.log(`[prompt-assets-bootstrap] templatesDiscovered=${params.stats.templatesDiscovered}`);
  console.log(`[prompt-assets-bootstrap] profilesDiscovered=${params.stats.profilesDiscovered}`);
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
  const profileRoot = resolveConfiguredRoot(config.prompt.defaultProfilePath, 'profile');
  const defaultTemplateId = resolveConfiguredDefaultId(config.prompt.templatePath, 'template');
  const defaultProfileId = resolveConfiguredDefaultId(config.prompt.defaultProfilePath, 'profile');

  const scanned = await scanAssets({ templateRoot, profileRoot });
  const stats: BootstrapStats = {
    scannedFiles: scanned.scannedFiles,
    templatesDiscovered: scanned.templates.length,
    profilesDiscovered: scanned.profiles.length,
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
  if (scanned.profiles.length === 0) {
    throw new Error('No profile assets discovered. Ensure profile files exist under profile root.');
  }

  const hasDefaultTemplate = scanned.templates.some((item) => item.id === defaultTemplateId);
  const hasDefaultProfile = scanned.profiles.some((item) => item.id === defaultProfileId);

  if (!hasDefaultTemplate || !hasDefaultProfile) {
    throw new Error(
      `Configured defaults were not discovered (template=${defaultTemplateId}, profile=${defaultProfileId}).`,
    );
  }

  await importTemplates(scanned.templates, options.dryRun, stats);
  await importProfiles(scanned.profiles, options.dryRun, stats);
  await retireMissingTemplateAssets(
    scanned.templates.map((item) => item.id),
    options.dryRun,
    stats,
  );

  printSummary({
    mode: options.dryRun ? 'dry-run' : 'apply',
    stats,
    templateRoot,
    profileRoot,
    defaultTemplateId,
    defaultProfileId,
  });

  if (options.dryRun) {
    const dryDefaultTemplate = stats.templatesDiscovered > 0 ? defaultTemplateId : null;
    const dryDefaultProfile = stats.profilesDiscovered > 0 ? defaultProfileId : null;
    console.log(
      `[prompt-assets-bootstrap] projectedReadiness templateDefault=${dryDefaultTemplate ?? 'missing'} profileDefault=${dryDefaultProfile ?? 'missing'}`,
    );
    return;
  }

  const promptOptions = await getPromptOptions({ config });
  if (!promptOptions.defaults.templateId || !promptOptions.defaults.profileId) {
    throw new Error(
      'Bootstrap finished but defaults are not active in DB. Verify prompt files and rerun bootstrap.',
    );
  }

  console.log(
    `[prompt-assets-bootstrap] readiness=ok templateDefault=${promptOptions.defaults.templateId} profileDefault=${promptOptions.defaults.profileId}`,
  );
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
