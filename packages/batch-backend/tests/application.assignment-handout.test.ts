import { describe, expect, it, vi } from 'vitest';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  assignmentPlainText,
  assignmentPronunciation,
  assignmentStudySegments,
  serializeAssignmentV1,
  validateAssignmentV1,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';

import { generateDraft } from '../src/application/generate-draft.js';
import { loadConfig } from '../src/config/env.js';
import { freshAssignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

describe('ESL-32 fresh handout and derived text boundary', () => {
  it('requires authored emoji in the provider schema and fresh admission; reads add no fallback', () => {
    const metadata = (ASSIGNMENT_RESPONSE_SCHEMA.schema as any).properties.metadata;
    expect(metadata.required).toContain('icon');
    for (const icon of ['🎧', '🌦️', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇻🇳', '1️⃣']) {
      const a = freshAssignmentFixture();
      a.metadata.icon = icon;
      expect(validateFreshAssignmentV1(a)).toEqual(a);
    }
    for (const icon of ['', ' ', 'headphones', '🎧 lesson', '🎧'.repeat(33), null]) {
      const a = freshAssignmentFixture();
      Object.assign(a.metadata, { icon });
      expect(() => validateFreshAssignmentV1(a)).toThrow('validation failed');
    }
    const { icon: _icon, ...metadataWithoutIcon } = freshAssignmentFixture().metadata;
    const old = { ...freshAssignmentFixture(), metadata: metadataWithoutIcon };
    const before = serializeAssignmentV1(old);
    expect(serializeAssignmentV1(validateAssignmentV1(old))).toBe(before);
    expect(() => validateFreshAssignmentV1(old)).toThrow('fresh-generation schema');
  });

  it('strips only paired presentation delimiters in speech and drill comparison without rewriting data', () => {
    const a = freshAssignmentFixture();
    a.input.studyText.turns[0]!.text = 'Use `will` and `go`. A lone ` stays.';
    a.pronunciation = {
      mode: 'rhythm_chunking',
      target: '`rhythm`',
      focus: 'Focus',
      action: 'Listen',
      deliverable: 'Practice',
      drills: [
        {
          text: '`First`, save it.',
          chunks: ['First,', '`save it`.'],
          stressedWords: ['`First`'],
          transcription: null,
        },
      ],
      naturalSentence: '`First`, save it.',
      contourCue: null,
    };
    const before = serializeAssignmentV1(a);
    expect(validateFreshAssignmentV1(a)).toEqual(a);
    expect(assignmentStudySegments(a)[0]!.text).toBe('Use will and go. A lone ` stays.');
    expect(assignmentPronunciation(a)).toMatchObject({
      target: 'rhythm',
      naturalSentence: 'First, save it.',
      drills: [{ text: 'First, save it.' }],
    });
    expect(serializeAssignmentV1(a)).toBe(before);
    expect(assignmentPlainText('`first\nsecond` `` ```code```')).toBe(
      '`first\nsecond` `` ```code```',
    );
    expect(assignmentPlainText('(`windy`) `subject + will + base verb` `open')).toBe(
      '(windy) subject + will + base verb `open',
    );
  });

  it.each(['v7 marker', 'v7 schema', 'new name without icon'])(
    'rejects %s before dispatch without repinning',
    async (kind) => {
      const prompt = promptPackageFixture();
      if (kind === 'v7 marker')
        prompt.requestEnvelope.instructions =
          'Assignment output contract: assignment_v1_generation_v7\nOld';
      if (kind === 'v7 schema')
        prompt.requestEnvelope.responseSchema = {
          ...ASSIGNMENT_RESPONSE_SCHEMA,
          name: 'assignment_v1_generation_v7',
        };
      if (kind === 'new name without icon') {
        const schema = structuredClone(ASSIGNMENT_RESPONSE_SCHEMA.schema) as any;
        delete schema.properties.metadata.properties.icon;
        schema.properties.metadata.required = schema.properties.metadata.required.filter(
          (f: string) => f !== 'icon',
        );
        prompt.requestEnvelope.responseSchema = { ...ASSIGNMENT_RESPONSE_SCHEMA, schema };
      }
      const before = JSON.stringify(prompt);
      const execute = vi.fn();
      await expect(
        generateDraft(
          { promptPackageId: prompt.id },
          {
            config: loadConfig(),
            promptPackages: {
              getById: vi.fn().mockResolvedValue(prompt),
              isSourceCanonical: async () => true,
            },
            executors: { openai: execute },
          },
        ),
      ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED' });
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(prompt)).toBe(before);
    },
  );

  it('rejects missing authored icon after mocked provider receipt', async () => {
    const a = freshAssignmentFixture();
    const { icon: _icon, ...metadata } = a.metadata;
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify({ ...a, metadata }) });
    const config = loadConfig();
    config.generation.safetyMode = 'off';
    await expect(
      generateDraft(
        { promptPackageId: 'prompt-1' },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
            isSourceCanonical: async () => true,
          },
          executors: { openai: execute },
        },
      ),
    ).rejects.toMatchObject({ category: 'provider_contract_error' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
