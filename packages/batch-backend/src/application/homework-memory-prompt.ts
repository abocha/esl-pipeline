import { createGenerationRequestEnvelope } from './generation-request-envelope.js';
import { requireTypedAssignment } from './historical-assignment.js';
import {
  HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
} from './homework-memory-content-schema.js';
import type { HomeworkMemorySourceBundle } from './homework-memory-source.js';

export function buildHomeworkMemoryEnvelope(args: {
  source: Pick<
    HomeworkMemorySourceBundle,
    'publishTargets' | 'publishedAt' | 'assignmentLineageKey' | 'assignment' | 'artifact' | 'format'
  >;
}) {
  requireTypedAssignment(args.source.assignment);
  return createGenerationRequestEnvelope({
    workload: 'homework_memory',
    promptVersion: 'learner_memory_generation_v2',
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
            publishMetadata: {
              assignmentLineageKey: args.source.assignmentLineageKey,
              publishTargets: args.source.publishTargets,
              publishedAt: args.source.publishedAt,
            },
            format: 'assignment_v1',
            artifact: args.source.artifact,
            assignment: args.source.assignment,
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
