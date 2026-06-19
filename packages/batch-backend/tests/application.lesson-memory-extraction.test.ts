import { describe, expect, it, vi } from 'vitest';

import {
  LESSON_MEMORY_CONTENT_JSON_SCHEMA,
  LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
  validateLessonMemoryContent,
} from '../src/application/lesson-memory-content-schema.js';
import {
  extractLessonMemoryContent,
  LessonMemoryExtractionValidationError,
} from '../src/application/lesson-memory-extraction.js';
import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createGenerationConfig(): BatchBackendConfig['generation'] {
  return loadConfig().generation;
}

function createLessonMemoryContent() {
  return {
    lessonSummary: 'The student practiced travel vocabulary and article usage.',
    topicsDiscussed: [{ topic: 'Travel plans', note: 'Talked about a summer trip to Japan.' }],
    mistakePatterns: [
      {
        label: 'Article choice',
        explanation: 'The student often omitted articles before singular count nouns.',
        reviewRecommended: true,
        confidence: 'high' as const,
        evidence: [
          {
            observedForm: 'I booked ticket',
            suggestedTarget: 'I booked a ticket',
            evidenceQuote: 'I booked ticket yesterday',
            evidenceNote: 'Repeated twice in a similar form.',
            confidenceNote: null,
          },
        ],
      },
    ],
    grammarReviewed: [{ name: 'Articles', note: 'Reviewed a/an with travel nouns.' }],
    grammarWatchlist: [{ name: 'Articles', note: 'Keep reinforcing article use in stories.' }],
    vocabularyFocus: [{ text: 'itinerary', note: 'New travel-planning word from the lesson.' }],
    pronunciationFocus: [
      {
        label: 'Word stress in itinerary',
        note: 'Stress placement was inconsistent.',
        confidence: 'medium' as const,
        evidence: [
          {
            observedIssue: 'Stress drift on itinerary',
            focusWords: ['itinerary'],
            evidenceQuote: null,
            evidenceNote: 'Teacher corrected stress placement once.',
            confidenceNote: null,
          },
        ],
      },
    ],
    studentFacts: [
      {
        fact: 'The student plans to visit Japan this summer.',
        category: 'personal_plan',
        authority: 'student_stated' as const,
        confidence: 'high' as const,
        evidence: [
          {
            quote: 'I want to go to Japan this summer.',
            speakerRole: 'student' as const,
            evidenceNote: null,
            transcriptSpan: null,
          },
        ],
        reviewNeeded: false,
      },
    ],
    progressSignals: [
      {
        label: 'Longer answers',
        note: 'The student produced longer answers than in recent lessons.',
      },
    ],
    followUpRecommendations: [
      {
        label: 'Review article use in travel retell',
        note: 'Use a retell task with article prompts.',
      },
    ],
  };
}

describe('application/lesson-memory-content-schema', () => {
  it('validates canonical lesson-memory content', () => {
    const parsed = validateLessonMemoryContent(createLessonMemoryContent());
    expect(parsed.lessonSummary).toContain('travel vocabulary');
  });

  it('rejects missing required top-level fields', () => {
    expect(() =>
      validateLessonMemoryContent({
        lessonSummary: 'Only summary',
      }),
    ).toThrow();
  });
});

describe('application/lesson-memory-extraction', () => {
  it('builds a labelled transcript envelope with trusted extraction policy', () => {
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: 'transcript-1',
      transcriptText: 'Student: I goed there.',
      teacherNotes: 'Focus on past tense.',
    });

    expect(envelope.instructions).toContain('canonical structured lesson memory');
    expect(envelope.input).toContain('id="transcript:transcript-1"');
    expect(envelope.input).toContain('Focus on past tense.');
  });

  it('uses the structured schema contract and returns validated content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: createLessonMemoryContent(),
      rawText: '{"lessonSummary":"..."}',
      providerRequestId: 'resp-lesson-1',
      usage: { totalTokens: 42 },
    });

    const result = await extractLessonMemoryContent({
      config: createGenerationConfig(),
      request: {
        provider: 'openai',
        model: 'gpt-5.4',
        prompt: 'Extract lesson memory',
      },
      executors: {
        openai: executor,
      },
    });

    expect(result.content.lessonSummary).toContain('travel vocabulary');
    expect(result.providerRequestId).toBe('resp-lesson-1');
    expect(result.usage?.totalTokens).toBe(42);

    expect(executor).toHaveBeenCalledWith({
      config: createGenerationConfig(),
      request: {
        model: 'gpt-5.4',
        prompt: 'Extract lesson memory',
        maxOutputTokens: undefined,
        responseSchema: {
          name: LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
          description: LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
          schema: LESSON_MEMORY_CONTENT_JSON_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it('raises a dedicated validation error for malformed structured content', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: {
        lessonSummary: 'Summary only',
      },
      rawText: '{"lessonSummary":"Summary only"}',
    });

    await expect(
      extractLessonMemoryContent({
        config: createGenerationConfig(),
        request: {
          provider: 'google_ai_studio',
          model: 'gemini-3.1-pro-preview',
          prompt: 'Extract lesson memory',
        },
        executors: {
          google_ai_studio: executor,
        },
      }),
    ).rejects.toBeInstanceOf(LessonMemoryExtractionValidationError);
  });
});
