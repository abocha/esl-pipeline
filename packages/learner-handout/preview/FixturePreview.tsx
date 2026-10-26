import { useState } from 'react';

import { LearnerHandout } from '../src/LearnerHandout.js';
import '../src/document.css';
import '../src/handout.css';
import '../src/pronunciation-playback.js';
import '../src/handout-interactions.js';
import {
  createFixture,
  createPolishFixture,
  type FixtureAudio,
  type FixtureMode,
  pronunciationModes,
} from './fixtures.js';
import './preview.css';

export function FixturePreview() {
  const [mode, setMode] = useState<FixtureMode>('shadow_sentence');
  const [audio, setAudio] = useState<FixtureAudio>('mixed');
  const [polish, setPolish] = useState(false);
  return (
    <>
      <div className="fixture-controls">
        <strong>Local fixture preview</strong>
        <label>
          <input
            type="checkbox"
            checked={polish}
            onChange={(event) => setPolish(event.target.checked)}
          />{' '}
          ESL-33 polish fixture
        </label>
        <label>
          Pronunciation{' '}
          <select
            disabled={polish}
            value={mode}
            onChange={(event) => setMode(event.target.value as FixtureMode)}
          >
            {[...pronunciationModes, 'none'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Audio{' '}
          <select
            disabled={polish}
            value={audio}
            onChange={(event) => setAudio(event.target.value as FixtureAudio)}
          >
            {['mixed', 'available', 'unavailable'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <span>Audio is a local test tone, not speech.</span>
      </div>
      <LearnerHandout
        key={`${mode}-${audio}-${polish}`}
        {...(polish ? createPolishFixture() : createFixture(mode, audio))}
      />
    </>
  );
}
