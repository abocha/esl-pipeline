import { createGenerationRequestEnvelope } from './generation-request-envelope.js';
import {
  HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
} from './homework-memory-content-schema.js';
import type { NormalizedHomeworkMarkdown } from './homework-memory-normalization.js';
import type { HomeworkMemorySourceBundle } from './homework-memory-source.js';

export function buildHomeworkMemoryEnvelope(args: {
  normalizedMarkdown?: NormalizedHomeworkMarkdown;
  source: Pick<
    HomeworkMemorySourceBundle,
    'publishTargets' | 'publishedAt' | 'assignmentLineageKey' | 'assignment' | 'artifact' | 'format'
  >;
}) {
  if (!args.source.assignment && !args.normalizedMarkdown)
    throw new Error('Legacy homework source missing Markdown normalization');
  return createGenerationRequestEnvelope({
    workload: 'homework_memory',
    instructions: [
      'You are generating canonical homework memory for one published ESL assignment.',
      'Focus on student-facing pedagogic targets, compact teacher follow-up cues, and review continuity.',
      'Do not reproduce the full study text or answer key.',
    ].join('\n'),
    sources: [
      {
        id: `assignment:${args.source.assignmentLineageKey}`,
        label: 'PUBLISHED_ASSIGNMENT',
        content: JSON.stringify(
          {
            publishMetadata: args.source.assignment
              ? {
                  assignmentLineageKey: args.source.assignmentLineageKey,
                  publishTargets: args.source.publishTargets,
                  publishedAt: args.source.publishedAt,
                }
              : args.source,
            ...(args.source.assignment
              ? {
                  format: 'assignment_v1',
                  artifact: args.source.artifact,
                  assignment: args.source.assignment,
                }
              : {
                  format: 'markdown',
                  frontmatter: args.normalizedMarkdown!.frontmatter,
                  sections: args.normalizedMarkdown!.sections,
                  plainText: args.normalizedMarkdown!.plainText,
                }),
          },
          null,
          2,
        ),
      },
    ],
    responseSchema: {
      name: HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
      description: HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
      schema: HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
      strict: true,
    },
  });
}

export function buildHomeworkMemoryPrompt(args: {
  normalizedMarkdown?: NormalizedHomeworkMarkdown;
  source: Pick<
    HomeworkMemorySourceBundle,
    'publishTargets' | 'publishedAt' | 'assignmentLineageKey' | 'assignment' | 'artifact' | 'format'
  >;
}): string {
  if (args.source.assignment)
    return [
      'You are generating canonical homework memory for one published ESL assignment.',
      'Focus on pedagogic targets and teacher follow-up. Do not reproduce the full study text or answer key.',
      '[PUBLISHED_ASSIGNMENT_V1]',
      JSON.stringify(
        {
          artifact: args.source.artifact,
          assignment: args.source.assignment,
          publishTargets: args.source.publishTargets,
          publishedAt: args.source.publishedAt,
        },
        null,
        2,
      ),
    ].join('\n');
  if (!args.normalizedMarkdown)
    throw new Error('Legacy homework source missing Markdown normalization');
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
