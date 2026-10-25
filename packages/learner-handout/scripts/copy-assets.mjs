import { copyFileSync } from 'node:fs';

for (const asset of ['handout.css', 'pronunciation-playback.js', 'handout-interactions.js']) {
  copyFileSync(
    new URL(`../src/${asset}`, import.meta.url),
    new URL(`../dist/${asset}`, import.meta.url),
  );
}
