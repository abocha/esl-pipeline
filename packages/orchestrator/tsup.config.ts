import { defineConfig } from 'tsup';

const INTERNAL_BUNDLE = [/^@esl-pipeline\//];

export default defineConfig(() => ({
  entry: {
    index: 'src/index.ts',
    cli: 'bin/cli.ts',
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
  noExternal: INTERNAL_BUNDLE,
  tsconfig: 'tsconfig.json',
  esbuildOptions(options) {
    // Preserve CLI shebangs by disabling banner stripping.
    options.banner = options.banner ?? {};
  },
}));
