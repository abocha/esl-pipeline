import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyGeneralEnglishV2Diagnostic } from '../src/rulesets/general-english/v2.js';
import { validateMarkdown } from '../src/validator.js';

const fixturePath = path.join(import.meta.dirname, '..', 'fixtures', 'ok.md');

describe('md-validator [general-english-v2]', () => {
  it.each([
    [
      'Front matter: speaker_profiles role "student" is too vague.',
      'voice.speaker_profile_role_recommendation',
    ],
    [
      'Front matter: study_text_type is required ("monologue"|"dialogue").',
      'voice.frontmatter_alignment',
    ],
    ['Front matter: title - Required', 'frontmatter.invalid'],
    ['Expected at least 8 H2 sections, found 7.', 'structure.h2_count'],
    [
      'H2 #2 mismatch. Expected wording similar to "Homework", found: "Other".',
      'structure.h2_mismatch',
    ],
    [
      'Additional H2 sections after section 8 are ignored by structure validation.',
      'structure.additional_h2_ignored',
    ],
    ['Missing marker: ":::toggle Answer Key"', 'marker.required_missing'],
    ['Missing ":::study-text ... :::" block.', 'study_text.missing'],
    [
      'Line 14: study-text marker must start at column 1 with ":::study-text".',
      'study_text.marker_invalid',
    ],
    [
      'Line 18: study-text closing marker must be ":::" with no leading spaces.',
      'study_text.closing_marker_layout',
    ],
    [
      'study-text block starting at line 14 is missing a closing ":::" on its own line.',
      'study_text.closing_marker_missing',
    ],
    ['study-text line 2: unknown speaker "Nora". Allowed: [Alex].', 'study_text.speaker_alignment'],
    [
      'study-text looks short. Aim for 3–5 paragraphs or 10–15 lines.',
      'study_text.length_recommendation',
    ],
    [
      'No "### A. Controlled Practice" section found under H2 #4.',
      'practice.controlled_section_missing',
    ],
    [
      'Controlled Practice has 1 items (recommended 8–10).',
      'practice.controlled_count_recommendation',
    ],
    [
      'No "### Comprehension Check" section found after the study text under H2 #2.',
      'practice.comprehension_section_missing',
    ],
    [
      'Comprehension Check has 1 item(s) (recommended 2–3).',
      'practice.comprehension_count_recommendation',
    ],
    [
      'Missing "### B. Pronunciation Micro-Focus" section under H2 #4.',
      'pronunciation.section_missing',
    ],
    [
      'Pronunciation Micro-Focus is missing a supported "**Mode:**" line.',
      'pronunciation.contract_recommendation',
    ],
    [
      'Line 24: shadow sentence must be wrapped in forward slashes.',
      'pronunciation.line_recommendation',
    ],
    [
      'Found code block(s) inside the main document. Avoid nested ``` blocks.',
      'markdown.code_block_forbidden',
    ],
    [
      'callout starting at line 8 is missing a closing ":::" after its content.',
      'directive.callout_invalid',
    ],
    [
      'Hint: found indented ":::column" markers inside a column-list.',
      'directive.column_list_invalid',
    ],
    [
      'synced-block starting at line 10 is missing a closing ":::" after its contents.',
      'directive.synced_block_invalid',
    ],
    ['Line 20: audio directive requires a URL after ":::audio".', 'media.directive_missing_url'],
    ['Table starting at line 9 must include at least one data row.', 'table.invalid_structure'],
  ])('classifies %s with the stable %s policy code', (message, code) => {
    const issue = classifyGeneralEnglishV2Diagnostic(message, 'warning');

    expect(issue.code).toBe(code);
    expect(issue.code).not.toBe('general_english_v2.unclassified_diagnostic');
  });

  it('uses v2 by default while retaining explicit v1 compatibility', async () => {
    const markdown = await createStrictGolden();
    const legacyMarkdown = await createLegacyStrictGolden();

    const defaultResult = await validateMarkdown({ markdown, strict: true });
    const v1Result = await validateMarkdown({
      markdown: legacyMarkdown,
      strict: true,
      learningPresetId: 'general-english',
      learningPresetVersion: 'v1',
    });
    const unknownVersionResult = await validateMarkdown({
      markdown,
      strict: true,
      learningPresetId: 'general-english',
      learningPresetVersion: 'v999',
    });

    expect(defaultResult.ruleset).toMatchObject({
      id: 'general-english',
      version: 'v2',
      fallbackApplied: false,
    });
    expect(defaultResult.ok).toBe(true);
    expect(v1Result.ruleset).toMatchObject({
      id: 'general-english',
      version: 'v1',
      fallbackApplied: false,
    });
    expect(v1Result.ok).toBe(true);
    expect(unknownVersionResult.ruleset).toMatchObject({
      id: 'general-english',
      version: 'v2',
      fallbackApplied: true,
      fallbackReason: 'unknown_version',
    });
  });

  it.each(['audio', 'video'])(
    'blocks emitted %s directives that lack a URL in strict v2',
    async (media) => {
      const markdown = (await createStrictGolden()).replace(
        'Text\n\n## 2. 🎧 Input Material: The Source',
        `Text\n\n:::${media}\n\n## 2. 🎧 Input Material: The Source`,
      );

      const result = await validateMarkdown({ markdown, strict: true });

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(
        new RegExp(`${media} directive requires a URL`, 'i'),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'media.directive_missing_url',
          ruleId: 'media-directive',
          severity: 'warning',
          category: 'runtime',
          blockingInStrict: true,
        }),
      );
    },
  );

  it('keeps structural contract failures blocking with stable v2 codes', async () => {
    const markdown = (await createStrictGolden())
      .replace('## 2. 🎧 Input Material: The Source', '## 2. Unrelated heading')
      .replace(':::toggle Answer Key', ':::toggle');

    const result = await validateMarkdown({ markdown, strict: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'structure.h2_mismatch',
          ruleId: 'h2-order',
          severity: 'warning',
          blockingInStrict: true,
        }),
        expect.objectContaining({
          code: 'marker.required_missing',
          ruleId: 'required-markers',
          severity: 'warning',
          blockingInStrict: true,
        }),
      ]),
    );
    expect(
      result.issues?.some((issue) => issue.code === 'general_english_v2.unclassified_diagnostic'),
    ).toBe(false);
  });

  it('accepts comprehension immediately after input and rejects its former practice placement', async () => {
    const current = await createStrictGolden();
    const oldPlacement = current
      .replace(['### 🤔 Comprehension Check', '', '1. x', '2. y', ''].join('\n'), '')
      .replace(
        '### B. 🎙️ Pronunciation Micro-Focus (≈1 min)',
        [
          '### B. 🤔 Comprehension Check',
          '',
          '1. x',
          '2. y',
          '',
          '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
        ].join('\n'),
      );

    const currentResult = await validateMarkdown({ markdown: current, strict: true });
    const oldPlacementResult = await validateMarkdown({ markdown: oldPlacement, strict: true });

    expect(currentResult.ok).toBe(true);
    expect(oldPlacementResult.ok).toBe(false);
    expect(oldPlacementResult.issues).toContainEqual(
      expect.objectContaining({
        code: 'practice.comprehension_section_missing',
        ruleId: 'comprehension-check',
        blockingInStrict: true,
      }),
    );
  });

  it('rejects an intervening subsection between study text and comprehension', async () => {
    const markdown = (await createStrictGolden()).replace(
      '### 🤔 Comprehension Check',
      [
        '### Source Vocabulary Preview',
        '',
        '- preview item',
        '',
        '### 🤔 Comprehension Check',
      ].join('\n'),
    );

    const result = await validateMarkdown({ markdown, strict: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'practice.comprehension_section_missing',
        ruleId: 'comprehension-check',
        blockingInStrict: true,
      }),
    );
  });

  it('rejects skipped H2 numbering in the current eight-section contract', async () => {
    const markdown = (await createStrictGolden()).replace(
      '## 2. 🎧 Input Material: The Source',
      '## 3. 🎧 Input Material: The Source',
    );

    const result = await validateMarkdown({ markdown, strict: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'structure.h2_mismatch',
        ruleId: 'h2-order',
        blockingInStrict: true,
      }),
    );
  });

  it('keeps omitted media directives and controlled-practice recommendations nonblocking in strict v2', async () => {
    const markdown = (await createStrictGolden()).replace(
      ['1. a', '2. b', '3. c', '4. d', '5. e', '6. f', '7. g', '8. h'].join('\n'),
      '1. a',
    );

    const result = await validateMarkdown({ markdown, strict: true });

    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'practice.controlled_count_recommendation',
        ruleId: 'controlled-practice',
        category: 'quality',
        blockingInStrict: false,
      }),
    );
    expect(
      result.issues?.some((issue) => issue.code === 'general_english_v2.unclassified_diagnostic'),
    ).toBe(false);
  });
});

