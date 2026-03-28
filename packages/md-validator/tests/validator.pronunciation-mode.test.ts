import { describeMdValidatorSuite } from './validator.test-harness.js';

describeMdValidatorSuite(
  'md-validator [pronunciation-mode]',
  ({
    buildBaseDoc,
    expect,
    it,
    mkdtemp,
    path,
    tmpdir,
    validateMarkdownFile,
    withPronunciationSection,
    writeFile,
  }) => {
    it('accepts valid shadow_sentence pronunciation structure', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-ok.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** shadow_sentence',
        '**Shadow sentence:** I was thinking about working this morning.',
        '1. thinking — /ˈθɪŋkɪŋ/',
        '2. working — /ˈwɜːrkɪŋ/',
        '3. morning — /ˈmɔːrnɪŋ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('accepts LLM-variant shadow_sentence structure with bullets/backticks and trailing note', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-llm-variant.md');
      const section = [
        ':::callout 🗣️',
        '- `**Mode:** shadow_sentence`',
        '- `**Shadow sentence:** There was a flood, so the vehicle stopped working.`',
        '- 1. `Flood` — /flʌd/',
        '- 2. `Vehicle` — /viːɪkl/',
        '- 3. `Stopped` — /stɒpt/ (End with T sound)',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('accepts shadow_sentence word drill lines without dash delimiters', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-no-dash.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** shadow_sentence',
        '**Shadow sentence:** I was thinking about working this morning.',
        '1. thinking /ˈθɪŋkɪŋ/',
        '2. working /ˈwɜːrkɪŋ/',
        '3. morning /ˈmɔːrnɪŋ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('warns when shadow_sentence mode is missing the shadow sentence line', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-missing-sentence.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** shadow_sentence',
        '1. thinking — /ˈθɪŋkɪŋ/',
        '2. working — /ˈwɜːrkɪŋ/',
        '3. morning — /ˈmɔːrnɪŋ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/missing "\*\*Shadow sentence:\*\* <sentence>"/i);
    });

    it('warns when shadow_sentence mode word drill count is outside 3-5', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-word-count.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** shadow_sentence',
        '**Shadow sentence:** I was thinking about working this morning.',
        '1. thinking — /ˈθɪŋkɪŋ/',
        '2. working — /ˈwɜːrkɪŋ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/requires 3-5 word drill lines/i);
    });

    it('warns when shadow_sentence mode transcription delimiters are missing', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'shadow-pronunciation-transcription.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** shadow_sentence',
        '**Shadow sentence:** I was thinking about working this morning.',
        '1. thinking — ˈθɪŋkɪŋ',
        '2. working — /ˈwɜːrkɪŋ/',
        '3. morning — /ˈmɔːrnɪŋ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/must be wrapped in forward slashes/i);
    });

    it('accepts valid minimal_pair pronunciation structure', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'minimal-pair-pronunciation-ok.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** minimal_pair',
        '**Target:** Hear the short /ɪ/ and long /iː/ clearly.',
        '**Focus:** Notice the vowel length difference before you repeat.',
        '**Action:** Say each pair twice, then record one final contrast.',
        '**Deliverable:** A 10-second voice note of your practice.',
        '1. ship /ʃɪp/ — sheep /ʃiːp/',
        '2. live /lɪv/ — leave /liːv/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('warns when pronunciation mode is missing the shared skeleton fields', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'minimal-pair-pronunciation-missing-shared.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** minimal_pair',
        '1. ship /ʃɪp/ — sheep /ʃiːp/',
        '2. live /lɪv/ — leave /liːv/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/missing "\*\*Target:\*\* <value>"/i);
      expect(res.warnings.join('\n')).toMatch(/missing "\*\*Deliverable:\*\* <value>"/i);
    });

    it('warns when connected_speech drill lines are malformed', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'connected-speech-pronunciation-malformed.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** connected_speech',
        '**Target:** Link final consonants and following vowels smoothly.',
        '**Focus:** Listen for how the words join together.',
        '**Action:** Read each careful form, then the connected form.',
        '**Deliverable:** A 10-second voice note of your practice.',
        '1. Change helps us.',
        '2. It gives us food.',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/connected speech line must use/i);
    });

    it('warns when connected_speech is missing the final natural sentence block', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'connected-speech-pronunciation-missing-natural.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** connected_speech',
        '**Target:** Link final consonants and following vowels smoothly.',
        '**Focus:** Listen for how the words join together.',
        '**Action:** Read each careful form, then the connected form.',
        '**Deliverable:** A 10-second voice note of your practice.',
        '1. "Change helps us." -> Change help-sus.',
        '2. "It gives us food." -> It give-sus food.',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/natural sentence practice/i);
    });

    it('warns when rhythm_chunking lines do not show chunk boundaries', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'rhythm-chunking-pronunciation-boundaries.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** rhythm_chunking',
        '**Target:** Break the sentence into natural speaking chunks.',
        '**Focus:** Pause lightly between chunks instead of between every word.',
        '**Action:** Read the chunks slowly once, then at natural speed.',
        '**Deliverable:** A 10-second voice note of your practice.',
        '1. We should review this carefully. — /wi ʃʊd rɪˈvjuː ðɪs ˈkeə.fəl.i/',
        '2. Let me know when you arrive. — /let mi nəʊ wen ju əˈraɪv/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/should show chunk boundaries with "\|"/i);
    });

    it('warns when intonation is missing the final natural sentence block', async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'validator-'));
      const file = path.join(tempDir, 'intonation-pronunciation-missing-natural.md');
      const section = [
        ':::callout 🗣️',
        '**Mode:** intonation',
        '**Target:** Rising final intonation for yes/no questions.',
        '**Focus:** Let your pitch slide upward on the final stressed word.',
        '**Action:** Read each question once, then again more naturally.',
        '**Deliverable:** A 10-second voice note of your practice.',
        '1. Do you have a second? — /duː juː hæv ə ˈsekənd/',
        '2. Is everything okay? — /ɪz ˈevriθɪŋ oʊˈkeɪ/',
        ':::',
      ].join('\n');
      await writeFile(file, withPronunciationSection(buildBaseDoc('text'), section));
      const res = await validateMarkdownFile(file);
      expect(res.ok).toBe(true);
      expect(res.warnings.join('\n')).toMatch(/natural sentence practice/i);
    });
  },
);
