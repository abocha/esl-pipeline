import { defineConfig } from 'tsup';

const INTERNAL_BUNDLE = [/^@esl-pipeline\//];

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
  external: ['@google-cloud/text-to-speech'],
  noExternal: INTERNAL_BUNDLE,
  tsconfig: 'tsconfig.json',
}));
