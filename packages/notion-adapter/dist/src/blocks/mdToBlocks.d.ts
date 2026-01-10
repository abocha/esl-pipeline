type BlockObjectRequest = any;
/**
 * Extremely pragmatic MD→Notion mapper that:
 * - Emits heading_1 / heading_2 / heading_3 for '#', '##', '###'
 * - Emits toggles for :::toggle-heading / :::toggle-hX
 * - Emits callouts for :::callout <emoji>
 * - Emits columns for :::column-list / :::column
 * - Emits ToC for :::toc
 * - Emits Audio/Video for :::audio / :::video
 * - Emits Synced Blocks for :::synced-block
 * - Maps bullet lines (- , *) to bulleted_list_item
 * - Maps numbered lines (1.) to numbered_list_item
 * - Maps blockquotes (> ) to quote
 * - Maps code blocks (```) to code
 * - Maps images (![alt](url)) to image
 * - Maps tables (| col | col |) to table
 * - Maps everything else (non-empty) to paragraph
 */
export declare function mdToBlocks(md: string): BlockObjectRequest[];
export {};
