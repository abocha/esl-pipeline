import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BotDomain } from './types.js';

export interface TopicState {
  version: 1;
  updatedAt: string;
  chatId: string;
  topics: Partial<Record<BotDomain, number>>;
}

export async function loadTopicState(stateFile: string): Promise<TopicState | null> {
  try {
    const content = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return normalizeTopicState(parsed);
  } catch {
    return null;
  }
}

export async function saveTopicState(stateFile: string, state: TopicState): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizeTopicState(raw: unknown): TopicState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {
    version?: unknown;
    updatedAt?: unknown;
    chatId?: unknown;
    topics?: unknown;
  };

  if (value.version !== 1) return null;
  if (typeof value.updatedAt !== 'string') return null;
  if (typeof value.chatId !== 'string') return null;
  if (!value.topics || typeof value.topics !== 'object') return null;

  const topics = value.topics as Record<string, unknown>;
  const normalizedTopics: Partial<Record<BotDomain, number>> = {};
  for (const domain of ['ops', 'jobs', 'alerts'] as const) {
    const candidate = topics[domain];
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
      normalizedTopics[domain] = candidate;
    }
  }

  return {
    version: 1,
    updatedAt: value.updatedAt,
    chatId: value.chatId,
    topics: normalizedTopics,
  };
}
