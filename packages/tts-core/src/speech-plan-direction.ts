import type {
  SpeechDirectionComponent,
  SpeechPerformancePlan,
  SpeechPerformancePlanSegment,
  SpeechPerformancePlanSegmentV2,
} from './types.js';

export interface EffectiveSpeechDirection {
  components: SpeechDirectionComponent[];
  instruction: string | undefined;
}

export function resolveEffectiveSpeechDirection(
  plan: SpeechPerformancePlan,
  segment: SpeechPerformancePlan['segments'][number],
): EffectiveSpeechDirection {
  if (plan.schemaVersion === 1) {
    return {
      components: [],
      instruction: segment.freeFormDirection,
    };
  }

  const contextualSegment = segment as SpeechPerformancePlanSegmentV2;
  const speaker = resolveSegmentPerformanceSpeaker(plan, contextualSegment);
  const speakerComponents =
    plan.performanceContext.speakerEnvelopes.find(
      (envelope) => envelope.speaker.toLocaleLowerCase() === speaker?.toLocaleLowerCase(),
    )?.baselineDirection.components ?? [];
  const turnComponents = contextualSegment.turnAdjustment?.components ?? [];
  const scopes = [
    plan.performanceContext.overallDirection.components,
    speakerComponents,
    turnComponents,
  ] as const;
  const hasNumericTempoOwner = Boolean(segment.pace && segment.pace !== 'natural');
  const components = scopes.flatMap((scope, scopeIndex) =>
    scope.filter((component) => {
      if (hasNumericTempoOwner && component.dimension === 'tempo') return false;
      return !scopes
        .slice(scopeIndex + 1)
        .some((closerScope) =>
          closerScope.some((candidate) => candidate.dimension === component.dimension),
        );
    }),
  );
  const instruction = components
    .map((component) => component.direction)
    .join(' ')
    .trim();
  return {
    components,
    instruction: instruction || undefined,
  };
}

function resolveSegmentPerformanceSpeaker(
  plan: Extract<SpeechPerformancePlan, { schemaVersion: 2 }>,
  segment: SpeechPerformancePlanSegment,
): string | undefined {
  if (segment.speaker) return segment.speaker;
  if (
    plan.resolvedPerformanceMode === 'monologue' &&
    plan.performanceContext.speakerEnvelopes.length === 1
  ) {
    return plan.performanceContext.speakerEnvelopes[0]!.speaker;
  }
  return undefined;
}
