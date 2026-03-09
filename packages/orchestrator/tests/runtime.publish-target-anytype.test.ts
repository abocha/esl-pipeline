import type { AnytypeClient } from '@esl-pipeline/anytype-adapter';
import { ValidationError } from '@esl-pipeline/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  addAnytypePageToCollection,
  resolveAnytypeObjectId,
  resolveAnytypeSpaceId,
} from '../src/runtime/publish-target-anytype.js';

describe('runtime/publish-target-anytype', () => {
  it('resolves anytype object ids from supported payload shapes', () => {
    expect(resolveAnytypeObjectId({ id: 'direct-id' })).toBe('direct-id');
    expect(resolveAnytypeObjectId({ object_id: 'snake-id' })).toBe('snake-id');
    expect(resolveAnytypeObjectId({ objectId: 'camel-id' })).toBe('camel-id');
    expect(resolveAnytypeObjectId({ object: { id: 'nested-object-id' } })).toBe('nested-object-id');
    expect(resolveAnytypeObjectId({ data: { id: 'nested-data-id' } })).toBe('nested-data-id');
    expect(resolveAnytypeObjectId({})).toBeUndefined();
  });

  it('resolves anytype space from explicit/env/listed spaces', async () => {
    const listSpaces = vi.fn().mockResolvedValue([
      { id: 'space-a', name: 'Primary' },
      { id: 'space-b', name: 'Secondary' },
    ]);
    const client: Pick<AnytypeClient, 'listSpaces'> = { listSpaces } as Pick<
      AnytypeClient,
      'listSpaces'
    >;

    await expect(resolveAnytypeSpaceId(client, 'explicit-id')).resolves.toBe('explicit-id');
    const previousSpaceId = process.env.ANYTYPE_SPACE_ID;
    const previousSpaceName = process.env.ANYTYPE_SPACE_NAME;
    try {
      process.env.ANYTYPE_SPACE_ID = 'from-env';
      await expect(resolveAnytypeSpaceId(client)).resolves.toBe('from-env');

      delete process.env.ANYTYPE_SPACE_ID;
      process.env.ANYTYPE_SPACE_NAME = 'Secondary';
      await expect(resolveAnytypeSpaceId(client)).resolves.toBe('space-b');
    } finally {
      if (previousSpaceId === undefined) {
        delete process.env.ANYTYPE_SPACE_ID;
      } else {
        process.env.ANYTYPE_SPACE_ID = previousSpaceId;
      }

      if (previousSpaceName === undefined) {
        delete process.env.ANYTYPE_SPACE_NAME;
      } else {
        process.env.ANYTYPE_SPACE_NAME = previousSpaceName;
      }
    }
  });

  it('throws validation error when space cannot be resolved', async () => {
    const client: Pick<AnytypeClient, 'listSpaces'> = {
      listSpaces: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    } as Pick<AnytypeClient, 'listSpaces'>;
    await expect(resolveAnytypeSpaceId(client)).rejects.toBeInstanceOf(ValidationError);
  });

  it('adds page to collection and logs success/failure', async () => {
    const logger = { log: vi.fn() };
    const addObjectsToList = vi.fn().mockResolvedValue();
    const client: Pick<AnytypeClient, 'addObjectsToList'> = { addObjectsToList } as Pick<
      AnytypeClient,
      'addObjectsToList'
    >;

    await expect(
      addAnytypePageToCollection(client, 'space-1', 'page-1', logger, 'run-1', {
        collectionId: 'collection-1',
      }),
    ).resolves.toBe(true);
    expect(addObjectsToList).toHaveBeenCalledWith('space-1', 'collection-1', ['page-1']);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'anytype.collection.added' }),
    );

    addObjectsToList.mockRejectedValueOnce(new Error('boom'));
    await expect(
      addAnytypePageToCollection(client, 'space-1', 'page-1', logger, 'run-2', {
        collectionId: 'collection-1',
      }),
    ).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'anytype.collection.add_failed' }),
    );
  });
});
