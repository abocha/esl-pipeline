import { describe, expect, it } from 'vitest';

import { sanitizeAssignmentManifest } from '../src/manifest.js';

describe('assignment manifest voice plans', () => {
  it('normalizes legacy resolved voice plans to deterministic mode', () => {
    const manifest = sanitizeAssignmentManifest({
      schemaVersion: 5,
      mdHash: 'md-hash',
      timestamp: '2026-06-02T00:00:00.000Z',
      voicePlans: {
        studyText: {
          schemaVersion: 1,
          mode: 'resolved',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          assignments: [],
        },
      },
    } as never);

    expect(manifest.voicePlans?.studyText?.mode).toBe('deterministic');
  });
});
