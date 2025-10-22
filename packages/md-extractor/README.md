# md-extractor

Tiny helpers to pull structured pieces from a validated ESL homework markdown.

```ts
import {
  extractFrontmatter,
  extractStudyText,
  extractAnswerKey,
  extractTeacherNotes,
  extractSections,
} from '@esl-pipeline/md-extractor';

const fm = extractFrontmatter(md);
const study = extractStudyText(md); // { type: 'dialogue'|'monologue', lines: string[] }

## 2) Wire into the monorepo
- Add `packages/md-extractor` to your workspace (should auto-pick via `packages/*`).
- Install deps from repo root:
```bash
pnpm install
pnpm --filter @esl-pipeline/md-extractor build
pnpm --filter @esl-pipeline/md-extractor test
