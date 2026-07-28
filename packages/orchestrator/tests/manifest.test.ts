import { describe, expect, it } from 'vitest';

import { createResolvedVoicePlan, type PreparedStudyTextSynthesis } from '@esl-pipeline/tts-core';

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

  it('round-trips optional speech and voice policy provenance', () => {
    const prepared: PreparedStudyTextSynthesis = {
      selection: { provider: 'inworld', model: 'inworld-tts-2' },
      sourceHash: 'source-hash',
      segments: [{ id: 'segment-1', speaker: 'Maya', text: 'Hello.' }],
      voices: [],
      voiceAssignments: { Maya: 'voice-1' },
    };
    const voicePlan = createResolvedVoicePlan(prepared, [
      {
        speaker: 'Maya',
        voiceId: 'voice-1',
        language: 'en-US',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
    ]);
    const promptHash = 'a'.repeat(64);
    const manifest = sanitizeAssignmentManifest({
      schemaVersion: 5,
      mdHash: 'md-hash',
      timestamp: '2026-07-28T00:00:00.000Z',
      voicePlans: { studyText: voicePlan },
      speechPlans: {
        studyText: {
          schemaVersion: 1,
          mode: 'prompted',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          planner: {
            provider: 'openai',
            model: 'gpt-5.6',
            generatedAt: '2026-07-28T00:00:00.000Z',
            promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
            promptHash,
          },
          segments: prepared.segments,
        },
      },
    });

    expect(manifest.voicePlans?.studyText).toMatchObject({
      capabilityPolicyVersion: 'model-scoped-v1',
      assignments: [{ language: 'en-US' }],
    });
    expect(manifest.speechPlans?.studyText?.planner).toMatchObject({
      promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
      promptHash,
    });
  });

  it('does not invent provenance for unversioned legacy plans', () => {
    const manifest = sanitizeAssignmentManifest({
      schemaVersion: 5,
      mdHash: 'md-hash',
      timestamp: '2026-07-28T00:00:00.000Z',
      voicePlans: {
        studyText: {
          schemaVersion: 1,
          mode: 'deterministic',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          assignments: [],
        },
      },
      speechPlans: {
        studyText: {
          schemaVersion: 1,
          mode: 'prompted',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          planner: {
            provider: 'openai',
            model: 'legacy-model',
            generatedAt: '2026-07-28T00:00:00.000Z',
          },
          segments: [],
        },
      },
    });

    expect(manifest.voicePlans?.studyText).not.toHaveProperty('capabilityPolicyVersion');
    expect(manifest.speechPlans?.studyText?.planner).not.toHaveProperty('promptPolicyVersion');
    expect(manifest.speechPlans?.studyText?.planner).not.toHaveProperty('promptHash');
  });

  it('removes malformed optional provenance instead of persisting it', () => {
    const manifest = sanitizeAssignmentManifest({
      schemaVersion: 5,
      mdHash: 'md-hash',
      timestamp: '2026-07-28T00:00:00.000Z',
      voicePlans: {
        studyText: {
          schemaVersion: 1,
          capabilityPolicyVersion: 'future-policy',
          mode: 'deterministic',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          assignments: [],
        },
      },
      speechPlans: {
        studyText: {
          schemaVersion: 1,
          mode: 'prompted',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          planner: {
            provider: 'openai',
            model: 'gpt-5.6',
            generatedAt: '2026-07-28T00:00:00.000Z',
            promptPolicyVersion: 'future-policy',
            promptHash: 'not-a-sha256',
          },
          segments: [],
        },
      },
    } as never);

    expect(manifest.voicePlans?.studyText).not.toHaveProperty('capabilityPolicyVersion');
    expect(manifest.speechPlans?.studyText?.planner).not.toHaveProperty('promptPolicyVersion');
    expect(manifest.speechPlans?.studyText?.planner).not.toHaveProperty('promptHash');
  });
});
