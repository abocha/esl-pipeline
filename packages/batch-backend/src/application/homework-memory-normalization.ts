export interface NormalizedHomeworkMarkdown {
  frontmatter: string | null;
  sections: { heading: string; content: string }[];
  plainText: string;
}

export function normalizeHomeworkMarkdown(markdown: string): NormalizedHomeworkMarkdown {
  const normalized = markdown.replaceAll('\r\n', '\n').trim();
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const frontmatter = frontmatterMatch?.[1]?.trim() ?? null;
  const body = frontmatterMatch ? normalized.slice(frontmatterMatch[0].length).trim() : normalized;

  const sectionRegex = /^###\s+(.+)$/gm;
  const matches = [...body.matchAll(sectionRegex)];
  const sections: { heading: string; content: string }[] = [];

  if (matches.length === 0) {
    sections.push({ heading: 'Document', content: body });
  } else {
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      if (!match) {
        continue;
      }
      const next = matches[index + 1];
      const start = match.index ?? 0;
      const contentStart = start + match[0].length;
      const end = next?.index ?? body.length;
      sections.push({
        heading: (match[1] ?? '').trim(),
        content: body.slice(contentStart, end).trim(),
      });
    }
  }

  const plainText = sections
    .map((section) => `${section.heading}\n${stripMarkdown(section.content)}`.trim())
    .join('\n\n')
    .trim();

  return {
    frontmatter,
    sections,
    plainText,
  };
}

function stripMarkdown(input: string): string {
  return input
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replaceAll(/[*_>#:-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}
