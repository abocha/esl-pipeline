import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import grammarFixture from '../../contracts/tests/assignment-grammar-fixture.json' with {
  type: 'json',
};
// Intentionally import compiled JavaScript: this path has no Vite involvement.
import { renderLearnerHandoutDocument } from '../dist/server.js';
import { createFixture, pronunciationModes } from '../preview/fixtures.js';

const output = new URL('../../../out/learner-handout/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const mode of [...pronunciationModes, 'none'] as const) {
  for (const audio of ['available', 'mixed', 'unavailable'] as const) {
    writeFileSync(
      new URL(`${mode}-${audio}.html`, output),
      renderLearnerHandoutDocument(createFixture(mode, audio)),
      'utf8',
    );
  }
}
writeFileSync(
  new URL('grammar.html', output),
  renderLearnerHandoutDocument({
    ...createFixture('none', 'unavailable'),
    assignment: grammarFixture as import('@esl-pipeline/contracts').AssignmentV1,
  }),
  'utf8',
);
copyFileSync(
  new URL('../public/fixture-tone.wav', import.meta.url),
  new URL('fixture-tone.wav', output),
);
console.log(`Standalone documents: ${fileURLToPath(output)}`);
