import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { JobStatus } from '../../utils/api';
import { AdvancedActionsStage, useAdvancedActionsController } from './MinimalAssignment.advanced';

const models = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
const job = {
  jobId: 'gemini-job',
  state: 'succeeded',
  ttsProvider: 'gemini',
  ttsModel: models[0],
  assignmentArtifact: { format: 'assignment_v1' },
} as JobStatus;
const modelOptions = { gemini: models, google: ['chirp3_hd'], elevenlabs: ['eleven_flash_v2_5'] };

function GeminiRerunControls() {
  const controller = useAdvancedActionsController({
    jobStatus: job,
    jobOptions: {
      supportedActions: [
        { type: 'rerun', implemented: true, label: 'Rerun', description: '', requiresFields: [] },
      ],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
    },
    selectedTtsProvider: 'gemini',
    ttsProviders: ['google', 'elevenlabs', 'gemini'],
    ttsModelOptionsByProvider: modelOptions,
    elevenlabsStandardModelOptions: ['eleven_flash_v2_5'],
    defaultPronunciationChunkProvider: 'google',
    applyJobStatusTransition: vi.fn(),
    refreshResumeJobs: vi.fn(),
  });
  return (
    <AdvancedActionsStage
      stage={{ id: 'advanced', title: 'Advanced', description: '', status: 'available' }}
      jobReady
      controller={controller}
      onRefreshActions={vi.fn()}
      jobOptionsError={null}
      ttsProviders={['google', 'elevenlabs', 'gemini']}
      ttsModelOptionsByProvider={modelOptions}
      elevenlabsStandardModelOptions={['eleven_flash_v2_5']}
      pronunciationChunkProviders={['google', 'gemini']}
      studyTextStrategies={['auto', 'dialogue', 'tts']}
    />
  );
}

describe('Gemini TTS operator selection', () => {
  it('offers Gemini models for each selected rerun family without substituting ElevenLabs models', () => {
    render(<GeminiRerunControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Technical rerun settings' }));
    for (const name of [
      'Study-text audio',
      'Main pronunciation audio',
      'Pronunciation chunk audio',
    ]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    const providers = screen.getAllByRole('combobox', { name: 'Provider' });
    expect(providers).toHaveLength(3);
    expect(providers.map((select) => (select as HTMLSelectElement).value)).toEqual([
      'gemini',
      'gemini',
      'google',
    ]);
    for (const select of providers) {
      expect(
        within(select).getByRole('option', { name: 'Gemini Cloud TTS' }).getAttribute('value'),
      ).toBe('gemini');
    }
    // A deliberate chunk override remains available independently of its Chirp default.
    fireEvent.change(providers[2]!, { target: { value: 'gemini' } });
    const modelSelectors = screen.getAllByRole('combobox', { name: 'Model' });
    expect(modelSelectors).toHaveLength(3);
    for (const select of modelSelectors) {
      expect((select as HTMLSelectElement).value).toBe(models[0]);
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.getAttribute('value')),
      ).toEqual(models);
      fireEvent.change(select, { target: { value: models[1] } });
      expect((select as HTMLSelectElement).value).toBe(models[1]);
    }
  });
});
