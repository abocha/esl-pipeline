import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePromptPolicyId,
} from '@esl-pipeline/tts-core';

export const SPEECH_PLANNER_EVAL_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
] as const;
export const SPEECH_PLANNER_EVAL_PROMPT_POLICIES = [
  'speech-performance-v1-restrained-natural',
  'speech-performance-v2-inworld-tts2',
] as const satisfies readonly SpeechPerformancePromptPolicyId[];

export type SpeechPlannerEvalModel = (typeof SPEECH_PLANNER_EVAL_MODELS)[number];

export interface SpeechPlannerEvalFixture {
  id: string;
  why: string;
  tags: string[];
  prepared: PreparedStudyTextSynthesis;
  expectedHardInvariants: string[];
  warningExpectations?: string[];
  contentHash: string;
}

export interface SpeechPlannerEvalVariant {
  attemptId: string;
  fixtureId: string;
  fixtureHash: string;
  model: SpeechPlannerEvalModel;
  promptPolicyVersion: SpeechPerformancePromptPolicyId;
  repetition: number;
  compatibilitySmoke: boolean;
}

export interface SpeechPlannerPriceSnapshot {
  version: string;
  capturedAt: string;
  source: string;
  currency: 'USD';
  perMillionTokens: Record<
    SpeechPlannerEvalModel,
    { input: number; outputIncludingThinking: number }
  >;
}

export type OfflineSpeechPlannerClassification =
  | 'valid'
  | 'invalid'
  | 'fallback_triggering'
  | 'unsafe_cue'
  | 'tts_1_5_protection';

export interface OfflineSpeechPlannerOutput {
  id: string;
  fixtureId: string;
  rawText: string;
  expectedClassification: OfflineSpeechPlannerClassification;
  contentHash: string;
}

const FIXTURE_ROOT = fileURLToPath(new URL('../../fixtures/speech-planner-eval/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function loadSpeechPlannerEvalFixtures(
  path = `${FIXTURE_ROOT}corpus-v1.json`,
): SpeechPlannerEvalFixture[] {
  const parsed = readJson(path);
  if (!Array.isArray(parsed)) throw new Error('Speech planner eval corpus must be an array.');
  const fixtures = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('Invalid speech planner eval fixture.');
    const fixture = entry as Omit<SpeechPlannerEvalFixture, 'contentHash'>;
    if (!fixture.id || !Array.isArray(fixture.tags) || !fixture.prepared) {
      throw new Error('Speech planner eval fixture is missing required fields.');
    }
    return { ...fixture, contentHash: sha256(stableJson(fixture)) };
  });
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length) {
    throw new Error('Speech planner eval fixture IDs must be unique.');
  }
  return fixtures;
}

export function buildSpeechPlannerEvalMatrix(args: {
  fixtures: readonly SpeechPlannerEvalFixture[];
  repetitions: number;
  models?: readonly SpeechPlannerEvalModel[];
  promptPolicies?: readonly SpeechPerformancePromptPolicyId[];
}): SpeechPlannerEvalVariant[] {
  if (!Number.isInteger(args.repetitions) || args.repetitions < 1) {
    throw new Error('Speech planner eval repetitions must be a positive integer.');
  }
  const models = args.models ?? SPEECH_PLANNER_EVAL_MODELS;
  const promptPolicies = args.promptPolicies ?? SPEECH_PLANNER_EVAL_PROMPT_POLICIES;
  const variants: SpeechPlannerEvalVariant[] = [];
  for (const fixture of [...args.fixtures].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const model of models) {
      for (const promptPolicyVersion of promptPolicies) {
        for (let repetition = 1; repetition <= args.repetitions; repetition += 1) {
          const stableFields = `${fixture.id}|${fixture.contentHash}|${model}|${promptPolicyVersion}|${repetition}`;
          variants.push({
            attemptId: `${fixture.id}-${sha256(stableFields).slice(0, 12)}`,
            fixtureId: fixture.id,
            fixtureHash: fixture.contentHash,
            model,
            promptPolicyVersion,
            repetition,
            compatibilitySmoke: false,
          });
        }
      }
    }
  }
  const smoke = variants.find((variant) => variant.model === 'gemini-3.5-flash-lite');
  if (smoke) smoke.compatibilitySmoke = true;
  return variants;
}

export function loadSpeechPlannerPriceSnapshot(
  path = `${FIXTURE_ROOT}pricing-2026-07-28.json`,
): SpeechPlannerPriceSnapshot {
  return readJson(path) as SpeechPlannerPriceSnapshot;
}

export function loadOfflineSpeechPlannerOutputs(
  path = `${FIXTURE_ROOT}planner-outputs-v1.json`,
): OfflineSpeechPlannerOutput[] {
  const parsed = readJson(path);
  if (!Array.isArray(parsed)) throw new Error('Offline speech planner outputs must be an array.');
  const fixtureIds = new Set(loadSpeechPlannerEvalFixtures().map((fixture) => fixture.id));
  return parsed.map((entry) => {
    const output = entry as OfflineSpeechPlannerOutput;
    if (!fixtureIds.has(output.fixtureId))
      throw new Error(`Unknown fixture ID: ${output.fixtureId}`);
    if (typeof output.rawText !== 'string' || sha256(output.rawText) !== output.contentHash) {
      throw new Error(`Offline output hash mismatch: ${output.id}`);
    }
    return output;
  });
}
