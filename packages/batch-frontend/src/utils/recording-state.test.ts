import { describe, expect, it } from 'vitest';

import type { RecordingDto, RecordingErrorCode } from '@esl-pipeline/contracts';

import {
  GENERIC_RECORDING_TERMINAL_ACTION,
  getRecordingErrorAction,
  getRecordingProductLabel,
  RECORDING_ERROR_ACTIONS,
  selectNewestRecording,
} from './recording-state';

describe('recording product state', () => {
  it.each([
    ['checking', 'Checking recording'],
    ['waiting', 'Waiting to transcribe'],
    ['transcribing', 'Transcribing'],
    ['retrying', 'Trying again automatically'],
    ['ready', 'Ready for review'],
    ['attention', 'Recording needs attention'],
  ] as const)('renders %s with the approved product copy', (productState, label) => {
    expect(getRecordingProductLabel({ productState }, false, 0)).toBe(label);
  });

  it('distinguishes upload transport from server-side checking', () => {
    expect(getRecordingProductLabel(null, true, 50)).toBe('Uploading recording');
    expect(getRecordingProductLabel(null, true, 100)).toBe('Checking recording');
  });

  it('maps every stable backend error and fails safely for unknown diagnostics', () => {
    const codes = Object.keys(RECORDING_ERROR_ACTIONS) as RecordingErrorCode[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(getRecordingErrorAction(code)).toBeTruthy();
    expect(getRecordingErrorAction('raw-provider-stack')).toBe(GENERIC_RECORDING_TERMINAL_ACTION);
  });

  it('does not let an older asynchronous projection overwrite newer hydrated truth', () => {
    const current = { updatedAt: '2026-09-07T10:00:02.000Z', value: 'hydrated' };
    const stale = { updatedAt: '2026-09-07T10:00:01.000Z', value: 'stale-poll' };
    expect(selectNewestRecording(current, stale)).toBe(current);
  });

  it('keeps a cache-hit projection ready without audio', () => {
    const cacheHit = {
      productState: 'ready',
      runState: null,
      audioLifecycle: 'not_retained',
      audioAvailable: false,
    } as Pick<RecordingDto, 'productState' | 'runState' | 'audioLifecycle' | 'audioAvailable'>;
    expect(cacheHit).toEqual({
      productState: 'ready',
      runState: null,
      audioLifecycle: 'not_retained',
      audioAvailable: false,
    });
  });
});
