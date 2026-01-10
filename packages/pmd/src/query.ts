import type { PmdBlock, PmdDirectiveBlock, PmdDocument } from './types.js';

export function findDirectiveBlocks(
  input: PmdDocument | PmdBlock[],
  name: string,
): PmdDirectiveBlock[] {
  const blocks = Array.isArray(input) ? input : input.body;
  const target = name.toLowerCase();
  const matches: PmdDirectiveBlock[] = [];

  const visit = (block: PmdBlock): void => {
    if (block.type === 'directive_block') {
      if (block.name.toLowerCase() === target) {
        matches.push(block);
      }
      for (const child of block.children) {
        visit(child);
      }
      return;
    }

    if (block.type === 'list') {
      for (const item of block.items) {
        for (const child of item.children) {
          visit(child);
        }
      }
      return;
    }

    if (block.type === 'list_item') {
      for (const child of block.children) {
        visit(child);
      }
      return;
    }

    if (block.type === 'blockquote') {
      for (const child of block.children) {
        visit(child);
      }
    }
  };

  for (const block of blocks) {
    visit(block);
  }
  return matches;
}
