import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createResolvedVoicePlan, type PreparedStudyTextSynthesis } from '@esl-pipeline/tts-core';

import {
  type AssignmentManifest,
  createFilesystemManifestStore,
  sanitizeAssignmentManifest,
} from '../src/manifest.js';

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

  it('round-trips contextual schema-v2 speech plans through the manifest store', async () => {
    const promptHash = 'b'.repeat(64);
    const input: AssignmentManifest = {
      schemaVersion: 5,
      mdHash: 'md-hash',
      timestamp: '2026-07-30T00:00:00.000Z',
      speechPlans: {
        studyText: {
          schemaVersion: 2,
          mode: 'prompted',
          provider: 'inworld',
          model: 'inworld-tts-2',
          sourceHash: 'source-hash',
          performanceContextHash: 'c'.repeat(64),
          resolvedPerformanceMode: 'dialogue',
          performanceContext: {
            overallDirection: {
              components: [
                { dimension: 'relationship', direction: 'sound like collaborative colleagues' },
              ],
              basis: ['frontmatter:topic'],
            },
            speakerEnvelopes: [
              {
                speaker: 'Maya',
                baselineDirection: {
                  components: [{ dimension: 'style', direction: 'warm practical and direct' }],
                  basis: ['speaker_profile:Maya:persona'],
                },
              },
            ],
          },
          planner: {
            provider: 'google_ai_studio',
            model: 'gemini-3.1-flash-lite',
            returnedModel: 'gemini-3.1-flash-lite-2026-07-15',
            generatedAt: '2026-07-30T00:00:00.000Z',
            promptPolicyVersion: 'speech-performance-v3-contextual-continuity',
            promptHash,
          },
          segments: [
            {
              id: 'segment-1',
              speaker: 'Maya',
              text: 'We need a clearer deadline.',
            },
          ],
        },
      },
    };
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-manifest-v2-'));
    const mdPath = join(dir, 'lesson.md');
    const store = createFilesystemManifestStore();
    await store.writeManifest(mdPath, input);
    const manifest = await store.readManifest(mdPath);

    expect(manifest?.speechPlans?.studyText).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        resolvedPerformanceMode: 'dialogue',
        performanceContextHash: 'c'.repeat(64),
        planner: expect.objectContaining({
          returnedModel: 'gemini-3.1-flash-lite-2026-07-15',
          promptPolicyVersion: 'speech-performance-v3-contextual-continuity',
          promptHash,
        }),
      }),
    );
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
