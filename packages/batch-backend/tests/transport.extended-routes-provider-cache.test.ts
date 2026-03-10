import { describe, expect, it } from 'vitest';

import { inferTranscriptSttProvider } from '../src/transport/extended-routes.js';

describe('transport/extended-routes STT cache provider inference', () => {
  it('infers provider from summary_json.provider when present', () => {
    expect(
      inferTranscriptSttProvider({
        model: 'nova-3',
        summaryJson: { provider: 'elevenlabs' },
      }),
    ).toBe('elevenlabs');
  });

  it('infers elevenlabs provider from scribe model', () => {
    expect(
      inferTranscriptSttProvider({
        model: 'scribe_v2',
        summaryJson: null,
      }),
    ).toBe('elevenlabs');
  });

  it('infers deepgram provider from nova model', () => {
    expect(
      inferTranscriptSttProvider({
        model: 'nova-3',
        summaryJson: null,
      }),
    ).toBe('deepgram');
  });

  it('treats non-elevenlabs unknown model names as deepgram for backward compatibility', () => {
    expect(
      inferTranscriptSttProvider({
        model: 'enhanced',
        summaryJson: null,
      }),
    ).toBe('deepgram');
  });
});
