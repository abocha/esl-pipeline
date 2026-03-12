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

    it('fails shadow_sentence mode when shadow sentence is missing', async () => {
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
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/missing "\*\*Shadow sentence:\*\* <sentence>"/i);
    });

    it('fails shadow_sentence mode when word drill count is outside 3-5', async () => {
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
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/requires 3-5 word drill lines/i);
    });

    it('fails shadow_sentence mode when transcription delimiters are missing', async () => {
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
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/must be wrapped in forward slashes/i);
    });
  },
);
