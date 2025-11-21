import { Client } from '@notionhq/client';
import { readFile } from 'node:fs/promises';

import { ConfigurationError } from '@esl-pipeline/contracts';

import { withRetry } from './retry.js';
import { type ColorPreset, PresetSchema, type PresetsFile } from './types.js';

interface Counts {
  h2: number;
  h3: number;
  toggles: number;
}

export function createNotionClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new ConfigurationError('Missing NOTION_TOKEN');
  return new Client({ auth: token, notionVersion: '2025-09-03' });
}

export async function loadPreset(presetName: string, presetsPath: string): Promise<ColorPreset> {
  const raw = await readFile(presetsPath, 'utf8');
  const parsed: PresetsFile = JSON.parse(raw);
  const p = parsed[presetName];
  if (!p) throw new ConfigurationError(`Preset not found: ${presetName}`);
  const res = PresetSchema.safeParse(p);
  if (!res.success) throw new ConfigurationError(`Invalid preset: ${presetName}`);
  return res.data;
}

export async function applyHeadingPreset(
  pageId: string,
  presetName: string,
  presetsPath = 'configs/presets.json',
): Promise<{ applied: boolean; counts: Counts }> {
  const client = createNotionClient();
  const preset = await loadPreset(presetName, presetsPath);

  const counts: Counts = { h2: 0, h3: 0, toggles: 0 };

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
      )) as any;
      await maybeThrottle();
      for (const child of childResp.results) {
        if ('type' in child && child.type === 'heading_3') {
          await withRetry(
            () =>
              client.blocks.update({
                block_id: child.id,
                heading_3: {
                  rich_text: (child as any).heading_3.rich_text,
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
  let cursor: string | undefined = undefined;
  let prevWasH2 = false;

  do {
    const resp = (await withRetry(
      () => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }),
      'blocks.children.list',
    )) as any;
    await maybeThrottle();

    for (const block of resp.results) {
      if ('type' in block && block.type === 'heading_2' && preset.h2) {
        await withRetry(
          () =>
            client.blocks.update({
              block_id: block.id,
              heading_2: {
                rich_text: (block as any).heading_2.rich_text,
                color: preset.h2,
              },
            }),
          'blocks.update.heading_2',
        );
        await maybeThrottle();
        counts.h2++;
        prevWasH2 = true;
        continue;
      }

      if ('type' in block && block.type === 'heading_3' && preset.h3) {
        await withRetry(
          () =>
            client.blocks.update({
              block_id: block.id,
              heading_3: {
                rich_text: (block as any).heading_3.rich_text,
                color: preset.h3,
              },
            }),
          'blocks.update.heading_3',
        );
        await maybeThrottle();
        counts.h3++;
        prevWasH2 = false;
        continue;
      }

      // TOGGLES right after an H2 (optional)
      if ('type' in block && block.type === 'toggle') {
        if (prevWasH2 && preset.toggleMap?.h2) {
          const toggle = (block as any).toggle;
          const richText = Array.isArray(toggle?.rich_text) ? toggle.rich_text : [];
          const annotated = richText.map((item: any) => ({
            ...item,
            annotations: {
              ...item.annotations,
              color: preset.toggleMap!.h2,
            },
          }));
          await withRetry(
            () =>
              client.blocks.update({
                block_id: block.id,
                toggle: {
                  rich_text: annotated,
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
