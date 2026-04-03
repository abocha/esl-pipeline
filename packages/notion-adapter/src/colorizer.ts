import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PartialBlockObjectResponse,
  UpdateBlockParameters,
} from '@notionhq/client/build/src/api-endpoints.js';
import { z } from 'zod';

import { ConfigurationError } from '@esl-pipeline/contracts';

import { createNotionClient } from './client.js';
import { isProtectedToggleTitle } from './rendering.js';
import { withRetry } from './retry.js';

const ALLOWED_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
  'gray_background',
  'brown_background',
  'orange_background',
  'yellow_background',
  'green_background',
  'blue_background',
  'purple_background',
  'pink_background',
  'red_background',
] as const;

const ColorName = z.enum(ALLOWED_COLORS);

export const PresetSchema = z.object({
  h2: ColorName.optional(),
  h3: ColorName.optional(),
  toggleMap: z
    .object({
      h2: ColorName.optional(),
    })
    .optional(),
});

export type ColorPreset = z.infer<typeof PresetSchema>;
export type PresetsFile = Record<string, ColorPreset>;

interface Counts {
  h2: number;
  h3: number;
  toggles: number;
}

type Heading2UpdateParams = Extract<UpdateBlockParameters, { heading_2: unknown }>;
type NotionRequestRichText = NonNullable<Heading2UpdateParams['heading_2']>['rich_text'];

type ToggleBlock = Extract<BlockObjectResponse, { type: 'toggle' }>;

type BlockResult = BlockObjectResponse | PartialBlockObjectResponse;

type ToggleRichText = NonNullable<ToggleBlock['toggle']>['rich_text'];

type ToggleTextItem = ToggleRichText extends (infer T)[] ? T : never;

type ToggleText = ToggleTextItem extends { plain_text?: string } ? string : string;
type ColorValue = z.infer<typeof ColorName>;

interface CachedPresetFile {
  mtimeMs: number;
  size: number;
  parsed: PresetsFile;
}

const presetsFileCache = new Map<string, CachedPresetFile>();

function toRequestRichText(value: unknown): NotionRequestRichText {
  return Array.isArray(value) ? (value as unknown as NotionRequestRichText) : [];
}

function toggleTitle(block: ToggleBlock): string {
  const richText = block.toggle?.rich_text ?? [];
  const first = richText[0];
  if (!first || typeof first !== 'object') return '';
  return 'plain_text' in first ? ((first.plain_text as ToggleText) ?? '') : '';
}

function currentColor(value: unknown): string {
  return typeof value === 'string' ? value : 'default';
}

function shouldUpdateHeading2Color(
  block: Extract<BlockObjectResponse, { type: 'heading_2' }>,
  targetColor: ColorValue,
): boolean {
  return currentColor(block.heading_2.color) !== targetColor;
}

function shouldUpdateHeading3Color(
  block: Extract<BlockObjectResponse, { type: 'heading_3' }>,
  targetColor: ColorValue,
): boolean {
  return currentColor(block.heading_3.color) !== targetColor;
}

function shouldUpdateToggleColor(block: ToggleBlock, targetColor: ColorValue): boolean {
  const richText = Array.isArray(block.toggle?.rich_text) ? block.toggle.rich_text : [];
  if (richText.length === 0) return false;
  return richText.some((item) => currentColor(item.annotations?.color) !== targetColor);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashColorPreset(preset: ColorPreset): string {
  return createHash('sha256').update(stableSerialize(preset)).digest('hex');
}

export async function loadPreset(presetName: string, presetsPath: string): Promise<ColorPreset> {
  const fileStats = await stat(presetsPath);
  const cached = presetsFileCache.get(presetsPath);
  let parsed: PresetsFile;
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    parsed = cached.parsed;
  } else {
    const raw = await readFile(presetsPath, 'utf8');
    parsed = JSON.parse(raw) as PresetsFile;
    presetsFileCache.set(presetsPath, {
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      parsed,
    });
  }
  const preset = parsed[presetName];
  if (!preset) throw new ConfigurationError(`Preset not found: ${presetName}`);
  const res = PresetSchema.safeParse(preset);
  if (!res.success) throw new ConfigurationError(`Invalid preset: ${presetName}`);
  return res.data;
}

