import { afterEach, expect, it, vi } from 'vitest';

import { buildTtsSpendSummary } from '../src/runtime/tts-telemetry.js';

afterEach(() => vi.unstubAllEnvs());

it('does not apply character-priced estimates to token-billed Gemini output', () => {
  vi.stubEnv('ESL_TTS_COST_PER_1K_CHARS_USD', '1');
  const summary = buildTtsSpendSummary({ provider: 'gemini', generatedCharacters: 1000 });
  expect(summary).toEqual({ provider: 'gemini', generatedCharacters: 1000, cachedCharacters: 0 });
});
