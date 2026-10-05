import type { ReactNode } from 'react';

import type { AssignmentPronunciation } from '@esl-pipeline/contracts';

import { AudioPlayer, Field } from './primitives.js';
import type { HandoutMediaInputs, PronunciationClipInput } from './types.js';
import { safeMediaUrl } from './urls.js';

const lexical = /([\p{L}\p{M}\p{N}]+(?:['’‐‑-][\p{L}\p{M}\p{N}]+)*)/gu;

function StressedText({ text, words }: { text: string; words: string[] }) {
  const stressed = new Set(words.map((w) => w.normalize('NFKC').toLowerCase().match(lexical)?.[0]));
  return (
    <>
      {text
        .split(lexical)
        .map((word, i) =>
          stressed.has(word.normalize('NFKC').toLowerCase()) ? (
            <strong key={i}>{word}</strong>
          ) : (
            word
          ),
        )}
    </>
  );
}

function ClipControls({ clips }: { clips: readonly PronunciationClipInput[] }) {
  if (!clips.length)
    return (
      <button type="button" disabled title="Audio clip not generated yet">
        Play
      </button>
    );
  return (
    <span className="clip-controls">
      {clips.map((clip, i) => {
        const url = safeMediaUrl(clip.url);
        return (
          <button
            key={i}
            type="button"
            disabled={!url}
            data-pronunciation-clip={clip.id}
            data-audio-url={url ?? undefined}
            aria-label={`Play pronunciation for ${clip.text}`}
            title={url ? undefined : 'Audio clip not generated yet'}
          >
            {clip.label ?? 'Play'}
          </button>
        );
      })}
    </span>
  );
}

export function Pronunciation({
  pronunciation: p,
  media,
}: {
  pronunciation: AssignmentPronunciation;
  media?: HandoutMediaInputs;
}) {
  const clips = media?.pronunciationAudio?.itemClips ?? [];
  const controls = (index: number, kind?: PronunciationClipInput['kind']) => (
    <ClipControls
      clips={clips.filter((c) => c.itemIndex === index && (!kind || c.kind === kind))}
    />
  );
  const word = (
    w: { text: string; transcription: string | null },
    i: number,
    kind?: PronunciationClipInput['kind'],
  ) => (
    <span className="pronunciation-word-main">
      <span>{w.text}</span>
      {controls(i, kind)}
      {w.transcription && <span className="transcription">{w.transcription}</span>}
    </span>
  );
  let items: ReactNode[];
  if (p.mode === 'shadow_sentence') items = p.words.map((w, i) => word(w, i));
  else if (p.mode === 'minimal_pair')
    items = p.pairs.map((pair, i) => (
      <span key={i} className="pronunciation-word-pair">
        {word(pair.left, i, 'pair_left')}
        <span> — </span>
        {word(pair.right, i, 'pair_right')}
      </span>
    ));
  else if (p.mode === 'connected_speech')
    items = p.lines.map((line, i) => (
      <span key={i} className="pronunciation-line-main">
        <span>
          {line.careful} → {line.spoken}
        </span>
        {controls(i)}
      </span>
    ));
  else
    items = p.drills.map((d, i) => (
      <span key={i} className="pronunciation-line-main">
        <span className="pronunciation-line-text">
          {p.mode === 'rhythm_chunking' ? (
            d.chunks.join(' | ')
          ) : p.mode === 'sentence_stress' ? (
            <StressedText text={d.text} words={d.stressedWords} />
          ) : (
            d.text
          )}
        </span>
        {controls(i)}
        {d.transcription && <span className="transcription">{d.transcription}</span>}
      </span>
    ));
  const sentence =
    'shadowSentence' in p ? p.shadowSentence : 'naturalSentence' in p ? p.naturalSentence : null;
  return (
    <section data-assignment-pronunciation={p.mode}>
      <Field label="Mode">{p.mode}</Field>
      <Field label="Target">{p.target}</Field>
      <Field label="Focus">{p.focus}</Field>
      <Field label="Action">{p.action}</Field>
      <Field label="Deliverable">{p.deliverable}</Field>
      <ol>
        {items.map((item, i) => (
          <li className="pronunciation-item" data-pronunciation-item={i} key={i}>
            {item}
          </li>
        ))}
      </ol>
      {sentence && (
        <>
          <Field
            label={p.mode === 'shadow_sentence' ? 'Shadow sentence' : 'Natural sentence practice'}
          >
            {sentence}
          </Field>
          <AudioPlayer
            url={media?.pronunciationAudio?.primaryClip?.url}
            label="Pronunciation sentence audio"
          />
        </>
      )}
      {'contourCue' in p && p.contourCue && <Field label="Contour cue">{p.contourCue}</Field>}
      <p className="playback-status" role="status" aria-live="polite" />
    </section>
  );
}
