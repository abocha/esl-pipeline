import { readFile } from 'node:fs/promises';
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
];
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
function toRequestRichText(value) {
    return Array.isArray(value) ? value : [];
}
function toggleTitle(block) {
    const richText = block.toggle?.rich_text ?? [];
    const first = richText[0];
    if (!first || typeof first !== 'object')
        return '';
    return 'plain_text' in first ? first.plain_text ?? '' : '';
}
export async function loadPreset(presetName, presetsPath) {
    const raw = await readFile(presetsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const preset = parsed[presetName];
    if (!preset)
        throw new ConfigurationError(`Preset not found: ${presetName}`);
    const res = PresetSchema.safeParse(preset);
    if (!res.success)
        throw new ConfigurationError(`Invalid preset: ${presetName}`);
    return res.data;
}
export async function applyHeadingPreset(pageId, presetName, presetsPath = 'configs/presets.json') {
    const client = createNotionClient();
    const preset = await loadPreset(presetName, presetsPath);
    const counts = { h2: 0, h3: 0, toggles: 0 };
    const isHeading2 = (block) => 'type' in block && block.type === 'heading_2';
    const isHeading3 = (block) => 'type' in block && block.type === 'heading_3';
    const isToggle = (block) => 'type' in block && block.type === 'toggle';
    const colorHeading3Descendants = async (parentId) => {
        if (!preset.h3)
            return;
        let childCursor;
        do {
            const childResp = (await withRetry(() => client.blocks.children.list({
                block_id: parentId,
                start_cursor: childCursor,
                page_size: 100,
            }), 'blocks.children.list'));
            await maybeThrottle();
            for (const child of childResp.results) {
                if (isHeading3(child)) {
                    await withRetry(() => client.blocks.update({
                        block_id: child.id,
                        heading_3: {
                            rich_text: toRequestRichText(child.heading_3.rich_text),
                            color: preset.h3,
                        },
                    }), 'blocks.update.heading_3');
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
    let cursor = undefined;
    let prevWasH2 = false;
    do {
        const resp = (await withRetry(() => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }), 'blocks.children.list'));
        await maybeThrottle();
        for (const block of resp.results) {
            if (isHeading2(block) && preset.h2) {
                await withRetry(() => client.blocks.update({
                    block_id: block.id,
                    heading_2: {
                        rich_text: toRequestRichText(block.heading_2.rich_text),
                        color: preset.h2,
                    },
                }), 'blocks.update.heading_2');
                await maybeThrottle();
                counts.h2++;
                prevWasH2 = true;
                continue;
            }
            if (isHeading3(block) && preset.h3) {
                await withRetry(() => client.blocks.update({
                    block_id: block.id,
                    heading_3: {
                        rich_text: toRequestRichText(block.heading_3.rich_text),
                        color: preset.h3,
                    },
                }), 'blocks.update.heading_3');
                await maybeThrottle();
                counts.h3++;
                prevWasH2 = false;
                continue;
            }
            // TOGGLES right after an H2 (optional)
            if (isToggle(block)) {
                const title = toggleTitle(block);
                if (prevWasH2 && preset.toggleMap?.h2 && !isProtectedToggleTitle(title)) {
                    const toggle = block.toggle;
                    const richText = Array.isArray(toggle.rich_text) ? toggle.rich_text : [];
                    const annotated = richText.map((item) => ({
                        ...item,
                        annotations: {
                            ...item.annotations,
                            color: preset.toggleMap.h2,
                        },
                    }));
                    await withRetry(() => client.blocks.update({
                        block_id: block.id,
                        toggle: {
                            rich_text: toRequestRichText(annotated),
                        },
                    }), 'blocks.update.toggle');
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
async function maybeThrottle() {
    if (THROTTLE_MS <= 0) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
}
//# sourceMappingURL=colorizer.js.map