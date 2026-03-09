import type { AnytypeClient } from '@esl-pipeline/anytype-adapter';
import { ValidationError } from '@esl-pipeline/contracts';

import type { PipelineLogger } from '../observability.js';

export function resolveAnytypeObjectId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const objectId = record.object_id ?? record.objectId;
  if (typeof objectId === 'string' && objectId.length > 0) return objectId;
  const nestedObject = record.object;
  if (nestedObject && typeof nestedObject === 'object') {
    const nestedId = (nestedObject as Record<string, unknown>).id;
    if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId;
  }
  const nestedData = record.data;
  if (nestedData && typeof nestedData === 'object') {
    const dataId = (nestedData as Record<string, unknown>).id;
    if (typeof dataId === 'string' && dataId.length > 0) return dataId;
  }
  return undefined;
}

interface ResolveAnytypeSpaceIdOptions {
  env?: NodeJS.ProcessEnv;
}

export async function resolveAnytypeSpaceId(
  client: Pick<AnytypeClient, 'listSpaces'>,
  explicitId?: string,
  options: ResolveAnytypeSpaceIdOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const fromEnv = env.ANYTYPE_SPACE_ID;
  const candidateId = explicitId ?? fromEnv;
  if (candidateId) return candidateId;

  const spaces = await client.listSpaces();
  if (spaces.length === 1 && spaces[0]?.id) return spaces[0].id;

  const desiredName = env.ANYTYPE_SPACE_NAME?.trim();
  if (desiredName) {
    const match = spaces.find((space: { name?: string }) => space.name === desiredName);
    if (match?.id) return match.id;
  }

  throw new ValidationError(
    'Anytype space not resolved. Set ANYTYPE_SPACE_ID or ANYTYPE_SPACE_NAME.',
  );
}

interface AddAnytypePageToCollectionOptions {
  collectionId?: string;
  env?: NodeJS.ProcessEnv;
}

export async function addAnytypePageToCollection(
  client: Pick<AnytypeClient, 'addObjectsToList'>,
  spaceId: string,
  pageId: string,
  logger: PipelineLogger,
  runId?: string,
  options: AddAnytypePageToCollectionOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const collectionId = options.collectionId ?? env.ANYTYPE_COLLECTION_ID?.trim();
  if (!collectionId) return false;

  try {
    await client.addObjectsToList(spaceId, collectionId, [pageId]);
    logger.log({
      level: 'info',
      message: 'anytype.collection.added',
      runId,
      stage: 'import',
      detail: { collectionId, pageId },
    });
    return true;
  } catch (error) {
    logger.log({
      level: 'warn',
      message: 'anytype.collection.add_failed',
      runId,
      stage: 'import',
      detail: {
        collectionId,
        pageId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return false;
  }
}
