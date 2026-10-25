import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ASSIGNMENT_TEMPLATE_CONTRACT, ASSIGNMENT_TEMPLATE_ID } from '@esl-pipeline/contracts';

const readTemplate = () =>
  readFile(
    path.join(import.meta.dirname, '..', 'prompt-assets', 'templates', ASSIGNMENT_TEMPLATE_ID),
    'utf8',
  );

describe('structured homework bootstrap template', () => {
  it('composes mission roles without padding or losing self-correction', async () => {
    const template = await readTemplate();
    for (const rule of [
      '`task` is the concise core learner task',
      'Keep preparation, response requirements, delivery and self-check instructions out of `task`',
      '`preparation`: a list',
      '`requirements`: independently scannable, meaning-based',
      '`delivery`: nullable text',
      '`selfCheck`: a short list',
      'Use empty lists or null delivery when a role is unnecessary',
      'do not add artificial filler or repeat the task',
      'notice a problem and try a correction',
      'sample belongs in the answer key, not the mission instructions',
    ])
      expect(template).toContain(rule);
  });
  it('separates learner benefit from nullable teacher analysis under the revised marker', async () => {
    const template = await readTemplate();
    expect(template).toContain(
      '`learnerRationale`: speak directly to the learner and explain the practical benefit',
    );
    expect(template).toContain(
      '`teacherRationale`: required nullable field for lesson-evidence analysis, pedagogical diagnosis, teacher reasoning',
    );
    expect(template).toContain(
      'Do not put this analysis in `learnerRationale` or emit root `rationale`',
    );
    expect(template).not.toContain(
      'Rationale: explain why this mission helps this learner with supported evidence.',
    );
  });

  it('pins the domain contract without generated Markdown layout instructions', async () => {
    const template = await readTemplate();
    expect(template.split(/\r?\n/)[0]).toBe(ASSIGNMENT_TEMPLATE_CONTRACT);
    for (const obsolete of [
      ':::study-text',
      'raw Markdown',
      'YAML front matter',
      'Definitive Homework Output Template',
      'code fence',
    ])
      expect(template).not.toContain(obsolete);
    for (const semantic of [
      'Source Authority by Fact Type',
      'Parallel Scenario Principle',
      'real linguistic decision',
      'optional',
      'age',
      'supplied',
    ])
      expect(template).toContain(semantic);
  });

  it('defines the smallest complete sequence without blanket minimization or quotas', async () => {
    const template = await readTemplate();
    for (const rule of [
      'one teaching design, not a checklist',
      'A supported learner issue is a candidate, not automatically a target',
      'smallest complete teaching sequence for the learner and lesson evidence',
      'teaching objective to survive outside the live lesson',
      'do not omit useful scaffolding merely to keep JSON short',
      'Do not optimize for parity with old homework by counting items',
      'Prefer one grammar object when one coherent concept covers the mission',
      'Do not make object count itself the goal or combine unrelated concepts',
      'Do not fill optional fields merely because schema capacity exists',
      'Prefer a short coherent progression over broad coverage',
      'Do not target a preferred item count or shrink vocabulary merely because the schema permits a tiny list',
      'Do not target a preferred item count',
      'Add answer explanations only when they resolve a likely misconception, ambiguity, or non-obvious contrast',
    ])
      expect(template).toContain(rule);

    for (const quota of [
      /0[-–]3.*supporting or review targets/,
      /3[-–]5 natural occurrences/,
      /Aim for 3[-–]5 monologue paragraphs/,
      /prefer 2[-–]3 meaningful questions/,
      /prefer 5[-–]10 useful vocabulary/,
      /usually 6[-–]10 useful questions/,
      /Organize controlled practice into 2[-–]3/,
      /If no strong pronunciation issue is evidenced, choose/,
    ])
      expect(template).not.toMatch(quota);
    expect(template).not.toMatch(/Minimize content|Choose only the vocabulary/);
  });

  it('chooses support language from ordered learner evidence and preserves target English', async () => {
    const template = await readTemplate();
    const language = template
      .split('**Instruction and Support Language**')[1]!
      .split('**Instruction Conflict Priority**')[0]!;
    const precedence = [
      '1. Explicit current tutor guidance',
      '2. Durable learner preference/profile',
      '3. Strong learner-level evidence',
      '4. English (`en`) default',
    ].map((rule) => language.indexOf(rule));
    expect(precedence.every((position) => position >= 0)).toBe(true);
    expect(precedence).toEqual([...precedence].sort((a, b) => a - b));
    for (const rule of [
      '`metadata.instructionLanguage`',
      '[TEACHER_NOTES]',
      '[FOUNDATIONAL_PROFILE]',
      '[STUDENT_MEMORY_SNAPSHOT]',
      '[LATEST_TRANSCRIPT]',
      '[RECENT_LESSON_MEMORY]',
      'especially for A1/A2 learners',
      'Beginner level alone does not identify a support language',
      'Do not infer Russian merely from a Russian-speaking teacher or incidental Russian text',
      'instructions, explanations, grammar meaning distinctions and vocabulary meanings/glosses may use Russian',
      'answer content, grammar patterns, study text, practice language and sample response remain English',
      'Avoid translating target English that the learner should understand or produce independently',
      'avoid unnecessary bilingual duplication',
    ])
      expect(language).toContain(rule);
  });

  it('aligns the teaching sections with complete, economical typed generation', async () => {
    const template = await readTemplate();
    for (const rule of [
      'independently useful pattern',
      'genuinely illustrating that specific pattern',
      'exactly two `alternatives`',
      'explain why the learner would choose one alternative over the other, not a mini essay',
      'Do not duplicate teaching facts across those fields',
      'plausible learner-relevant mistake worth noticing',
      'support the input, grammar target, controlled practice or output mission',
      'Prefer useful chunks/collocations over isolated low-value words',
      'For beginner/intermediate learners, include support-language meanings/glosses',
      'A compact assignment may need few items; a richer lesson may need more',
      'move from recognition or controlled choice toward productive use',
      'Target distinctions actually taught in grammar/vocabulary',
      'rather than repeating examples verbatim',
      'concrete, teachable target supported by target English/chunks',
      'Do not claim acoustic diagnosis without supporting audio evidence',
      'Omit pronunciation when no useful intervention is supported',
      'concrete checks the learner can actually perform before finishing',
      'avoid internal lesson-analysis language',
      'Do not duplicate the same prose into both rationale fields',
      '`teacherRationale` remains internal typed data and never belongs in learner HTML',
    ])
      expect(template).toContain(rule);
    for (const mode of [
      'shadow_sentence',
      'minimal_pair',
      'connected_speech',
      'intonation',
      'rhythm_chunking',
      'sentence_stress',
    ])
      expect(template).toContain(mode);
  });

  it('protects linguistic decisions, local copying checks and meaning-based transfer', async () => {
    const template = await readTemplate();
    for (const rule of [
      'Do not reveal the auxiliary, tense, aspect, construction, or lexical choice, directly or through indirect cues',
      'inspect the item and its immediately surrounding context for a copying shortcut',
      'exact answer, required inflected form, or a trivially reusable target phrase',
      'rewrite the item unless copying that language is intentionally part of the task',
      'Each additional practice item should introduce a meaningfully different decision, context, or transfer demand',
      'Remove items that merely repeat the same decision in another sentence',
      'what the listener or reader should understand or accomplish',
      'Let the learner choose how to express those meanings',
      'Use meaning-based requirements when necessary to ensure important target language is elicited',
      'without naming or supplying the grammatical form they need to choose',
      'Consistently mark supplied lexical hints in practice prompts with paired backticks',
      'The backticks surround only the supplied words, not the parentheses or the sentence',
      'Highlighting must not introduce an inflected answer, auxiliary, or grammatical choice',
      'each cue individually closed before a newline',
    ])
      expect(template).toContain(rule);
  });
});
