import { describeMdValidatorSuite } from './validator.test-harness.js';

describeMdValidatorSuite(
  'md-validator [strict-mode-and-voice-alignment]',
  ({
    buildBaseDoc,
    expect,
    it,
    mkdtemp,
    path,
    process,
    tmpdir,
    validateMarkdownFile,
    withStrictReadyFrontmatter,
    writeFile,
  }) => {
    const retiredElevenLabsVoicesEnv = ['ELEVENLABS', 'VOICES', 'PATH'].join('_');

    it('warns when column-list has no columns', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'column-list-empty.md');
      const md = buildBaseDoc(
        ['Text', ':::column-list', 'This has no column markers', ':::'].join('\n'),
      );
      await writeFile(file, md);
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/column-list.*at least one ":::column"/i);
    });

    it('accepts column-list with columns', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'column-list-ok.md');
      const md = buildBaseDoc(
        [
          'Text',
          ':::column-list',
          ':::column',
          'Left content',
          ':::',
          ':::column',
          'Right content',
          ':::',
          ':::',
        ].join('\n'),
      );
      await writeFile(file, md);
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('warns when synced-block has no content and no source id', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'synced-empty.md');
      const md = buildBaseDoc(['Text', ':::synced-block', ':::'].join('\n'));
      await writeFile(file, md);
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/synced-block.*must include content/i);
    });

    it('warns when table rows are ragged', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'table-ragged.md');
      const md = buildBaseDoc(
        ['Text', '| A | B |', '| -- | -- |', '| 1 | 2 |', '| only-one |'].join('\n'),
      );
      await writeFile(file, md);
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/Table .* inconsistent column counts/i);
    });

    it('accepts controlled practice heading with trailing qualifier text', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'controlled-practice-qualifier.md');
      const md = buildBaseDoc('text').replace(
        '### A. 🔩 Controlled Practice',
        '### A. 🔩 Controlled Practice (Fossil Hunter)',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings).not.toContain(
        'No "### A. Controlled Practice" section found under H2 #5.',
      );
    });

    it('warns when Comprehension Check is missing under H2 #5 even if a similarly named heading exists elsewhere', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'comprehension-offscope.md');
      const md = buildBaseDoc('text')
        .replace('### B. 🤔 Comprehension Check', '### B. Reflection')
        .replace(
          "## 9. 👨‍🏫 Teacher's Follow-up Plan",
          [
            '### B. Comprehension Check',
            '1) offscope',
            '2) offscope',
            '',
            "## 9. 👨‍🏫 Teacher's Follow-up Plan",
          ].join('\n'),
        );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings).toContain('No "### B. Comprehension Check" section found under H2 #5.');
    });

    it('accepts comprehension check heading with trailing qualifier text under H2 #5', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'comprehension-qualifier.md');
      const md = buildBaseDoc('text').replace(
        '### B. 🤔 Comprehension Check',
        '### B. 🤔 Comprehension Check (Fossil Hunter)',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings).not.toContain(
        'No "### B. Comprehension Check" section found under H2 #5.',
      );
    });

    it('treats missing H2 #5 comprehension check as blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'missing-comprehension-strict.md');
      const md = buildBaseDoc('text').replace('### B. 🤔 Comprehension Check', '### B. Reflection');
      await writeFile(file, md);

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(false);
      expect(res.errors).toContain('No "### B. Comprehension Check" section found under H2 #5.');
    });

    it('keeps comprehension-count recommendation non-blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'strict-comprehension-count.md');
      const md = withStrictReadyFrontmatter(buildBaseDoc('text')).replace('1. x\n2. y', '1. x');
      await writeFile(file, md);

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/Comprehension Check has 1 item\(s\)/i);
    });

    it('treats H2 contract mismatches as blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'strict-h2-mismatch.md');
      const md = withStrictReadyFrontmatter(buildBaseDoc('text')).replace(
        '## 5. ✍️ Practice & Pronunciation',
        '## 5. Practice',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/H2 #5 mismatch/i);
    });

    it('treats speaker alignment warnings as blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'strict-speaker-mismatch.md');
      const md = withStrictReadyFrontmatter(buildBaseDoc('text')).replace(
        '[Mara]: Hello!',
        'Sam: Hello!',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/unknown speaker "Sam"/i);
    });

    it('accepts pronunciation micro-focus heading under H2 #5 with non-C letter prefix', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'pronunciation-non-c-prefix.md');
      const md = buildBaseDoc('text').replace(
        '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
        '### F. 🎙️ Pronunciation Micro-Focus (Fossil Hunter)',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).not.toContain(
        'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
      );
    });

    it('warns when pronunciation micro-focus heading is missing under H2 #5', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'pronunciation-missing-under-h2-5.md');
      const md = buildBaseDoc('text').replace(
        '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
        '### C. 🎙️ Accent Drill (≈1 min)',
      );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings).toContain(
        'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
      );
    });

    it('keeps missing pronunciation micro-focus non-blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'strict-pronunciation-missing-under-h2-5.md');
      const md = buildBaseDoc('text').replace(
        '### C. 🎙️ Pronunciation Micro-Focus (≈1 min)',
        '### C. 🎙️ Accent Drill (≈1 min)',
      );
      await writeFile(file, withStrictReadyFrontmatter(md));

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(true);
      expect(res.warnings).toContain(
        'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
      );
    });

    it('keeps extra-after-core H2 warning non-blocking in strict mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'strict-extra-h2-after-core.md');
      const md = `${withStrictReadyFrontmatter(buildBaseDoc('text'))}\n\n## 10. Appendix Notes\ntext`;
      await writeFile(file, md);

      const res = await validateMarkdownFile(file, { strict: true });
      expect(res.ok).toBe(true);
      expect(res.warnings).toContain(
        'Additional H2 sections after section 9 are ignored by structure validation.',
      );
    });

    it('warns about missing study_text_type in compatibility mode', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'missing-study-text-type.md');
      await writeFile(file, buildBaseDoc('text'));

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/study_text_type is required/i);
      expect(res.voiceDiagnostics?.compatibilityMode?.enabled).toBe(true);
    });

    it('emits shadow mismatch diagnostics when v2 is enabled without strict mode', async () => {
      process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
      process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'false';

      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-mode-mismatch.md');
      await writeFile(file, buildBaseDoc('text'));

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.voiceDiagnostics?.shadowMode?.enabled).toBe(true);
      expect(res.voiceDiagnostics?.shadowMode?.mismatchClasses?.missing_study_text_type).toBe(1);
      expect(res.voiceDiagnostics?.shadowMode?.mismatchTotal).toBeGreaterThanOrEqual(1);
    });

    it('hard-fails missing study_text_type when strict voice alignment flags are enabled', async () => {
      process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
      process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'true';

      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'missing-study-text-type-strict.md');
      await writeFile(file, buildBaseDoc('text'));

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/study_text_type is required/i);
      expect(res.voiceDiagnostics?.compatibilityMode?.enabled).toBe(false);
    });

    it('hard-fails invalid speaker_profiles.voice when strict alignment and catalog are available', async () => {
      process.env.VOICE_ALIGNMENT_V2_ENABLED = 'true';
      process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION = 'true';

      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const voicesPath = path.join(tempDir, 'voices.json');
      const legacyVoicesPath = path.join(tempDir, 'legacy-voices.json');
      process.env.ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH = voicesPath;
      process.env[retiredElevenLabsVoicesEnv] = legacyVoicesPath;
      await writeFile(
        voicesPath,
        JSON.stringify({
          voices: [{ id: 'voice_1', name: 'Friendly Voice', labels: { accent: 'american' } }],
        }),
      );
      await writeFile(
        legacyVoicesPath,
        JSON.stringify({
          voices: [{ id: 'missing-voice-id', name: 'Retired Legacy Voice' }],
        }),
      );

      const file = path.join(tempDir, 'bad-voice-override.md');
      const md = buildBaseDoc('text')
        .replace(
          'input_type: generate',
          ['input_type: generate', 'study_text_type: dialogue'].join('\n'),
        )
        .replace(
          'speaker_labels: [Alex, Mara]\n---',
          [
            'speaker_labels: [Alex, Mara]',
            'speaker_profiles:',
            '  - id: Alex',
            '    role: student',
            '    gender: male',
            '    voice: missing-voice-id',
            '  - id: Mara',
            '    role: student',
            '    gender: female',
            '    voice: Friendly Voice',
            '---',
          ].join('\n'),
        );
      await writeFile(file, md);

      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/does not exist in the current voice catalog/i);
    });
  },
);
