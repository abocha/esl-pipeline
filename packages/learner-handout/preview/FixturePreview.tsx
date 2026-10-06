import { useState } from 'react';

import { LearnerHandout } from '../src/LearnerHandout.js';
import '../src/handout.css';
import '../src/pronunciation-playback.js';
import {
  createFixture,
  type FixtureAudio,
  type FixtureMode,
  pronunciationModes,
} from './fixtures.js';
import './preview.css';

export function FixturePreview() {
  const [mode, setMode] = useState<FixtureMode>('shadow_sentence');
  const [audio, setAudio] = useState<FixtureAudio>('mixed');
  return (
    <>
      <div className="fixture-controls">
        <strong>Local fixture preview</strong>
        <label>
          Pronunciation{' '}
          <select value={mode} onChange={(event) => setMode(event.target.value as FixtureMode)}>
            {[...pronunciationModes, 'none'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Audio{' '}
          <select value={audio} onChange={(event) => setAudio(event.target.value as FixtureAudio)}>
            {['mixed', 'available', 'unavailable'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <span>Audio is a local test tone, not speech.</span>
      </div>
      <LearnerHandout key={`${mode}-${audio}`} {...createFixture(mode, audio)} />
    </>
  );
}
