import React from 'react';

export type PipelineStageKey = 'validate' | 'extract' | 'notion' | 'tts' | 'upload' | 'attach';
export type PipelineStageState = 'pending' | 'running' | 'succeeded' | 'failed';

type StageState = PipelineStageState | 'neutral';

const STAGES: { key: PipelineStageKey; label: string }[] = [
  { key: 'validate', label: 'Val' },
  { key: 'extract', label: 'Ext' },
  { key: 'notion', label: 'Not' },
  { key: 'tts', label: 'TTS' },
  { key: 'upload', label: 'Up' },
  { key: 'attach', label: 'Att' },
];

export const PipelineStrip: React.FC<{
  stages: Partial<Record<PipelineStageKey, PipelineStageState>> | null;
}> = ({ stages }) => {
  const hasStages = Boolean(stages);

  return (
    <div className={`pipeline-strip ${hasStages ? '' : 'pipeline-neutral'}`}>
      {STAGES.map((stage) => {
        const state: StageState = hasStages
          ? stages?.[stage.key] ?? 'pending'
          : 'neutral';
        const title = hasStages
          ? `${stage.key}: ${state}`
          : 'Stage data unavailable';
        return (
          <div
            key={stage.key}
            className={`pipeline-stage pipeline-${state}`}
            title={title}
            aria-label={title}
          >
            <span>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
};
