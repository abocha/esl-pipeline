import { describe, expect, it, vi } from 'vitest';

import {
  HomeworkMemoryExtractionValidationError,
  extractHomeworkMemoryContent,
} from '../src/application/homework-memory-extraction.js';
import {
  HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
  validateHomeworkMemoryContent,
} from '../src/application/homework-memory-content-schema.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createGenerationConfig(): BatchBackendConfig['generation'] {
  return loadConfig().generation;
}

function createHomeworkMemoryContent() {
  return {
    homeworkSummary: 'A travel-focused assignment reviewing articles and building spoken advice.',
    topic: 'Travel advice and planning',
    grammarTargets: [
      {
        name: 'Articles',
        note: 'Use a/an with travel nouns.',
        targetKind: 'review' as const,
      },
    ],
    vocabularyTargets: [
      {
        text: 'itinerary',
        note: 'Useful travel-planning vocabulary.',
        targetKind: 'new' as const,
      },
    ],
    reviewTargets: [{ label: 'Article use', note: 'Carry article accuracy into the mission.' }],
    taskList: [
      {
        section: 'Roadmap',
        task: 'Choose the full path or lighter version.',
        taskType: 'roadmap' as const,
        review: false,
      },
      {
        section: 'Mission',
        task: 'Give travel advice to the person in the study text.',
        taskType: 'mission' as const,
        review: true,
      },
    ],
    pronunciationFocus: [
      {
        mode: 'sentence_stress' as const,
        target: 'travel advice phrases',
        action: 'Stress key recommendation words.',
      },
    ],
    studyTextType: 'dialogue' as const,
    inputType: 'authentic' as const,
    communicativeOutcome: 'The student gives practical travel advice in spoken English.',
    teacherFollowUpCues: [
      {
        cueType: 'error_focus' as const,
        note: 'Check articles during retell and advice.',
      },
    ],
  };
}

describe('application/homework-memory-content-schema', () => {
  it('validates canonical homework-memory content', () => {
    const parsed = validateHomeworkMemoryContent(createHomeworkMemoryContent());
    expect(parsed.topic).toContain('Travel advice');
  });

  it('rejects missing required top-level fields', () => {
    expect(() =>
      validateHomeworkMemoryContent({
        homeworkSummary: 'summary only',
      }),
    ).toThrow();
  });
});

describe('application/homework-memory-extraction', () => {
  it('uses the structured schema contract and returns validated content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: createHomeworkMemoryContent(),
      rawText: '{"homeworkSummary":"..."}',
      providerRequestId: 'resp-homework-1',
      usage: { totalTokens: 57 },
    });

    const result = await extractHomeworkMemoryContent({
      config: createGenerationConfig(),
      request: {
        provider: 'openrouter',
        model: 'qwen/qwen3.5',
        prompt: 'Extract homework memory',
      },
      executors: {
        openrouter: executor,
      },
    });

    expect(result.content.topic).toContain('Travel advice');
    expect(result.providerRequestId).toBe('resp-homework-1');
    expect(result.usage?.totalTokens).toBe(57);

    expect(executor).toHaveBeenCalledWith({
      config: createGenerationConfig(),
      request: {
        model: 'qwen/qwen3.5',
        prompt: 'Extract homework memory',
        maxOutputTokens: undefined,
        responseSchema: {
          name: HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
          description: HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
          schema: HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it('raises a dedicated validation error for malformed structured content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: {
        homeworkSummary: 'Summary only',
      },
      rawText: '{"homeworkSummary":"Summary only"}',
    });

    await expect(
      extractHomeworkMemoryContent({
        config: createGenerationConfig(),
        request: {
          provider: 'openai',
          model: 'gpt-5.4',
          prompt: 'Extract homework memory',
        },
        executors: {
          openai: executor,
        },
      }),
    ).rejects.toBeInstanceOf(HomeworkMemoryExtractionValidationError);
  });
});
