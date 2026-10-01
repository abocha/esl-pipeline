import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scanTemplateAssets } from '../src/application/template-assets.js';
import { activateTemplateRevisionForTemplate } from '../src/application/template-content.js';
import {
  importAndActivateShippedTemplate,
  listTemplateControlPlane,
} from '../src/application/template-control-plane.js';
import type { TemplateRevisionRecord } from '../src/domain/template-revision-model.js';
import { importTemplates } from '../src/tools/bootstrap-prompt-assets.js';

const mocks = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  getTemplateById: vi.fn(),
  upsertTemplate: vi.fn(),
  setTemplateActiveRevision: vi.fn(),
  setDefaultTemplate: vi.fn(),
  getActiveTemplateRevision: vi.fn(),
  getLatestTemplateRevisionByHash: vi.fn(),
  getTemplateRevisionById: vi.fn(),
  insertTemplateRevision: vi.fn(),
  activateTemplateRevision: vi.fn(),
  deprecateActiveTemplateRevision: vi.fn(),
  listTemplateRevisions: vi.fn(),
}));
vi.mock('../src/domain/template-repository.js', () => mocks);
vi.mock('../src/domain/template-revision-repository.js', () => mocks);
vi.mock('../src/config/env.js', () => ({
  loadConfig: () => ({ prompt: { templatePath: 'template.md' } }),
}));

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const dirs: string[] = [];
let root: string;
let active: TemplateRevisionRecord | null;
let shipped: TemplateRevisionRecord;

function revision(
  id: string,
  content: string,
  status: TemplateRevisionRecord['status'],
  version = 1,
): TemplateRevisionRecord {
  return {
    id,
    templateId: 'template.md',
    content,
    contentHash: hash(content),
    status,
    versionNumber: version,
    versionLabel: `v${version}`,
    source: 'update',
    createdAt: new Date('2026-09-30T00:00:00Z'),
    activatedAt: status === 'active' ? new Date('2026-09-30T00:01:00Z') : null,
    deprecatedAt: null,
    createdBy: null,
    restoredFromRevisionId: null,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), 'template-control-plane-'));
  dirs.push(root);
  await writeFile(path.join(root, 'template.md'), 'Shipped\nexact content\n', 'utf8');
  active = revision('old', 'Old content', 'active', 14);
  shipped = revision('shipped', 'Shipped\nexact content\n', 'draft', 17);
  mocks.listTemplates.mockResolvedValue({
    items: [{ id: 'template.md', label: 'Homework', activeRevisionId: 'old' }],
    total: 1,
  });
  mocks.getTemplateById.mockImplementation(async () => ({
    id: 'template.md',
    label: 'Homework',
    activeRevisionId: active?.id ?? null,
  }));
  mocks.upsertTemplate.mockImplementation(async () => ({
    id: 'template.md',
    label: 'Homework',
    activeRevisionId: active?.id ?? null,
  }));
  mocks.getActiveTemplateRevision.mockImplementation(async () => active);
  mocks.getLatestTemplateRevisionByHash.mockImplementation(async (_id, contentHash) =>
    contentHash === shipped.contentHash ? shipped : null,
  );
  mocks.getTemplateRevisionById.mockImplementation(async (_id, id) =>
    id === shipped.id ? shipped : active,
  );
  mocks.activateTemplateRevision.mockImplementation(async () => {
    active = { ...shipped, status: 'active', activatedAt: new Date() };
    return active;
  });
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const project = () =>
  listTemplateControlPlane({
    templateRoot: root,
    defaults: async () => ({ templates: [], defaultTemplateId: 'template.md' }),
  });