export async function applyHeadingPreset(
  pageId: string,
  presetName: string,
  presetsPath = 'packages/orchestrator/configs/presets.json',
): Promise<{ applied: boolean; counts: Counts }> {
  const client = createNotionClient();
  const preset = await loadPreset(presetName, presetsPath);

  const counts: Counts = { h2: 0, h3: 0, toggles: 0 };

  const isHeading2 = (
    block: BlockResult,
  ): block is Extract<BlockObjectResponse, { type: 'heading_2' }> =>
    'type' in block && block.type === 'heading_2';
  const isHeading3 = (
    block: BlockResult,
  ): block is Extract<BlockObjectResponse, { type: 'heading_3' }> =>
    'type' in block && block.type === 'heading_3';
  const isToggle = (
    block: BlockResult,
  ): block is Extract<BlockObjectResponse, { type: 'toggle' }> =>
    'type' in block && block.type === 'toggle';

  const colorHeading3Descendants = async (parentId: string) => {
    if (!preset.h3) return;
    let childCursor: string | undefined;
    do {
      const childResp = (await withRetry(
        () =>
          client.blocks.children.list({
            block_id: parentId,
            start_cursor: childCursor,
            page_size: 100,
          }),
        'blocks.children.list',
      )) as ListBlockChildrenResponse;
      await maybeThrottle();
      for (const child of childResp.results) {
        if (isHeading3(child) && shouldUpdateHeading3Color(child, preset.h3)) {
          await withRetry(
            () =>
              client.blocks.update({
                block_id: child.id,
                heading_3: {
                  rich_text: toRequestRichText(child.heading_3.rich_text),
                  color: preset.h3,
                },
              }),
            'blocks.update.heading_3',
          );
          await maybeThrottle();
          counts.h3++;
        }
        if ('type' in child && child.type === 'toggle') {
          await colorHeading3Descendants(child.id);
        }
      }
      childCursor = childResp.has_more ? (childResp.next_cursor ?? undefined) : undefined;
    } while (childCursor);
  };

  // 1) list top-level children (paginate)
  let cursor: string | undefined;
  let prevWasH2 = false;

  do {
    const resp = (await withRetry(
      () => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }),
      'blocks.children.list',
    )) as ListBlockChildrenResponse;
    await maybeThrottle();

    for (const block of resp.results) {
      if (isHeading2(block) && preset.h2) {
        if (shouldUpdateHeading2Color(block, preset.h2)) {
          await withRetry(
            () =>
              client.blocks.update({
                block_id: block.id,
                heading_2: {
                  rich_text: toRequestRichText(block.heading_2.rich_text),
                  color: preset.h2,
                },
              }),
            'blocks.update.heading_2',
          );
          await maybeThrottle();
          counts.h2++;
        }
        prevWasH2 = true;
        continue;
      }

      if (isHeading3(block) && preset.h3) {
        if (shouldUpdateHeading3Color(block, preset.h3)) {
          await withRetry(
            () =>
              client.blocks.update({
                block_id: block.id,
                heading_3: {
                  rich_text: toRequestRichText(block.heading_3.rich_text),
                  color: preset.h3,
                },
              }),
            'blocks.update.heading_3',
          );
          await maybeThrottle();
          counts.h3++;
        }
        prevWasH2 = false;
        continue;
      }

      // TOGGLES right after an H2 (optional)
      if (isToggle(block)) {
        const title = toggleTitle(block);
        const desiredToggleColor = preset.toggleMap?.h2;
        if (
          prevWasH2 &&
          desiredToggleColor &&
          !isProtectedToggleTitle(title) &&
          shouldUpdateToggleColor(block, desiredToggleColor)
        ) {
          const toggle = block.toggle;
          const richText = Array.isArray(toggle.rich_text) ? toggle.rich_text : [];
          const annotated = richText.map((item) => ({
            ...item,
            annotations: {
              ...item.annotations,
              color: desiredToggleColor,
            },
          }));
          await withRetry(
            () =>
              client.blocks.update({
                block_id: block.id,
                toggle: {
                  rich_text: toRequestRichText(annotated),
                },
              }),
            'blocks.update.toggle',
          );
          await maybeThrottle();
          counts.toggles++;
        }
        await colorHeading3Descendants(block.id);
        prevWasH2 = false;
        continue;
      }

      // reset H2 flag if non-toggle arrives
      prevWasH2 = false;
    }

    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return { applied: true, counts };
}

const THROTTLE_MS = Number(process.env.NOTION_COLORIZER_THROTTLE_MS ?? 0);

async function maybeThrottle(): Promise<void> {
  if (THROTTLE_MS <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
}
