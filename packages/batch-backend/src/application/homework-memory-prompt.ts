import type { HomeworkMemorySourceBundle } from './homework-memory-source.js';
import type { NormalizedHomeworkMarkdown } from './homework-memory-normalization.js';

export function buildHomeworkMemoryPrompt(args: {
  normalizedMarkdown: NormalizedHomeworkMarkdown;
  source: Pick<HomeworkMemorySourceBundle, 'publishTargets' | 'publishedAt' | 'assignmentLineageKey'>;
}): string {
  return [
    'You are generating canonical homework memory for one published ESL assignment.',
    'Focus on the student-facing assignment, pedagogic targets, compact teacher follow-up cues, and review continuity.',
    'Ignore decorative markdown formatting and layout fluff.',
    'Do not reproduce the full study text or answer key.',
    '',
    '[PUBLISH_METADATA]',
    JSON.stringify(
      {
        assignmentLineageKey: args.source.assignmentLineageKey,
        publishTargets: args.source.publishTargets,
        publishedAt: args.source.publishedAt.toISOString(),
      },
      null,
      2,
    ),
    '',
    '[FRONTMATTER]',
    args.normalizedMarkdown.frontmatter ?? '(none)',
    '',
    '[SECTIONS]',
    JSON.stringify(args.normalizedMarkdown.sections, null, 2),
    '',
    '[PLAIN_TEXT]',
    args.normalizedMarkdown.plainText || '(empty assignment)',
  ].join('\n');
}
