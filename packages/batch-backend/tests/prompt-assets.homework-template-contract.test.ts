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

  it('preserves Candidate-3 focus and economy without the former quota guidance', async () => {
    const template = await readTemplate();
    for (const rule of [
      'one teaching design, not a checklist',
      'A supported learner issue is a candidate, not automatically a target',
      'Minimize content to what the chosen mission actually needs',
      'Prefer one grammar object when one coherent concept covers the mission',
      'Do not make object count itself the goal or combine unrelated concepts',
      'Do not fill optional fields merely because schema capacity exists',
      'Prefer a short coherent progression over broad coverage',
      'Choose only the vocabulary worth actively using',
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
    ])
      expect(template).toContain(rule);
  });
});
