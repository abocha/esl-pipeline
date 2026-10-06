import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  type AssignmentV1,
  serializeAssignmentV1,
  validateAssignmentV1,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';

import missionFixture from '../../contracts/tests/assignment-mission-fixture.json';
import { generateDraft } from '../src/application/generate-draft.js';
import { loadConfig } from '../src/config/env.js';
import {
  assignmentFixture,
  freshAssignmentFixture,
  promptPackageFixture,
} from './assignment-v1.test-harness.js';

function generation(
  execute: (args: unknown) => Promise<{ rawText: string }>,
  prompt = promptPackageFixture(),
) {
  const config = loadConfig();
  config.generation.safetyMode = 'off';
  return generateDraft(
    { promptPackageId: 'prompt-1' },
    {
      config,
      promptPackages: {
        getById: vi.fn().mockResolvedValue(prompt),
        isSourceCanonical: async () => true,
      },
      executors: { openai: execute },
    },
  );
}

describe('AssignmentV1 grammar composition', () => {
  it('preserves post-ESL-25 flat grammar canonical bytes/hash with no inserted fields', () => {
    const before = JSON.stringify(missionFixture);
    const read = validateAssignmentV1(missionFixture);
    expect(read).toEqual(missionFixture);
    expect(serializeAssignmentV1(read)).toBe(serializeAssignmentV1(missionFixture as AssignmentV1));
    expect(createHash('sha256').update(serializeAssignmentV1(read)).digest('hex')).toBe(
      '35cefa61cd8a753041cd12cdbcb28b680f9f4fde554a9ba4ad9e8efbbaac9f02',
    );
    expect(JSON.stringify(missionFixture)).toBe(before);
    expect(() => validateFreshAssignmentV1(missionFixture)).toThrow('fresh-generation schema');
  });

  it('admits legacy/structured grammar independently of assignment roles and without rewriting', () => {
    for (const base of [
      assignmentFixture(),
      missionFixture as AssignmentV1,
      freshAssignmentFixture(),
    ]) {
      const mixedItems = {
        ...base,
        toolkit: {
          ...base.toolkit,
          grammar: [
            assignmentFixture().toolkit.grammar[0]!,
            freshAssignmentFixture().toolkit.grammar[0]!,
          ],
        },
      };
      const before = serializeAssignmentV1(mixedItems);
      expect(serializeAssignmentV1(validateAssignmentV1(mixedItems))).toBe(before);
      expect(() => validateFreshAssignmentV1(mixedItems)).toThrow('fresh-generation schema');
    }
  });

  it('admits structured forms with no comparison or general-array padding', () => {
    const input = freshAssignmentFixture();
    Object.assign(input.toolkit.grammar[0]!, {
      comparisons: [],
      examples: [],
      uses: [],
      traps: [],
    });
    expect(validateFreshAssignmentV1(input)).toEqual(input);
  });

  it.each([
    'form',
    'missing formBlocks',
    'missing comparisons',
    'empty formBlocks',
    'empty block examples',
    'one alternative',
    'three alternatives',
    'partial alternative',
    'extra field',
    'blank pattern',
  ])('rejects ambiguous or invalid structured grammar: %s', (kind) => {
    const input = freshAssignmentFixture();
    const grammar = input.toolkit.grammar[0]! as any;
    switch (kind) {
      case 'form':
        grammar.form = null;
        break;
      case 'missing formBlocks':
        delete grammar.formBlocks;
        break;
      case 'missing comparisons':
        delete grammar.comparisons;
        break;
      case 'empty formBlocks':
        grammar.formBlocks = [];
        break;
      case 'empty block examples':
        grammar.formBlocks[0].examples = [];
        break;
      case 'one alternative':
        grammar.comparisons[0].alternatives.pop();
        break;
      case 'three alternatives':
        grammar.comparisons[0].alternatives.push(grammar.comparisons[0].alternatives[0]);
        break;
      case 'partial alternative':
        delete grammar.comparisons[0].alternatives[0].explanation;
        break;
      case 'extra field':
        grammar.formBlocks[0].id = 'form-1';
        break;
      case 'blank pattern':
        grammar.formBlocks[0].pattern = ' ';
        break;
    }
    expect(() => validateAssignmentV1(input)).toThrow('validation failed');
    expect(() => validateFreshAssignmentV1(input)).toThrow('validation failed');
  });

  it.each(['formBlocks', 'comparisons'] as const)(
    'rejects legacy grammar mixed with %s',
    (field) => {
      const input = assignmentFixture();
      Object.assign(input.toolkit.grammar[0]!, {
        [field]: freshAssignmentFixture().toolkit.grammar[0]![field],
      });
      expect(() => validateAssignmentV1(input)).toThrow('schema validation');
    },
  );

  it('projects only closed structured grammar with enforced form examples and paired alternatives', () => {
    const grammar = (ASSIGNMENT_RESPONSE_SCHEMA.schema as any).properties.toolkit.properties.grammar
      .items;
    expect(ASSIGNMENT_RESPONSE_SCHEMA.name).toBe('assignment_v1_grammar_v4');
    expect(grammar.anyOf).toBeUndefined();
    expect(grammar.additionalProperties).toBe(false);
    expect(grammar.properties.form).toBeUndefined();
    expect(grammar.required).toEqual([
      'name',
      'explanation',
      'examples',
      'uses',
      'traps',
      'formBlocks',
      'comparisons',
    ]);
    expect(grammar.properties.formBlocks.minItems).toBe(1);
    expect(grammar.properties.formBlocks.items.required).toEqual(['label', 'pattern', 'examples']);
    expect(grammar.properties.formBlocks.items.properties.examples.minItems).toBe(1);
    const comparison = grammar.properties.comparisons.items;
    expect(comparison.required).toEqual(['label', 'alternatives']);
    expect(comparison.additionalProperties).toBe(false);
    expect(comparison.properties.alternatives.minItems).toBe(2);
    expect(comparison.properties.alternatives.maxItems).toBe(2);
    expect(comparison.properties.alternatives.items.required).toEqual([
      'label',
      'example',
      'explanation',
    ]);
    expect(comparison.properties.alternatives.items.additionalProperties).toBe(false);
    for (const field of ['comparisons', 'examples', 'uses', 'traps'])
      expect(grammar.properties[field].minItems).toBeUndefined();
  });

  it.each(['stale package', 'stale template', 'stale schema', 'old schema with new name'])(
    'rejects %s before provider dispatch without repinning',
    async (kind) => {
      const prompt = promptPackageFixture();
      if (kind === 'stale package' || kind === 'stale template')
        prompt.requestEnvelope.instructions =
          'Assignment output contract: assignment_v1_mission_v3\nCreate a useful assignment.';
      if (kind !== 'stale template') {
        const schema = structuredClone(ASSIGNMENT_RESPONSE_SCHEMA.schema) as any;
        const grammar = schema.properties.toolkit.properties.grammar.items;
        delete grammar.properties.formBlocks;
        delete grammar.properties.comparisons;
        grammar.properties.form = { type: ['string', 'null'] };
        grammar.required = [
          ...grammar.required.filter(
            (field: string) => !['formBlocks', 'comparisons'].includes(field),
          ),
          'form',
        ];
        prompt.requestEnvelope.responseSchema = {
          ...ASSIGNMENT_RESPONSE_SCHEMA,
          name:
            kind === 'old schema with new name'
              ? ASSIGNMENT_RESPONSE_SCHEMA.name
              : 'assignment_v1_mission_v3',
          schema,
        };
      }
      const before = JSON.stringify(prompt);
      const execute = vi.fn();
      await expect(generation(execute, prompt)).rejects.toMatchObject({
        code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED',
      });
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(prompt)).toBe(before);
    },
  );

  it.each(['all legacy', 'one legacy'])(
    'rejects fresh provider output with %s grammar after receipt',
    async (kind) => {
      const input = freshAssignmentFixture();
      const grammar =
        kind === 'all legacy'
          ? missionFixture.toolkit.grammar
          : [...input.toolkit.grammar, missionFixture.toolkit.grammar[0]!];
      const execute = vi.fn().mockResolvedValue({
        rawText: JSON.stringify({ ...input, toolkit: { ...input.toolkit, grammar } }),
      });
      await expect(generation(execute)).rejects.toMatchObject({
        category: 'provider_contract_error',
      });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts fully structured provider grammar', async () => {
    const input = freshAssignmentFixture();
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify(input) });
    const result = await generation(execute);
    expect(result?.assignment).toEqual(input);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
