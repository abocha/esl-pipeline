import { describe, expect, it } from 'vitest';
import { addAudioUnderStudyText } from '../src/index.js';

describe('addAudioUnderStudyText', () => {
  it('returns stubbed replacement state', async () => {
    const result = await addAudioUnderStudyText('page', 'https://example.com/audio.mp3', { replace: true });
    expect(result.replaced).toBe(true);
    expect(result.appended).toBe(false);
  });
});
