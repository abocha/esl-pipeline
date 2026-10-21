import { defineConfig } from 'tsup';

// Publication loads learner-handout assets relative to its own compiled package.
// Keep that dependency as a package boundary rather than relocating import.meta.url.
const INTERNAL_BUNDLE = [/^@esl-pipeline\/(?!html-publisher(?:\/|$))/];

export default defineConfig(() => ({
  entry: {
    index: 'src/index.ts',
  },
  target: 'node24',
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  shims: false,
  outDir: 'dist',
  dts: false,
  // The bundled Gemini adapter imports this CJS auth package at runtime. Keep it external
  // and declared here, with the matching package-scoped Knip exception for indirect imports.
  external: ['@google-cloud/text-to-speech', 'google-auth-library', '@esl-pipeline/html-publisher'],
  noExternal: INTERNAL_BUNDLE,
  tsconfig: 'tsconfig.json',
}));
