import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  ASSIGNMENT_TEMPLATE_CONTRACT,
  ASSIGNMENT_TEMPLATE_ID,
  type AssignmentV1,
  serializeAssignmentV1,
  validateAssignmentV1,
  validateFreshAssignmentV1,
} from '@esl-pipeline/contracts';

import grammarFixture from '../../contracts/tests/assignment-grammar-fixture.json';
import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { generateDraft } from '../src/application/generate-draft.js';
import { isGenerationRequestEnvelope } from '../src/application/generation-request-envelope.js';
import { loadConfig } from '../src/config/env.js';
import {
  createConfig,
  createProfileRevisionRepositoryStub,
  createPromptOptionsStub,
  createPromptPackageRepositoryStub,
  createStorageStub,
  createTemplateRevisionRepositoryStub,
  createTranscriptRecord,
} from './application.prompt-package.test-harness.js';
import { freshAssignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';

describe('AssignmentV1 generation policy boundary', () => {
  it('preserves the pre-language structured assignment identity without inserted metadata', () => {
    const before = serializeAssignmentV1(grammarFixture as AssignmentV1);
    const read = validateAssignmentV1(grammarFixture);
    expect(serializeAssignmentV1(read)).toBe(before);
    expect(read.metadata).not.toHaveProperty('instructionLanguage');
    expect(() => validateFreshAssignmentV1(grammarFixture)).toThrow('fresh-generation schema');
  });

  it('requires a language tag in the closed fresh provider metadata', () => {
    const metadata = (ASSIGNMENT_RESPONSE_SCHEMA.schema as any).properties.metadata;
    expect(ASSIGNMENT_RESPONSE_SCHEMA.name).toBe('assignment_v1_generation_v7');
    expect(metadata.required).toContain('instructionLanguage');
    expect(metadata.additionalProperties).toBe(false);
    for (const language of ['en', 'ru', 'pt-BR']) {
      const assignment = freshAssignmentFixture();
      assignment.metadata.instructionLanguage = language;
      expect(validateFreshAssignmentV1(assignment)).toEqual(assignment);
      expect(validateAssignmentV1(assignment)).toEqual(assignment);
    }
    for (const language of ['', 'Russian', 'en ru', null, 1]) {
      const assignment = freshAssignmentFixture();
      Object.assign(assignment.metadata, { instructionLanguage: language });
      expect(() => validateFreshAssignmentV1(assignment)).toThrow('schema validation');
      expect(() => validateAssignmentV1(assignment)).toThrow('schema validation');
    }
  });

  it('carries tutor guidance, durable profile preference and lesson evidence into the real package', async () => {
    const template = await readFile(
      new URL('../prompt-assets/templates/hw_prompt_assignment_v1.md', import.meta.url),
      'utf8',
    );
    const templateRepository = createTemplateRevisionRepositoryStub();
    const revision = (await templateRepository.getActive(ASSIGNMENT_TEMPLATE_ID))!;
    const profile = (await createProfileRevisionRepositoryStub().getActive('student-1'))!;
    profile.structuredContent = {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'A2 English',
      primaryGoals: ['Explain plans'],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: ['Use Russian explanations for difficult grammar'],
      durableConstraints: [],
      teacherNotes: null,
    };
    const notes =
      'For this assignment use English instructions despite the usual Russian support preference.';
    const transcript = createTranscriptRecord();
    const insert = vi.fn(createPromptPackageRepositoryStub().insert);
    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        workspaceId: 'workspace-1',
        templateId: ASSIGNMENT_TEMPLATE_ID,
        notes,
      },
      {
        config: createConfig(ASSIGNMENT_TEMPLATE_ID, 'profile.md'),
        storage: createStorageStub({
          getText: async () =>
            'Learner needs help understanding English directions; practised future plans.',
        }),
        transcripts: { getByRecordingId: async () => transcript },
        recordings: {
          getById: async () =>
            ({
              id: transcript.recordingId,
              workspaceId: 'workspace-1',
              studentId: 'student-1',
            }) as never,
        },
        students: { getById: async () => ({ id: 'student-1', student: 'Student One' }) },
        promptPackages: { ...createPromptPackageRepositoryStub(), insert },
        profileRevisions: createProfileRevisionRepositoryStub({ getActive: async () => profile }),
        templateRevisions: createTemplateRevisionRepositoryStub({
          getActive: async () => ({
            ...revision,
            content: template,
            contentHash: createHash('sha256').update(template).digest('hex'),
          }),
        }),
        promptOptions: createPromptOptionsStub(),
      },
    );
    expect(result).not.toBeNull();
    const envelope = insert.mock.calls[0]![0].requestEnvelope!;
    if (!isGenerationRequestEnvelope(envelope)) throw new Error('Missing generation envelope');
    expect(envelope.instructions.split(/\r?\n/)[0]).toBe(ASSIGNMENT_TEMPLATE_CONTRACT);
    expect(envelope.responseSchema).toEqual(ASSIGNMENT_RESPONSE_SCHEMA);
    for (const policy of [
      'cues may establish context, time frame and intended meaning',
      'must not disclose the grammatical decision being tested',
      'decisive auxiliary, target construction, near-complete answer frame, or adjacent wording',
      'Preserve appropriate beginner scaffolding',
      'Scope every grammatical check explicitly to the construction being practised',
      'For each sentence where you intend present continuous',
      'Do not imply that all sentences containing an -ing form require be',
      'Avoid broad grammar mnemonics that become false outside the immediate construction',
      '`label` is a short identifying name',
      'Put the full structural formula in `pattern` and illustrative sentences in `examples`',
      'do not repeat either inside `label`',
      'Questions and explanations use the selected instruction/support language',
      'Every `practice[].items[].prompt` must be entirely English',
      'including situation/direction text, bare lexical cues and target excerpts used for error repair',
      'Put support-language practice directions in `practice[].instructions`',
      'support-language explanations in `practice[].items[].explanation`',
      'do not mix support-language text into an item prompt',
      'Keep English situations simple and understandable without supplying the tested grammatical form',
    ])
      expect(envelope.instructions).toContain(policy);
    for (const [label, content] of [
      ['TEACHER_NOTES', notes],
      ['FOUNDATIONAL_PROFILE', 'Use Russian explanations for difficult grammar'],
      ['LATEST_TRANSCRIPT', 'Learner needs help understanding English directions'],
    ]) {
      expect(envelope.input).toContain(`label="${label}"`);
      expect(envelope.input).toContain(content);
      expect(envelope.instructions).not.toContain(content);
    }
    expect(envelope.input).toContain('## Study Preferences');
    expect(envelope.input).toContain('A2 English');
    expect(envelope.input).toContain('canonical student-memory retrieval is disabled');
  });

  it.each([
    'v4 package',
    'v4 template',
    'v4 schema',
    'old schema with new name',
    'v5 package',
    'v5 marker with v7 schema',
    'v7 marker with v5 schema',
    'v6 package',
    'v6 marker with v7 schema',
    'v7 marker with v6 schema',
    'v7 non-strict schema',
  ])('rejects %s before dispatch without rewriting pins', async (kind) => {
    const prompt = promptPackageFixture();
    if (kind.startsWith('v5'))
      prompt.requestEnvelope.instructions =
        'Assignment output contract: assignment_v1_generation_v5\nOld policy.';
    if (kind === 'v5 package' || kind === 'v7 marker with v5 schema')
      prompt.requestEnvelope.responseSchema = {
        ...ASSIGNMENT_RESPONSE_SCHEMA,
        name: 'assignment_v1_generation_v5',
      };
    if (kind.startsWith('v6'))
      prompt.requestEnvelope.instructions =
        'Assignment output contract: assignment_v1_generation_v6\nOld policy.';
    if (kind === 'v6 package' || kind === 'v7 marker with v6 schema')
      prompt.requestEnvelope.responseSchema = {
        ...ASSIGNMENT_RESPONSE_SCHEMA,
        name: 'assignment_v1_generation_v6',
      };
    if (kind === 'v7 non-strict schema')
      prompt.requestEnvelope.responseSchema = { ...ASSIGNMENT_RESPONSE_SCHEMA, strict: false };
    if (kind === 'v4 package' || kind === 'v4 template')
      prompt.requestEnvelope.instructions =
        'Assignment output contract: assignment_v1_grammar_v4\nOld policy.';
    if ((kind.startsWith('v4') && kind !== 'v4 template') || kind === 'old schema with new name') {
      const schema = structuredClone(ASSIGNMENT_RESPONSE_SCHEMA.schema) as any;
      delete schema.properties.metadata.properties.instructionLanguage;
      schema.properties.metadata.required = schema.properties.metadata.required.filter(
        (field: string) => field !== 'instructionLanguage',
      );
      prompt.requestEnvelope.responseSchema = {
        ...ASSIGNMENT_RESPONSE_SCHEMA,
        name:
          kind === 'old schema with new name'
            ? ASSIGNMENT_RESPONSE_SCHEMA.name
            : 'assignment_v1_grammar_v4',
        schema,
      };
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
  });

  it.each(['v5', 'v6'])(
    'rejects an old active %s template before storing a fresh package',
    async (version) => {
      const transcript = createTranscriptRecord();
      const revision = (await createTemplateRevisionRepositoryStub().getActive(
        ASSIGNMENT_TEMPLATE_ID,
      ))!;
      const content = `Assignment output contract: assignment_v1_generation_${version}\nOld policy.`;
      const insert = vi.fn();
      await expect(
        createPromptPackage(
          {
            recordingId: transcript.recordingId,
            workspaceId: 'workspace-1',
            templateId: ASSIGNMENT_TEMPLATE_ID,
          },
          {
            config: createConfig(ASSIGNMENT_TEMPLATE_ID, 'profile.md'),
            storage: createStorageStub({ getText: async () => 'Lesson context' }),
            transcripts: { getByRecordingId: async () => transcript },
            recordings: {
              getById: async () =>
                ({
                  id: transcript.recordingId,
                  workspaceId: 'workspace-1',
                  studentId: 'student-1',
                }) as never,
            },
            students: { getById: async () => ({ id: 'student-1', student: 'Student One' }) },
            promptPackages: { ...createPromptPackageRepositoryStub(), insert },
            profileRevisions: createProfileRevisionRepositoryStub(),
            templateRevisions: createTemplateRevisionRepositoryStub({
              getActive: async () => ({
                ...revision,
                content,
                contentHash: createHash('sha256').update(content).digest('hex'),
              }),
            }),
            promptOptions: createPromptOptionsStub(),
          },
        ),
      ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED' });
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it('rejects fresh output missing the selected language after mocked provider receipt', async () => {
    const assignment = freshAssignmentFixture();
    const { instructionLanguage: _language, ...metadata } = assignment.metadata;
    const execute = vi
      .fn()
      .mockResolvedValue({ rawText: JSON.stringify({ ...assignment, metadata }) });
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
