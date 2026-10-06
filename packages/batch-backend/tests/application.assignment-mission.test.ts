import { describe, expect, it, vi } from 'vitest';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  type AssignmentV1,
  serializeAssignmentV1,
  validateAssignmentV1,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';

import rationaleFixture from '../../contracts/tests/assignment-rationale-fixture.json';
import { generateDraft } from '../src/application/generate-draft.js';
import { loadConfig } from '../src/config/env.js';
import {
  assignmentFixture,
  freshAssignmentFixture,
  promptPackageFixture,
} from './assignment-v1.test-harness.js';

const missionFields = ['preparation', 'requirements', 'delivery', 'selfCheck'] as const;

describe('AssignmentV1 mission composition', () => {
  it('admits independent rationale/mission read forms without adding or normalizing data', () => {
    for (const assignment of [assignmentFixture(), rationaleFixture as AssignmentV1]) {
      for (const outputTask of [assignment.outputTask, freshAssignmentFixture().outputTask]) {
        const input = { ...assignment, outputTask };
        const before = serializeAssignmentV1(input);
        const original = JSON.stringify(input);
        const read = validateAssignmentV1(input);
        expect(read).toEqual(input);
        expect(serializeAssignmentV1(read)).toBe(before);
        expect(JSON.stringify(input)).toBe(original);
      }
      expect(() => validateFreshAssignmentV1(assignment)).toThrow('fresh-generation schema');
    }
  });

  it('admits a complete mission and a minimal mission without padding', () => {
    const complete = freshAssignmentFixture();
    expect(validateFreshAssignmentV1(complete)).toEqual(complete);
    const minimal = {
      ...complete,
      outputTask: {
        ...complete.outputTask,
        preparation: [],
        requirements: [],
        delivery: null,
        selfCheck: [],
        extension: null,
      },
    };
    expect(validateFreshAssignmentV1(minimal)).toEqual(minimal);
  });

  it.each(missionFields)(
    'rejects a partial structured mission missing %s in both admissions',
    (field) => {
      const input = freshAssignmentFixture();
      delete (input.outputTask as Record<string, unknown>)[field];
      expect(() => validateAssignmentV1(input)).toThrow('schema validation');
      expect(() => validateFreshAssignmentV1(input)).toThrow('schema validation');
    },
  );

  it.each(missionFields)('rejects legacy mission mixed with only %s', (field) => {
    const input = assignmentFixture();
    Object.assign(input.outputTask, { [field]: freshAssignmentFixture().outputTask[field] });
    expect(() => validateAssignmentV1(input)).toThrow('schema validation');
  });

  it.each([
    { preparation: null },
    { requirements: 'Include the steps.' },
    { selfCheck: [null] },
    { delivery: [] },
    { layout: 'cards' },
  ])('rejects invalid mission role types or layout fields: %j', (fields) => {
    const input = freshAssignmentFixture();
    Object.assign(input.outputTask, fields);
    expect(() => validateAssignmentV1(input)).toThrow('schema validation');
    expect(() => validateFreshAssignmentV1(input)).toThrow('schema validation');
  });

  it.each([
    { preparation: [' '] },
    { requirements: [''] },
    { delivery: ' ' },
    { selfCheck: ['\n'] },
  ])('rejects blank mission text instead of silently normalizing it: %j', (fields) => {
    const input = freshAssignmentFixture();
    Object.assign(input.outputTask, fields);
    expect(() => validateFreshAssignmentV1(input)).toThrow('meaningful text');
  });

  it('projects only the closed structured mission with required fields and meaningful absence', () => {
    const schema = ASSIGNMENT_RESPONSE_SCHEMA.schema as any;
    const output = schema.properties.outputTask;
    expect(ASSIGNMENT_RESPONSE_SCHEMA.name).toBe('assignment_v1_generation_v5');
    expect(output.additionalProperties).toBe(false);
    expect(output).not.toHaveProperty('anyOf');
    expect(output.required).toEqual([
      'task',
      'preparation',
      'requirements',
      'delivery',
      'selfCheck',
      'extension',
      'sampleResponse',
    ]);
    for (const field of ['preparation', 'requirements', 'selfCheck'])
      expect(output.properties[field]).toEqual({ type: 'array', items: { type: 'string' } });
    expect(output.properties.delivery).toEqual({ type: ['string', 'null'] });
    expect(output.properties.task).toEqual({ type: 'string' });
    expect(output.properties.sampleResponse).toEqual({ type: 'string' });
  });

  it('rejects old mission shape even when the provider returns the new rationale fields', async () => {
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify(rationaleFixture) });
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

  it.each(['both stale', 'stale instructions', 'stale schema', 'old schema with new name'])(
    'rejects ESL-24 pins (%s) before dispatch without rewriting stored pins',
    async (kind) => {
      const prompt = promptPackageFixture();
      if (kind === 'both stale' || kind === 'stale instructions')
        prompt.requestEnvelope.instructions =
          'Assignment output contract: assignment_v1_rationale_v2\nCreate a useful assignment.';
      if (kind !== 'stale instructions') {
        const schema = structuredClone(ASSIGNMENT_RESPONSE_SCHEMA.schema) as any;
        const output = schema.properties.outputTask;
        for (const field of missionFields) delete output.properties[field];
        output.required = output.required.filter(
          (field: string) => !missionFields.includes(field as (typeof missionFields)[number]),
        );
        prompt.requestEnvelope.responseSchema = {
          ...ASSIGNMENT_RESPONSE_SCHEMA,
          name:
            kind === 'old schema with new name'
              ? ASSIGNMENT_RESPONSE_SCHEMA.name
              : 'assignment_v1_rationale_v2',
          schema,
        };
      }
      const before = JSON.stringify(prompt);
      const execute = vi.fn();
      await expect(
        generateDraft(
          { promptPackageId: 'stale' },
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
});
