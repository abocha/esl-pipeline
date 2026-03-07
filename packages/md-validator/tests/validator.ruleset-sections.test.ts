import { describeMdValidatorSuite } from './validator.test-harness.js';

describeMdValidatorSuite(
  'md-validator [ruleset-and-section-contracts]',
  ({ buildBaseDoc, expect, fixturesPath, it, mkdtemp, path, tmpdir, validateMarkdownFile, writeFile }) => {
  it('passes ok fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'));
    expect(res.ok).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.warnings).toContain('Legacy fenced markdown is deprecated; remove the code fence.');
  });

  it('fails bad fixture', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'bad.md'));
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('returns structured issues and ruleset metadata for default resolution', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'));
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      version: 'v1',
      fallbackApplied: false,
    });
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues?.length).toBeGreaterThan(0);
  });

  it('falls back to general-english ruleset for unknown learningPresetId and warns', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      learningPresetId: 'ielts-academic',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      fallbackApplied: true,
      fallbackReason: 'unknown_preset',
      requestedId: 'ielts-academic',
    });
    expect(res.warnings.join('\n')).toMatch(/unknown learning preset/i);
    expect(res.issues?.some((issue) => issue.code === 'ruleset.unknown_preset_fallback')).toBe(
      true,
    );
    const fallbackIssues = (res.issues ?? []).filter((issue) =>
      /unknown learning preset/i.test(issue.message),
    );
    expect(fallbackIssues).toHaveLength(1);
    expect(fallbackIssues[0]).toMatchObject({
      ruleId: 'ruleset-resolution',
      blockingInStrict: false,
      severity: 'warning',
    });
  });

  it('maps legacy preset input to general-english ruleset', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      preset: 'b1-default',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      fallbackApplied: true,
      fallbackReason: 'legacy_preset_mapping',
      requestedId: 'b1-default',
    });
  });

  it('resolves known learning preset aliases without fallback warnings', async () => {
    const res = await validateMarkdownFile(path.join(fixturesPath, 'ok.md'), {
      learningPresetId: 'general-english-intensive',
    });
    expect(res.ok).toBe(true);
    expect(res.ruleset).toMatchObject({
      id: 'general-english',
      requestedId: 'general-english-intensive',
      fallbackApplied: false,
    });
    expect(res.warnings.join('\n')).not.toMatch(/unknown learning preset/i);
    expect(
      (res.issues ?? []).some((issue) => issue.code === 'ruleset.unknown_preset_fallback'),
    ).toBe(false);
  });

  it('allows flexible H2 wording', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'flex-h2.md');
    await writeFile(
      file,
      `
\`\`\`markdown
---
title: "Flexible H2 Test"
student: Anna
level: B1
topic: travel
input_type: generate
speaker_labels: ["Anna"]
---

## 1. Lesson Recap & Mission Overview
text

## 2. Homework Plan
text

## 3. Source Text (Input)
:::study-text
Anna: Hello there!
:::

## 4. Grammar & Useful Language
text

## 5. Practice and Speaking
### A. Controlled Practice
1) one
2) two
3) three
4) four
5) five
6) six
7) seven
8) eight
### B. Comprehension Check
1) q1
2) q2

### C. Pronunciation Micro-Focus
text

## 6. Your Task: Tell your story!
text

## 7. Why this helps
text

## 8. Answers & Example
:::toggle-heading Answer Key
answers
:::

## 9. Next Lesson Plan
:::toggle-heading Teacher's Follow-up Plan
plan
:::
\`\`\`
      `.trim(),
    );

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('allows extra H2 sections appended after section 9', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'extra-h2-after-core.md');
    const md = buildBaseDoc('text').replace(
      '\n```',
      '\n\n## 10. Appendix Notes\ntext\n```',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain(
      'Additional H2 sections after section 9 are ignored by structure validation.',
    );
  });

  it('warns when an extra H2 is inserted before the core section sequence completes', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'extra-h2-mid-sequence.md');
    const md = buildBaseDoc('text').replace(
      "## 9. 👨‍🏫 Teacher's Follow-up Plan",
      "## 8.5. Appendix Notes\ntext\n\n## 9. 👨‍🏫 Teacher's Follow-up Plan",
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/H2 #9 mismatch/i);
  });

  it('warns when fewer than 9 core H2 sections are present', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'missing-core-h2.md');
    const md = `${buildBaseDoc('text').split("\n## 9. 👨‍🏫 Teacher's Follow-up Plan")[0]}\n\`\`\``;
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/Expected at least 9 H2 sections, found 8\./i);
  });

  it('warns on overly-generic section 5 headings that are semantically underspecified', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'generic-practice-heading.md');
    const md = buildBaseDoc('text').replace('## 5. ✍️ Practice & Pronunciation', '## 5. Practice');
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toMatch(/H2 #5 mismatch/i);
  });

  it('accepts semantically-rich synonym headings for section 4', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
    const file = path.join(tempDir, 'synonym-heading-section-4.md');
    const md = buildBaseDoc('text').replace(
      '## 4. 🛠️ Language Toolkit: Useful Language',
      '## 4. Useful Vocabulary Toolbox',
    );
    await writeFile(file, md);

    const res = await validateMarkdownFile(file);
    expect(res.ok).toBe(true);
  });

  },
);
