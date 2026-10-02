import { getTemplateById, upsertTemplate } from '../domain/template-repository.js';
import {
  getLatestTemplateRevisionByHash,
  insertTemplateRevision,
} from '../domain/template-revision-repository.js';
import type { TemplateAsset } from './template-assets.js';

/** Bootstrap and explicit admin imports share immutable, hash-deduplicated draft semantics. */
export async function importTemplateAsset(asset: TemplateAsset, createdBy: string | null = null) {
  const existing = await getTemplateById(asset.id);
  await upsertTemplate({
    id: asset.id,
    label: existing?.label ?? asset.label,
    activeRevisionId: existing?.activeRevisionId ?? null,
  });
  const matching = await getLatestTemplateRevisionByHash(asset.id, asset.hash);
  return (
    matching ??
    insertTemplateRevision({
      templateId: asset.id,
      content: asset.content,
      contentHash: asset.hash,
      source: existing ? 'update' : 'create',
      status: 'draft',
      createdBy,
      restoredFromRevisionId: null,
    })
  );
}
