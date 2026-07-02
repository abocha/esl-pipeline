import { describe, expect, it, vi } from 'vitest';

import {
  STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
  validateStudentMemorySnapshotContent,
} from '../src/application/student-memory-snapshot-content-schema.js';
import {
  extractStudentMemorySnapshotContent,
  StudentMemorySnapshotExtractionValidationError,
} from '../src/application/student-memory-snapshot-extraction.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createGenerationConfig(): BatchBackendConfig['generation'] {
  return loadConfig().generation;
}

function createStudentMemorySnapshotContent() {
  return {
    stableStrengths: [
      {
        label: 'Longer spoken answers',
        note: 'The student now sustains answers for 4-5 sentences with less prompting.',
      },
    ],
    recurringIssues: [
      {
        label: 'Present perfect vs past simple',
        issueType: 'grammar' as const,
        note: 'The distinction still breaks down when talking about life experience.',
        confidence: 'high' as const,
      },
    ],
    activeReviewBacklog: [
      {
        label: 'Travel retell review',
        note: 'Keep revisiting recent-travel storytelling with tense contrast.',
      },
    ],
    recentProgress: [
      {
        label: 'Fluency',
        note: 'The student hesitates less before answering open questions.',
      },
    ],
    personalFacts: [
      {
        fact: 'The student plans to travel to Japan this summer.',
        category: 'personal_plan',
        authority: 'student_stated' as const,
        confidence: 'high' as const,
        evidence: [
          {
            sourceId: 'lesson-memory:lesson-1',
            quote: 'I want to go to Japan this summer.',
            speakerRole: 'student' as const,
            evidenceNote: null,
            transcriptSpan: null,
          },
        ],
        reviewNeeded: false,
      },
    ],
    recommendedAssignmentDirections: [
      {
        direction: 'Use a travel retell mission grounded in a recent study text.',
        rationale: 'It reinforces tense contrast without adding heavy creative burden.',
      },
    ],
    unresolvedIssues: [
      {
        label: 'Tense contrast in storytelling',
        issueType: 'grammar' as const,
        note: 'Still needs repeated contrastive practice in realistic narratives.',
        priority: 'high' as const,
      },
    ],
    snapshotSummary:
      'The student is more fluent and more willing to speak, but tense contrast in personal storytelling still needs active review.',
  };
}

describe('application/student-memory-snapshot-content-schema', () => {
  it('validates canonical student-memory snapshot content', () => {
    const parsed = validateStudentMemorySnapshotContent(createStudentMemorySnapshotContent());
    expect(parsed.snapshotSummary).toContain('more fluent');
  });

  it('rejects missing required top-level fields', () => {
    expect(() =>
      validateStudentMemorySnapshotContent({
        snapshotSummary: 'Summary only',
      }),
    ).toThrow();
  });
});

describe('application/student-memory-snapshot-extraction', () => {
  it('uses the structured schema contract and returns validated content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: createStudentMemorySnapshotContent(),
      rawText: '{"snapshotSummary":"..."}',
      providerRequestId: 'resp-snapshot-1',
      usage: { totalTokens: 87 },
    });

    const result = await extractStudentMemorySnapshotContent({
      config: createGenerationConfig(),
      request: {
        provider: 'openrouter',
        model: 'qwen/qwen3.5',
        prompt: 'Extract student memory snapshot',
      },
      executors: {
        openrouter: executor,
      },
    });

    expect(result.content.snapshotSummary).toContain('more fluent');
    expect(result.providerRequestId).toBe('resp-snapshot-1');
    expect(result.usage?.totalTokens).toBe(87);

    expect(executor).toHaveBeenCalledWith({
      config: createGenerationConfig(),
      request: {
        model: 'qwen/qwen3.5',
        prompt: 'Extract student memory snapshot',
        maxOutputTokens: undefined,
        responseSchema: {
          name: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
          description: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
          schema: STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it('accepts preserved personal-fact evidence that cites the previous snapshot source', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: {
        ...createStudentMemorySnapshotContent(),
        personalFacts: [
          {
            fact: 'The student plans to travel to Japan this summer.',
            category: 'personal_plan',
            authority: 'student_stated',
            confidence: 'high',
            evidence: [
              {
                sourceId: 'student-memory-snapshot:snapshot-parent',
                quote: 'I want to go to Japan this summer.',
                speakerRole: 'student',
                evidenceNote: 'Preserved from previous snapshot.',
                transcriptSpan: null,
              },
            ],
            reviewNeeded: false,
          },
        ],
      },
      rawText: '{"snapshotSummary":"..."}',
    });

    await expect(
      extractStudentMemorySnapshotContent({
        config: createGenerationConfig(),
        request: {
          provider: 'openai',
          model: 'gpt-5.4',
          prompt: 'Extract student memory snapshot',
          envelope: {
            version: 'generation_request_envelope_v1',
            promptVersion: 'generation_request_envelope_v1',
            workload: 'student_memory_snapshot',
            instructions: 'Use bounded sources.',
            input: '',
            settings: { reasoningEffort: 'low', textVerbosity: 'low' },
            sourceManifest: [
              { id: 'student-memory-snapshot:snapshot-parent', label: 'PREVIOUS_SNAPSHOT' },
              { id: 'lesson-memory:lesson-trigger', label: 'TRIGGER_LESSON_MEMORY_ENTRY' },
            ],
            sourceSelectionHash: 'hash',
          },
        },
        executors: {
          openai: executor,
        },
      }),
    ).resolves.toMatchObject({
      content: {
        personalFacts: [
          expect.objectContaining({
            evidence: [
              expect.objectContaining({
                sourceId: 'student-memory-snapshot:snapshot-parent',
              }),
            ],
          }),
        ],
      },
    });
  });

  it('rejects preserved personal-fact evidence that cites an old source outside the manifest', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: createStudentMemorySnapshotContent(),
      rawText: '{"snapshotSummary":"..."}',
    });

    await expect(
      extractStudentMemorySnapshotContent({
        config: createGenerationConfig(),
        request: {
          provider: 'openai',
          model: 'gpt-5.4',
          prompt: 'Extract student memory snapshot',
          envelope: {
            version: 'generation_request_envelope_v1',
            promptVersion: 'generation_request_envelope_v1',
            workload: 'student_memory_snapshot',
            instructions: 'Use bounded sources.',
            input: '',
            settings: { reasoningEffort: 'low', textVerbosity: 'low' },
            sourceManifest: [
              { id: 'student-memory-snapshot:snapshot-parent', label: 'PREVIOUS_SNAPSHOT' },
              { id: 'lesson-memory:lesson-trigger', label: 'TRIGGER_LESSON_MEMORY_ENTRY' },
            ],
            sourceSelectionHash: 'hash',
          },
        },
        executors: {
          openai: executor,
        },
      }),
    ).rejects.toThrow('Generated evidence references source IDs outside the request manifest');
  });

  it('raises a dedicated validation error for malformed structured content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: {
        snapshotSummary: 'Summary only',
      },
      rawText: '{"snapshotSummary":"Summary only"}',
    });

    await expect(
      extractStudentMemorySnapshotContent({
        config: createGenerationConfig(),
        request: {
          provider: 'openai',
          model: 'gpt-5.4',
          prompt: 'Extract student memory snapshot',
        },
        executors: {
          openai: executor,
        },
      }),
    ).rejects.toBeInstanceOf(StudentMemorySnapshotExtractionValidationError);
  });
});
