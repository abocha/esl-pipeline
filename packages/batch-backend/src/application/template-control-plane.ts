import type {
  AdminTemplateRevisionDto,
  TemplateControlPlaneListDto,
} from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';
import { listTemplates } from '../domain/template-repository.js';
import type { TemplateRevisionRecord } from '../domain/template-revision-model.js';
import {
  getActiveTemplateRevision,
  getLatestTemplateRevisionByHash,
} from '../domain/template-revision-repository.js';
import { importTemplateAsset } from './import-template-asset.js';
import { resolveTemplateAssetRoot, scanTemplateAssets } from './template-assets.js';
import {
  activateTemplateRevisionForTemplate,
  listTemplateContents,
  TemplateContentError,
} from './template-content.js';

/** Explicit operator action; content is read from the running release, never supplied by the client. */
export async function importAndActivateShippedTemplate(
  templateId: string,
  createdBy: string | null,
  overrides: { templateRoot?: string } = {},
): Promise<AdminTemplateRevisionDto> {
  const assets = await scanTemplateAssets(
    overrides.templateRoot ?? resolveTemplateAssetRoot(loadConfig().prompt.templatePath),
  );
  const asset = assets.find((item) => item.id === templateId);
  if (!asset)
    throw new TemplateContentError(
      'This template has no shipped asset. Refresh the catalog.',
      'template_not_shipped',
      404,
    );
  const imported = await importTemplateAsset(asset, createdBy);
  try {
    const activated = await activateTemplateRevisionForTemplate(asset.id, imported.id);
    if (!activated) throw new Error('Imported revision could not be activated.');
    return activated;
  } catch (cause) {
    const error = new TemplateContentError(
      `Shipped content was imported as ${imported.versionLabel}, but activation did not complete. Refresh the persisted state and retry activation of the shipped revision.`,
      'template_shipped_activation_failed',
      500,
    );
    error.cause = cause;
    throw error;
  }
}

function toRevision(revision: TemplateRevisionRecord | null): AdminTemplateRevisionDto | null {
  if (!revision) return null;
  return {
    id: revision.id,
    versionLabel: revision.versionLabel,
    contentHash: revision.contentHash,
    content: revision.content,
    status: revision.status,
    source: revision.source,
    createdAt: revision.createdAt.toISOString(),
    activatedAt: revision.activatedAt?.toISOString() ?? null,
    restoredFromRevisionId: revision.restoredFromRevisionId,
  };
}

/** Read-only release asset -> DB projection. Never imports or activates on inspection. */
export async function listTemplateControlPlane(
  overrides: {
    templateRoot?: string;
    list?: typeof listTemplates;
    active?: typeof getActiveTemplateRevision;
    matching?: typeof getLatestTemplateRevisionByHash;
    defaults?: typeof listTemplateContents;
  } = {},
): Promise<TemplateControlPlaneListDto> {
  const assets = await scanTemplateAssets(
    overrides.templateRoot ?? resolveTemplateAssetRoot(loadConfig().prompt.templatePath),
  );
  const list = overrides.list ?? listTemplates;
  const templates = new Map<string, { id: string; label: string }>();
  let offset = 0;
  while (true) {
    const page = await list({ limit: 500, offset, order: 'asc' });
    for (const template of page.items) templates.set(template.id, template);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  const ids = new Set([...templates.keys(), ...assets.map((asset) => asset.id)]);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const items = await Promise.all(
    [...ids].sort().map(async (templateId) => {
      const asset = assetsById.get(templateId);
      // Match by deployed hash, never by the newest revision in the catalog.
      const active = toRevision(await (overrides.active ?? getActiveTemplateRevision)(templateId));
      const matchingRevision = asset
        ? active?.contentHash === asset.hash
          ? active
          : toRevision(
              await (overrides.matching ?? getLatestTemplateRevisionByHash)(templateId, asset.hash),
            )
        : null;
      return {
        templateId,
        label: templates.get(templateId)?.label ?? asset?.label ?? templateId,
        databasePresent: templates.has(templateId),
        active,
        shipped: asset
          ? {
              content: asset.content,
              contentHash: asset.hash,
              matchingRevision,
              imported: matchingRevision !== null,
            }
          : null,
        drift: !asset
          ? ('not_shipped' as const)
          : !matchingRevision
            ? ('shipped_not_imported' as const)
            : active?.contentHash === asset.hash
              ? ('in_sync' as const)
              : ('update_available' as const),
      };
    }),
  );
  const defaults = await (overrides.defaults ?? listTemplateContents)();
  return { items, defaultTemplateId: defaults.defaultTemplateId ?? null };
}
