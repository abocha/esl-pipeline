import { describe, expect, it, vi } from 'vitest';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  validateAssignmentV1,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';

import { generateDraft } from '../src/application/generate-draft.js';
import { loadConfig } from '../src/config/env.js';
import {
  assignmentFixture,
  freshAssignmentFixture,
  promptPackageFixture,
} from './assignment-v1.test-harness.js';

const invalidShapes = () => {
  const { learnerRationale, teacherRationale, ...rest } = freshAssignmentFixture();
  return [
    { ...rest, learnerRationale, teacherRationale, rationale: 'ESL24_AMBIGUOUS_LEGACY_ONLY' },
    rest,
    { ...rest, learnerRationale },
    { ...rest, teacherRationale },
    { ...rest, learnerRationale, teacherRationale: undefined },
    { ...assignmentFixture(), learnerRationale },
    { ...assignmentFixture(), teacherRationale: null },
  ];
};

describe('AssignmentV1 rationale admission', () => {
  it('reads legacy without inserting new fields and admits both complete new shapes', () => {
    const legacy = assignmentFixture();
    expect(validateAssignmentV1(legacy)).toEqual(legacy);
    expect(validateAssignmentV1(legacy)).not.toHaveProperty('learnerRationale');
    expect(validateAssignmentV1(legacy)).not.toHaveProperty('teacherRationale');
    for (const teacherRationale of [freshAssignmentFixture().teacherRationale, null]) {
      const fresh = { ...freshAssignmentFixture(), teacherRationale };
      expect(validateAssignmentV1(fresh)).toEqual(fresh);
      expect(validateFreshAssignmentV1(fresh)).toEqual(fresh);
    }
    expect(() => validateFreshAssignmentV1(legacy)).toThrow('fresh-generation schema');
  });

  it.each(invalidShapes().map((output, i) => [i, output] as const))(
    'rejects mixed, missing or partial rationale shape %s in both admissions',
    (_i, output) => {
      expect(() => validateAssignmentV1(output)).toThrow('schema validation');
      expect(() => validateFreshAssignmentV1(output)).toThrow('schema validation');
    },
  );

  it('projects required learner and nullable teacher rationale, excluding root rationale', () => {
    const schema = ASSIGNMENT_RESPONSE_SCHEMA.schema as any;
    expect(schema.required).toContain('learnerRationale');
    expect(schema.required).toContain('teacherRationale');
    expect(schema.required).not.toContain('rationale');
    expect(schema.properties).not.toHaveProperty('rationale');
    expect(schema.properties.teacherRationale).toEqual({ type: ['string', 'null'] });
    expect(schema.additionalProperties).toBe(false);
  });

  it.each(['teacher', 'null', 'legacy', ...invalidShapes().map((_v, i) => i)] as const)(
    'enforces fresh shape after provider response: %s',
    async (shape) => {
      const output =
        typeof shape === 'number'
          ? invalidShapes()[shape]
          : shape === 'legacy'
            ? assignmentFixture()
            : {
                ...freshAssignmentFixture(),
                teacherRationale:
                  shape === 'null' ? null : freshAssignmentFixture().teacherRationale,
              };
      const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify(output) });
      const config = loadConfig();
      config.generation.safetyMode = 'off';
      const operation = generateDraft(
        { promptPackageId: 'prompt-1' },
        {
          config,
          promptPackages: {
            getById: vi.fn().mockResolvedValue(promptPackageFixture()),
            isSourceCanonical: async () => true,
          },
          executors: { openai: execute },
        },
      );
      const outcome = await operation.catch((error: unknown) => error);
      expect(outcome).toMatchObject(
        shape === 'teacher' || shape === 'null'
          ? { assignment: output }
          : {
              category: 'provider_contract_error',
              message: expect.stringContaining('fresh-generation schema'),
            },
      );
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['old package', 'new schema with old instructions', 'old schema with new instructions'])(
    'rejects %s before provider invocation without rewriting pins',
    async (kind) => {
      const old = promptPackageFixture();
      if (kind !== 'old schema with new instructions')
        old.requestEnvelope.instructions =
          'Assignment output contract: assignment_v1\nExplain why this mission helps this learner with supported evidence.';
      if (kind !== 'new schema with old instructions') {
        const schema = structuredClone(ASSIGNMENT_RESPONSE_SCHEMA.schema) as any;
        schema.properties.rationale = schema.properties.learnerRationale;
        delete schema.properties.learnerRationale;
        delete schema.properties.teacherRationale;
        schema.required = schema.required.filter(
          (key: string) => !['learnerRationale', 'teacherRationale'].includes(key),
        );
        schema.required.push('rationale');
        old.requestEnvelope.responseSchema = {
          ...ASSIGNMENT_RESPONSE_SCHEMA,
          name: 'assignment_v1',
          schema,
        };
      }
      const before = JSON.stringify(old);
      const execute = vi.fn();
      await expect(
        generateDraft(
          { promptPackageId: 'stale' },
          {
            config: loadConfig(),
            promptPackages: {
              getById: vi.fn().mockResolvedValue(old),
              isSourceCanonical: async () => true,
            },
            executors: { openai: execute },
          },
        ),
      ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED' });
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(old)).toBe(before);
    },
  );
});