describe('admin template control plane', () => {
  it('imports exact deployed content as a draft with provenance, then uses normal activation', async () => {
    const previous = { ...active! };
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(null);
    mocks.insertTemplateRevision.mockResolvedValue(shipped);
    const result = await importAndActivateShippedTemplate('template.md', 'operator', {
      templateRoot: root,
    });
    expect(mocks.insertTemplateRevision).toHaveBeenCalledExactlyOnceWith({
      templateId: 'template.md',
      content: shipped.content,
      contentHash: shipped.contentHash,
      source: 'update',
      status: 'draft',
      createdBy: 'operator',
      restoredFromRevisionId: null,
    });
    expect(mocks.upsertTemplate).toHaveBeenCalledWith({
      id: 'template.md',
      label: 'Homework',
      activeRevisionId: previous.id,
    });
    expect(mocks.activateTemplateRevision).toHaveBeenCalledWith('template.md', shipped.id);
    expect(mocks.setTemplateActiveRevision).toHaveBeenCalledWith('template.md', shipped.id);
    expect(result.status).toBe('active');
    expect(previous.content).toBe('Old content');
    expect(await readFile(path.join(root, 'template.md'), 'utf8')).toBe(shipped.content);
  });

  it('supports a shipped asset without a DB template and reuses a hash on retry', async () => {
    mocks.getTemplateById.mockResolvedValueOnce(null);
    mocks.getLatestTemplateRevisionByHash.mockResolvedValueOnce(null);
    mocks.insertTemplateRevision.mockResolvedValue(shipped);
    await importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root });
    expect(mocks.insertTemplateRevision).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'create' }),
    );
    await importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root });
    expect(mocks.insertTemplateRevision).toHaveBeenCalledTimes(1);
  });

  it('leaves an imported draft and reports failure when activation fails, then permits retry', async () => {
    const previous = active;
    mocks.getLatestTemplateRevisionByHash.mockResolvedValueOnce(null);
    mocks.insertTemplateRevision.mockResolvedValue(shipped);
    mocks.activateTemplateRevision.mockRejectedValueOnce(new Error('activation failed'));
    await expect(
      importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root }),
    ).rejects.toMatchObject({ code: 'template_shipped_activation_failed' });
    expect(active).toBe(previous);
    expect(mocks.setTemplateActiveRevision).not.toHaveBeenCalled();
    expect((await project()).items[0]).toMatchObject({
      drift: 'update_available',
      active: { id: 'old' },
      shipped: { imported: true },
    });
    await importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root });
    expect(mocks.insertTemplateRevision).toHaveBeenCalledTimes(1);
    expect((await project()).items[0]?.drift).toBe('in_sync');
  });

  it('does not report success when activation returns no revision or pointer update fails', async () => {
    mocks.activateTemplateRevision.mockResolvedValueOnce(null);
    await expect(
      importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root }),
    ).rejects.toMatchObject({ code: 'template_shipped_activation_failed' });
    mocks.setTemplateActiveRevision.mockRejectedValueOnce(new Error('pointer failed'));
    await expect(
      importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root }),
    ).rejects.toMatchObject({ code: 'template_shipped_activation_failed' });
  });

  it('fails before activation on import failure or a non-shipped template', async () => {
    await expect(
      importAndActivateShippedTemplate('../template.md', 'operator', { templateRoot: root }),
    ).rejects.toMatchObject({ code: 'template_not_shipped' });
    expect(mocks.upsertTemplate).not.toHaveBeenCalled();
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(null);
    mocks.insertTemplateRevision.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      importAndActivateShippedTemplate('template.md', 'operator', { templateRoot: root }),
    ).rejects.toThrow('insert failed');
    expect(mocks.activateTemplateRevision).not.toHaveBeenCalled();
  });
  it('matches the running asset hash even when a newer operator revision exists', async () => {
    const result = await project();
    expect(result.items[0]).toMatchObject({
      active: { id: 'old', versionLabel: 'v14' },
      shipped: {
        matchingRevision: { id: 'shipped', versionLabel: 'v17', status: 'draft' },
        imported: true,
        content: shipped.content,
      },
      drift: 'update_available',
    });
    expect(mocks.getLatestTemplateRevisionByHash).toHaveBeenCalledWith(
      'template.md',
      hash(shipped.content),
    );
    expect(mocks.insertTemplateRevision).not.toHaveBeenCalled();
    expect(mocks.activateTemplateRevision).not.toHaveBeenCalled();
    expect(result.defaultTemplateId).toBe('template.md');
  });

  it('reports in-sync by content even after restoring into a different revision ID', async () => {
    active = {
      ...shipped,
      id: 'restored',
      status: 'active',
      source: 'restore',
      restoredFromRevisionId: 'shipped',
    };
    expect((await project()).items[0]).toMatchObject({
      drift: 'in_sync',
      active: { id: 'restored' },
      shipped: { imported: true, matchingRevision: { id: 'restored' } },
    });
  });

  it('shows unimported assets, including templates with no DB row or active revision', async () => {
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(null);
    expect((await project()).items[0]).toMatchObject({
      drift: 'shipped_not_imported',
      shipped: { imported: false, matchingRevision: null },
    });
    mocks.listTemplates.mockResolvedValue({ items: [], total: 0 });
    active = null;
    expect((await project()).items[0]).toMatchObject({
      databasePresent: false,
      active: null,
      drift: 'shipped_not_imported',
    });
  });

  it('does not invent shipped content for DB-only templates', async () => {
    await rm(path.join(root, 'template.md'));
    expect((await project()).items[0]).toMatchObject({ shipped: null, drift: 'not_shipped' });
  });

  it('imports changed assets as draft without activating and becomes in-sync only on explicit activation', async () => {
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(null);
    mocks.insertTemplateRevision.mockResolvedValue(shipped);
    const stats = {
      scannedFiles: 1,
      templatesDiscovered: 1,
      profilesDiscovered: 0,
      createdRevisions: 0,
      reusedRevisions: 0,
      activatedRevisions: 0,
      retiredTemplates: 0,
    };
    await importTemplates(await scanTemplateAssets(root), false, stats);
    expect(mocks.insertTemplateRevision).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: hash(shipped.content), status: 'draft' }),
    );
    expect(mocks.activateTemplateRevision).not.toHaveBeenCalled();
    expect(mocks.setTemplateActiveRevision).not.toHaveBeenCalled();
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(shipped);
    expect((await project()).items[0]?.drift).toBe('update_available');
    await activateTemplateRevisionForTemplate('template.md', shipped.id);
    expect(mocks.setTemplateActiveRevision).toHaveBeenCalledWith('template.md', shipped.id);
    expect((await project()).items[0]?.drift).toBe('in_sync');
  });

  it('scans controlled nested deployed assets with exact UTF-8 hashes and excludes non-prompts', async () => {
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'custom.txt'), 'Привет\r\n');
    await writeFile(path.join(root, 'secret.json'), '{}');
    const assets = await scanTemplateAssets(root);
    expect(assets.map((asset) => asset.id)).toEqual(['nested/custom.txt', 'template.md']);
    expect(assets[0]?.hash).toBe(hash('Привет\r\n'));
  });

  it('fails closed when deployed assets cannot be read', async () => {
    await expect(
      listTemplateControlPlane({ templateRoot: path.join(root, 'missing') }),
    ).rejects.toThrow();
  });
});
