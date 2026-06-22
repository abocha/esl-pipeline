import { describe, expect, it } from 'vitest';

import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import { validateStudentMemoryOpenAiBatchResponse } from '../src/application/student-memory-openai-batch-validation.js';
import { loadConfig } from '../src/config/env.js';

describe('application/student-memory-openai-batch-validation', () => {
  it('uses the online lesson validator and rejects invented evidence source ids', async () => {
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: 'transcript-1',
      transcriptText: 'Student: I goed there.',
    });
    const response = {
      id: 'resp_1',
      output_text: JSON.stringify({
        lessonSummary: 'The learner used a past-tense error.',
        topicsDiscussed: [],
        mistakePatterns: [
          {
            pattern: 'Past tense',
            examples: ['I goed there'],
            impact: 'clarity',
            evidence: [{ sourceId: 'invented-source', excerpt: 'I goed there' }],
          },
        ],
        grammarReviewed: [],
        grammarWatchlist: [],
        vocabularyFocus: [],
        pronunciationFocus: [],
        studentFacts: [],
        progressSignals: [],
        followUpRecommendations: [],
      }),
    };

    await expect(
      validateStudentMemoryOpenAiBatchResponse({
        config: loadConfig().generation,
        item: { workload: 'lesson_memory', model: 'gpt-5.4-nano', requestEnvelope: envelope },
        response,
      }),
    ).rejects.toThrow('Lesson-memory extraction output failed schema validation');
  });
});
