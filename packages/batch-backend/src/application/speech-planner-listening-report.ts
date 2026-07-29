import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SpeechPlannerEvalAttemptRecord } from './speech-planner-evaluator.js';

export interface SpeechPlannerListeningVariant {
  attemptId: string;
  fixtureId: string;
  requestedModel: SpeechPlannerEvalAttemptRecord['requestedModel'];
  promptPolicyVersion: SpeechPlannerEvalAttemptRecord['promptPolicyVersion'];
  voiceId?: string;
  settingsHash: string;
  record: SpeechPlannerEvalAttemptRecord;
}

export interface SpeechPlannerAudioBlock {
  blockId: string;
  fixtureId: string;
  repetition: number;
  reasons: string[];
  complete: boolean;
  preferenceEligible: boolean;
  variants: SpeechPlannerListeningVariant[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function groupReasons(records: readonly SpeechPlannerEvalAttemptRecord[]): string[] {
  const tags = new Set(records.flatMap((record) => record.fixtureTags ?? []));
  const reasons: string[] = [];
  if (tags.has('neutral-dialogue')) reasons.push('neutral');
  if (tags.has('explicit-slow') || tags.has('explicit-brisk')) reasons.push('explicit_pace');
  if (
    records.some((record) =>
      (record.analysis?.warnings ?? []).some((w) => w.code === 'high_cue_density'),
    )
  ) {
    reasons.push('high_cue_density');
  }
  if (
    records.some((record) =>
      record.analysis?.hardFailures.some((failure) => failure.code.includes('render')),
    )
  ) {
    reasons.push('renderer_failure');
  }
  const statuses = new Set(records.map((record) => record.promptedPlanStatus));
  if (statuses.size > 1) reasons.push('metric_disagreement');
  return reasons;
}

export function selectSpeechPlannerAudioBlocks(
  records: readonly SpeechPlannerEvalAttemptRecord[],
): SpeechPlannerAudioBlock[] {
  const groups = new Map<string, SpeechPlannerEvalAttemptRecord[]>();
  for (const record of records) {
    if (!record.rendered || record.rendered.length === 0) continue;
    const key = `${record.fixtureId}|${record.repetition}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const blocks = [...groups.entries()].map(([key, group]) => {
    const first = group[0]!;
    const expectedCells = new Set(
      group.map((record) => `${record.requestedModel}|${record.promptPolicyVersion}`),
    );
    const complete = expectedCells.size === 4;
    const settingsHash = hash(
      JSON.stringify({
        fixtureId: first.fixtureId,
        repetition: first.repetition,
        ttsModel: first.ttsModel,
        rendered: first.rendered?.map((segment) => ({
          voiceId: segment.voiceId,
          language: segment.language,
        })),
        sampleRateHz: 48_000,
        encoding: 'mp3',
      }),
    );
    return {
      blockId: `block-${hash(key).slice(0, 12)}`,
      fixtureId: first.fixtureId,
      repetition: first.repetition,
      reasons: groupReasons(group),
      complete,
      preferenceEligible: complete,
      variants: group.map((record) => ({
        attemptId: record.attemptId,
        fixtureId: record.fixtureId,
        requestedModel: record.requestedModel,
        promptPolicyVersion: record.promptPolicyVersion,
        voiceId: record.rendered?.[0]?.voiceId,
        settingsHash,
        record,
      })),
    } satisfies SpeechPlannerAudioBlock;
  });

  const cueDensityByBlock = blocks
    .map((block) => ({
      block,
      maximum: Math.max(
        ...block.variants
          .map((variant) => variant.record.analysis?.metrics.cueRate)
          .filter((value): value is number => value !== undefined),
      ),
    }))
    .filter((entry) => Number.isFinite(entry.maximum));
  if (cueDensityByBlock.length > 0) {
    const maximum = Math.max(...cueDensityByBlock.map((entry) => entry.maximum));
    for (const entry of cueDensityByBlock.filter((candidate) => candidate.maximum === maximum)) {
      entry.block.reasons.push('highest_cue_density');
    }
  }
  const pauseByBlock = blocks
    .map((block) => ({
      block,
      maximum: Math.max(
        ...block.variants.flatMap(
          (variant) => variant.record.analysis?.metrics.pauseValuesMs ?? [],
        ),
      ),
    }))
    .filter((entry) => Number.isFinite(entry.maximum));
  if (pauseByBlock.length > 0) {
    const maximum = Math.max(...pauseByBlock.map((entry) => entry.maximum));
    for (const entry of pauseByBlock.filter((candidate) => candidate.maximum === maximum)) {
      entry.block.reasons.push('longest_pause');
    }
  }

  const selected = new Map<string, SpeechPlannerAudioBlock>();
  const addFirst = (reason: string) => {
    const block = blocks.find((candidate) => candidate.reasons.includes(reason));
    if (block) selected.set(block.blockId, block);
  };
  addFirst('neutral');
  addFirst('explicit_pace');
  addFirst('high_cue_density');
  addFirst('highest_cue_density');
  addFirst('longest_pause');
  addFirst('metric_disagreement');
  for (const block of blocks.filter((candidate) =>
    candidate.reasons.includes('renderer_failure'),
  )) {
    selected.set(block.blockId, block);
  }
  if (selected.size === 0 && blocks[0]) selected.set(blocks[0].blockId, blocks[0]);
  return [...selected.values()];
}

function shuffle<T>(values: readonly T[], seed: string): T[] {
  return [...values].sort((left, right) =>
    hash(`${seed}|${JSON.stringify(left)}`).localeCompare(hash(`${seed}|${JSON.stringify(right)}`)),
  );
}

export interface SpeechPlannerListeningIdentityBlock {
  blockId: string;
  fixtureId: string;
  complete: boolean;
  preferenceEligible: boolean;
  variants: Array<{
    blindLabel: string;
    attemptId: string;
    requestedModel: SpeechPlannerListeningVariant['requestedModel'];
    promptPolicyVersion: SpeechPlannerListeningVariant['promptPolicyVersion'];
    settingsHash: string;
  }>;
}

export function buildSpeechPlannerListeningIdentity(
  blocks: readonly SpeechPlannerAudioBlock[],
  seed: string,
): SpeechPlannerListeningIdentityBlock[] {
  return blocks.map((block) => ({
    blockId: block.blockId,
    fixtureId: block.fixtureId,
    complete: block.complete,
    preferenceEligible: block.preferenceEligible,
    variants: shuffle(block.variants, `${seed}|${block.blockId}`).map((variant, index) => ({
      blindLabel: String.fromCharCode(65 + index),
      attemptId: variant.attemptId,
      requestedModel: variant.requestedModel,
      promptPolicyVersion: variant.promptPolicyVersion,
      settingsHash: variant.settingsHash,
    })),
  }));
}

export function hashSpeechPlannerListeningIdentity(
  identity: readonly SpeechPlannerListeningIdentityBlock[],
): string {
  return hash(JSON.stringify(identity));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function writeBlindListeningReport(args: {
  outputDirectory: string;
  blocks: readonly SpeechPlannerAudioBlock[];
  seed: string;
  synthesize: (args: {
    block: SpeechPlannerAudioBlock;
    variant: SpeechPlannerListeningVariant;
    blindLabel: string;
  }) => Promise<{
    audioPath: string;
    latencyMs: number;
    durationSeconds?: number;
    bytes: number;
    contentHash: string;
    cacheOutcome: 'hit' | 'miss' | 'unknown';
  }>;
}): Promise<void> {
  mkdirSync(args.outputDirectory, { recursive: true });
  const keyBlocks: unknown[] = [];
  const htmlBlocks: string[] = [];
  const identity = buildSpeechPlannerListeningIdentity(args.blocks, args.seed);
  for (const block of args.blocks) {
    const ordered = shuffle(block.variants, `${args.seed}|${block.blockId}`);
    const keyedVariants: unknown[] = [];
    const players: string[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const variant = ordered[index]!;
      const blindLabel = String.fromCharCode(65 + index);
      const synthesis = await args.synthesize({ block, variant, blindLabel });
      keyedVariants.push({
        blindLabel,
        attemptId: variant.attemptId,
        requestedModel: variant.requestedModel,
        promptPolicyVersion: variant.promptPolicyVersion,
        settingsHash: variant.settingsHash,
        synthesis,
      });
      players.push(
        `<article><h3>Variant ${blindLabel}</h3><audio controls src="${escapeHtml(synthesis.audioPath)}"></audio></article>`,
      );
    }
    keyBlocks.push({
      blockId: block.blockId,
      fixtureId: block.fixtureId,
      complete: block.complete,
      preferenceEligible: block.preferenceEligible,
      variants: keyedVariants,
    });
    const preferenceInputs = block.preferenceEligible
      ? `<label>Pairwise preference <input name="${escapeHtml(block.blockId)}-pairwise" /></label>
<label>Ranked choice <input name="${escapeHtml(block.blockId)}-ranked" /></label>`
      : '<p>Incomplete comparison; pairwise and ranked preferences are disabled.</p>';
    htmlBlocks.push(`<section>
<h2>Listening block ${escapeHtml(block.blockId)}</h2>
${players.join('\n')}
${preferenceInputs}
${[
  'Naturalness',
  'Clarity for an ESL learner',
  'Appropriateness',
  'Pacing',
  'Unwanted pauses',
  'Spoken control text',
  'Overall preference',
]
  .map(
    (label) =>
      `<label>${label} <input name="${escapeHtml(block.blockId)}-${escapeHtml(label.toLocaleLowerCase().replaceAll(' ', '-'))}" /></label>`,
  )
  .join('\n')}
</section>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Blind speech planner listening</title></head><body><h1>Blind speech planner listening</h1>${htmlBlocks.join('\n')}</body></html>`;
  writeFileSync(join(args.outputDirectory, 'index.html'), html, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(
    join(args.outputDirectory, 'key.json'),
    JSON.stringify(
      {
        seed: args.seed,
        identityHash: hashSpeechPlannerListeningIdentity(identity),
        blocks: keyBlocks,
      },
      null,
      2,
    ),
    { encoding: 'utf8', flag: 'wx' },
  );
}
