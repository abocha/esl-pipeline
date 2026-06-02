import type {
  VoicePlanRanker,
  VoicePlanRankRequest,
  VoicePlanRankResult,
} from '@esl-pipeline/tts-core';

import type { BatchBackendConfig } from '../config/env.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  type GenerationBudgetGuardDependencies,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import {
  executeGoogleStructuredGeneration,
  type ProviderStructuredExecutionResult,
} from './generation-providers.js';

type GoogleStructuredExecutor = typeof executeGoogleStructuredGeneration;

const VOICE_RANK_RESPONSE_SCHEMA = {
  name: 'tts_voice_plan_ranking',
  description: 'One selected Inworld voice per speaker from the supplied shortlist.',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['selections'],
    properties: {
      selections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['speaker', 'voiceId'],
          properties: {
            speaker: { type: 'string' },
            voiceId: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export function createBackendVoicePlanRanker(
  config: BatchBackendConfig,
  overrides: {
    executor?: GoogleStructuredExecutor;
    budget?: GenerationBudgetGuardDependencies;
    now?: () => Date;
  } = {},
): VoicePlanRanker {
  const executor = overrides.executor ?? executeGoogleStructuredGeneration;
  const now = overrides.now ?? (() => new Date());
  const repository = resolveGenerationBudgetRepository({ config, overrides: overrides.budget });

  return {
    metadata: {
      provider: 'google_ai_studio',
      model: config.voiceRanker.model,
      generatedAt: now().toISOString(),
    },
    debugLogPlan: config.voiceRanker.debugLogPlan,
    async rank(request) {
      const prompt = buildVoiceRankerPrompt(request);
      await enforceGenerationBudgetBeforeAttempt({
        config,
        provider: 'google_ai_studio',
        model: config.voiceRanker.model,
        prompt,
        maxOutputTokens: config.voiceRanker.maxOutputTokens,
        now: now(),
        repository,
        limits: {
          rpmBudget: config.voiceRanker.rpmBudget,
          dailyRequestBudget: config.voiceRanker.dailyRequestBudget,
        },
      });
      const result = await executor({
        config: config.generation,
        request: {
          model: config.voiceRanker.model,
          prompt,
          maxOutputTokens: config.voiceRanker.maxOutputTokens,
          responseSchema: VOICE_RANK_RESPONSE_SCHEMA,
        },
      });
      await recordUsage(config, repository, now, result);
      return validateVoiceRankResult(request, result.output);
    },
  };
}

function buildVoiceRankerPrompt(request: VoicePlanRankRequest): string {
  return [
    "Choose exactly one natural, classroom-suitable voice for EACH speaker from that speaker's supplied shortlist.",
    'Match role, persona, voice direction, regional accent, gender, and age when present.',
    'Prefer steerable voices when fit is close, but choose a clearly better non-steerable voice when appropriate.',
    'Avoid theatrical, promotional, shouty, or strident delivery unless the speaker profile requests it.',
    'Return exactly one valid JSON object with this shape: {"selections":[{"speaker":"...","voiceId":"..."}]}.',
    'Include exactly one selections item for every input speaker. Do not omit speakers. Do not emit Markdown fences, prose, reasons, or trailing text.',
    'Return only shortlist voice IDs. Do not reuse a voice when another suitable option exists.',
    JSON.stringify(request),
  ].join('\n\n');
}

function validateVoiceRankResult(
  request: VoicePlanRankRequest,
  output: unknown,
): VoicePlanRankResult {
  const selections = (output as Partial<VoicePlanRankResult>)?.selections;
  if (!Array.isArray(selections)) {
    throw new Error('Voice ranker output must contain a selections array.');
  }
  const shortlistBySpeaker = new Map(
    request.speakers.map((speaker) => [
      speaker.speaker,
      new Set(speaker.candidates.map((candidate) => candidate.voiceId)),
    ]),
  );
  if (selections.length !== shortlistBySpeaker.size) {
    throw new Error('Voice ranker output must select exactly one voice per speaker.');
  }
  const seenSpeakers = new Set<string>();
  return {
    selections: selections.map((selection) => {
      const speaker = String(selection.speaker ?? '');
      const voiceId = String(selection.voiceId ?? '');
      if (!shortlistBySpeaker.get(speaker)?.has(voiceId) || seenSpeakers.has(speaker)) {
        throw new Error('Voice ranker output selected an unknown speaker or shortlist voice.');
      }
      seenSpeakers.add(speaker);
      return {
        speaker,
        voiceId,
      };
    }),
  };
}

async function recordUsage(
  config: BatchBackendConfig,
  repository: ReturnType<typeof resolveGenerationBudgetRepository>,
  now: () => Date,
  result: ProviderStructuredExecutionResult,
): Promise<void> {
  await recordGenerationBudgetUsageAfterSuccess({
    config,
    provider: 'google_ai_studio',
    model: config.voiceRanker.model,
    usageTotalTokens: result.usage?.totalTokens,
    now: now(),
    repository,
  });
}
