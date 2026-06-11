import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('built orchestrator entrypoint', () => {
  it('imports the production ESM bundle without bundled CommonJS runtime errors', async () => {
    const mod = await import(pathToFileURL(`${process.cwd()}/dist/index.js`).href);

    expect(mod.createPipeline).toEqual(expect.any(Function));
  });
});
