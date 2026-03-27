import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { upsertProfile } from '../src/domain/profile-repository.js';
import {
  getActiveProfileRevision,
  insertProfileRevision,
  listProfileRevisions,
} from '../src/domain/profile-revision-repository.js';
import { upsertTemplate } from '../src/domain/template-repository.js';
import {
  getActiveTemplateRevision,
  insertTemplateRevision,
  listTemplateRevisions,
} from '../src/domain/template-revision-repository.js';
import { withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetRevisionFixtures() {
  await withPgClient(async (client) => {
    await client.query(
      `
      TRUNCATE TABLE
        student_profile_bindings,
        profiles,
        profile_revisions,
        templates,
        template_revisions
      RESTART IDENTITY CASCADE
      `,
    );
  });
}

describe('domain/revision-repositories', () => {
  beforeAll(async () => {
    await resetRevisionFixtures();
  });

  afterAll(async () => {
    await resetRevisionFixtures();
  });

  beforeEach(async () => {
    await resetRevisionFixtures();
  });

  it('inserts a new active profile revision while deprecating the previous active revision', async () => {
    const profileId = `profile-${randomUUID()}.md`;
    await upsertProfile({ id: profileId, label: 'Profile under test', activeRevisionId: null });

    const first = await insertProfileRevision({
      profileId,
      content: 'Version 1',
      contentHash: 'hash-v1',
      source: 'create',
      status: 'active',
    });

    const second = await insertProfileRevision({
      profileId,
      content: 'Version 2',
      contentHash: 'hash-v2',
      source: 'update',
      status: 'active',
    });

    expect(second.versionNumber).toBeGreaterThan(first.versionNumber);

    const active = await getActiveProfileRevision(profileId);
    expect(active?.id).toBe(second.id);

    const revisions = await listProfileRevisions({
      profileId,
      order: 'desc',
      limit: 10,
      offset: 0,
    });
    const activeCount = revisions.items.filter((item) => item.status === 'active').length;
    expect(activeCount).toBe(1);
    expect(revisions.items.find((item) => item.id === first.id)?.status).toBe('deprecated');
  });

  it('inserts a new active template revision while deprecating the previous active revision', async () => {
    const templateId = `template-${randomUUID()}.md`;
    await upsertTemplate({ id: templateId, label: 'Template under test', activeRevisionId: null });

    const first = await insertTemplateRevision({
      templateId,
      content: 'Template version 1',
      contentHash: 'hash-template-v1',
      source: 'create',
      status: 'active',
    });

    const second = await insertTemplateRevision({
      templateId,
      content: 'Template version 2',
      contentHash: 'hash-template-v2',
      source: 'update',
      status: 'active',
    });

    expect(second.versionNumber).toBeGreaterThan(first.versionNumber);

    const active = await getActiveTemplateRevision(templateId);
    expect(active?.id).toBe(second.id);

    const revisions = await listTemplateRevisions({
      templateId,
      order: 'desc',
      limit: 10,
      offset: 0,
    });
    const activeCount = revisions.items.filter((item) => item.status === 'active').length;
    expect(activeCount).toBe(1);
    expect(revisions.items.find((item) => item.id === first.id)?.status).toBe('deprecated');
  });
});
