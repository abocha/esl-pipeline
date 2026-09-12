import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { describe, expect, it, vi } from 'vitest';

describe('installed ElevenLabs SDK compatibility (mock transport only)', () => {
  it.each(['speech', 'dialogue'] as const)(
    'serializes %s synthesis and returns a readable audio stream',
    async (kind) => {
      const requests: Request[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      });
      const client = new ElevenLabsClient({ apiKey: 'test', maxRetries: 0, fetch });
      const stream =
        kind === 'speech'
          ? await client.textToSpeech.convert('voice-test', {
              text: 'Hello',
              modelId: 'eleven_multilingual_v2',
              outputFormat: 'mp3_44100_128',
            })
          : await client.textToDialogue.convert({
              inputs: [{ text: 'Hello', voiceId: 'voice-test' }],
              modelId: 'eleven_v3',
              outputFormat: 'mp3_44100_128',
            });
      expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(new URL(requests[0]!.url).searchParams.get('output_format')).toBe('mp3_44100_128');
      expect(await requests[0]!.json()).toMatchObject(
        kind === 'speech'
          ? { text: 'Hello', model_id: 'eleven_multilingual_v2' }
          : { inputs: [{ text: 'Hello', voice_id: 'voice-test' }], model_id: 'eleven_v3' },
      );
    },
  );

  it('retains the voices.getAll response shape used by catalog synchronization', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ voices: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new ElevenLabsClient({ apiKey: 'test', maxRetries: 0, fetch });
    expect(await client.voices.getAll()).toEqual({ voices: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
