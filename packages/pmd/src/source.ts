function normalizeNewlines(input: string): string {
  return input.replaceAll('\r\n', '\n');
}

function extractLegacyFence(input: string): string {
  const lines = input.split('\n');
  const opener = lines[0] ?? '';
  if (!opener.startsWith('```')) {
    throw new Error('Legacy fenced markdown must start with ``` at byte 0.');
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '```') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    throw new Error('Legacy fenced markdown must include a closing ``` fence.');
  }

  const after = lines.slice(closingIndex + 1);
  const hasExtraContent = after.some((line) => line.trim().length > 0);
  if (hasExtraContent) {
    throw new Error('Legacy fenced markdown must not include content outside the fence.');
  }

  return lines.slice(1, closingIndex).join('\n');
}

export type MarkdownSourceFormat = 'canonical' | 'legacy-fenced';

export interface NormalizedMarkdownSource {
  source: string;
  format: MarkdownSourceFormat;
}

export function normalizeMarkdownSource(markdown: string): NormalizedMarkdownSource {
  const normalized = normalizeNewlines(markdown);
  if (normalized.startsWith('---')) {
    return { source: normalized, format: 'canonical' };
  }
  if (normalized.startsWith('```')) {
    return { source: extractLegacyFence(normalized), format: 'legacy-fenced' };
  }
  if (normalized.startsWith('\uFEFF')) {
    throw new Error('Frontmatter must start at byte 0 (no BOM).');
  }
  throw new Error('Expected YAML frontmatter at byte 0 or a legacy fenced block.');
}

