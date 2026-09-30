import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const templateRoot = path.join(import.meta.dirname, '..', 'prompt-assets', 'templates');

describe('canonical homework bootstrap template', () => {
  it.each(['hw_prompt_definitive.md', 'hw_prompt_markdown_block2.md'])(
    '%s uses the eight-section input-to-comprehension contract without roadmap navigation',
    async (templateId) => {
      const template = await readFile(path.join(templateRoot, templateId), 'utf8');
      const outputTemplate = template.slice(
        template.indexOf('## **📦 Definitive Homework Output Template**'),
      );

      expect(template).not.toContain('Homework Roadmap');
      expect(template).not.toContain(':::toc');

      const expectedHeadings = [
        "## 1. 🎯 This Week's Mission Briefing",
        '## 2. 🎧 Input Material: The Source',
        '## 3. 🛠️ Language Toolkit: Useful Language',
        '## 4. ✍️ Practice & Pronunciation',
        '## 5. ✅ Your Turn: Complete the Mission!',
        '## 6. 🧠 Why This Mission Helps You',
        '## 7. 🔑 Answer Key & Sample Mission',
        "## 8. 👨‍🏫 Teacher's Follow-up Plan",
      ];
      const headingIndexes = expectedHeadings.map((heading) => outputTemplate.indexOf(heading));

      expect(headingIndexes.every((index) => index >= 0)).toBe(true);
      expect(headingIndexes).toEqual([...headingIndexes].sort((left, right) => left - right));
      expect(outputTemplate.indexOf('### 🤔 Comprehension Check')).toBeGreaterThan(
        outputTemplate.indexOf(':::study-text Transcript'),
      );
      expect(outputTemplate.indexOf('### 🤔 Comprehension Check')).toBeLessThan(
        outputTemplate.indexOf('## 3. 🛠️ Language Toolkit: Useful Language'),
      );
      const studyTextRegions = [
        ...outputTemplate.matchAll(/^:::study-text Transcript\n[\s\S]*?^:::[ \t]*$/gm),
      ];
      const lastStudyText = studyTextRegions.at(-1);
      expect(lastStudyText).toBeDefined();
      const afterStudyText = outputTemplate
        .slice(lastStudyText!.index + lastStudyText![0].length)
        .trimStart();
      expect(afterStudyText.startsWith('### 🤔 Comprehension Check\n')).toBe(true);
      expect(outputTemplate).toContain('### A. 🔩 Controlled Practice');
      expect(outputTemplate).toContain('### B. 🎙️ Pronunciation Micro-Focus (≈1 min)');
      expect(outputTemplate).not.toContain('### C. 🎙️ Pronunciation Micro-Focus');
    },
  );
});