async function createStrictGolden(): Promise<string> {
  const base = await readFile(fixturePath, 'utf8');
  return base
    .replace('student: Anna', 'student: Synthetic Learner')
    .replace(
      'speaker_labels: [Alex, Mara]\n---',
      [
        'speaker_labels: [Alex, Mara]',
        'study_text_type: dialogue',
        'speaker_profiles:',
        '  - id: Alex',
        '    role: student',
        '    gender: male',
        '  - id: Mara',
        '    role: teacher',
        '    gender: female',
        '---',
      ].join('\n'),
    );
}

async function createLegacyStrictGolden(): Promise<string> {
  const current = await createStrictGolden();
  const comprehensionBlock = ['### 🤔 Comprehension Check', '', '1. x', '2. y', ''].join('\n');
  const withoutComprehension = current.replace(comprehensionBlock, '');
  const withLegacyPractice = withoutComprehension.replace(
    '### B. 🎙️ Pronunciation Micro-Focus (≈1 min)',
    [
      '### B. 🤔 Comprehension Check',
      '',
      '1. x',
      '2. y',
      '',
      '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
    ].join('\n'),
  );
  const renumbered = withLegacyPractice.replace(
    /^## ([2-8])\./gm,
    (_, sectionNumber: string) => `## ${Number(sectionNumber) + 1}.`,
  );
  return renumbered.replace(
    '## 3. 🎧 Input Material: The Source',
    ['## 2. 🗺️ Your Homework Roadmap', '', 'Text', '', '## 3. 🎧 Input Material: The Source'].join(
      '\n',
    ),
  );
}
