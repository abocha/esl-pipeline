import { Play, RefreshCw, RotateCcw, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  type AssignmentPronunciation,
  assignmentInlineParts,
  assignmentPlainText,
} from '@esl-pipeline/contracts';

import { AudioPlayer, Field, Inline } from './primitives.js';
import type { HandoutMediaInputs, PronunciationClipInput } from './types.js';
import { safeMediaUrl } from './urls.js';

const lexical = /([\p{L}\p{M}\p{N}]+(?:['’‐‑-][\p{L}\p{M}\p{N}]+)*)/gu;

function StressedText({ text, words }: { text: string; words: string[] }) {
  const stressed = new Set(words.map((w) => w.normalize('NFKC').toLowerCase().match(lexical)?.[0]));
  const render = (value: string) =>
    value
      .split(lexical)
      .map((word, i) =>
        stressed.has(word.normalize('NFKC').toLowerCase()) ? <strong key={i}>{word}</strong> : word,
      );
  return assignmentInlineParts(text).map((part, i) =>
    part.highlighted ? (
      <code className="linguistic-highlight" key={i}>
        {render(part.text)}
      </code>
    ) : (
      <span key={i}>{render(part.text)}</span>
    ),
  );
}

function ClipControls({ clips }: { clips: readonly PronunciationClipInput[] }) {
  const icons = (
    <>
      <span className="clip-icon clip-icon-play" aria-hidden="true">
        <Play size={18} />
      </span>
      <span className="clip-icon clip-icon-playing" aria-hidden="true">
        <Volume2 size={18} />
      </span>
      <span className="clip-icon clip-icon-replay" aria-hidden="true">
        <RotateCcw size={18} />
      </span>
      <span className="clip-icon clip-icon-retry" aria-hidden="true">
        <RefreshCw size={18} />
      </span>
      <span className="clip-status sr-only">Play</span>
    </>
  );
  if (!clips.length)
    return (
      <button
        className="clip-button"
        type="button"
        disabled
        data-playback-state="play"
        aria-label="Pronunciation audio unavailable"
        title="Audio clip not generated yet"
      >
        {icons}
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
            className="clip-button"
            disabled={!url}
            data-pronunciation-clip={clip.id}
            data-audio-url={url ?? undefined}
            data-clip-text={assignmentPlainText(clip.text)}
            data-playback-state="play"
            aria-label={`Play pronunciation for ${assignmentPlainText(clip.text)}`}
            aria-live="polite"
            aria-atomic="true"
            title={
              url
                ? `Play pronunciation for ${assignmentPlainText(clip.text)}`
                : 'Audio clip not generated yet'
            }
          >
            {icons}
          </button>
        );
      })}
    </span>
  );
}

export function Pronunciation({
  pronunciation: p,
  media,
  preview,
}: {
  pronunciation: AssignmentPronunciation;
  media?: HandoutMediaInputs;
  preview?: boolean;
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
      <span>
        <Inline>{w.text}</Inline>
      </span>
      {controls(i, kind)}
      {w.transcription && (
        <span className="transcription">
          <Inline>{w.transcription}</Inline>
        </span>
      )}
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
          <Inline>{line.careful}</Inline> → <Inline>{line.spoken}</Inline>
        </span>
        {controls(i)}
      </span>
    ));
  else
    items = p.drills.map((d, i) => (
      <span key={i} className="pronunciation-line-main">
        <span className="pronunciation-line-text">
          {p.mode === 'rhythm_chunking' ? (
            d.chunks.map((chunk, j) => (
              <span key={j}>
                {j > 0 && ' | '}
                <Inline>{chunk}</Inline>
              </span>
            ))
          ) : p.mode === 'sentence_stress' ? (
            <StressedText text={d.text} words={d.stressedWords} />
          ) : (
            <Inline>{d.text}</Inline>
          )}
        </span>
        {controls(i)}
        {d.transcription && (
          <span className="transcription">
            <Inline>{d.transcription}</Inline>
          </span>
        )}
      </span>
    ));
  const sentence =
    'shadowSentence' in p ? p.shadowSentence : 'naturalSentence' in p ? p.naturalSentence : null;
  return (
    <section data-assignment-pronunciation={p.mode}>
      <Field label="Target" className="pronunciation-target">
        {p.target}
      </Field>
      <Field label="Focus">{p.focus}</Field>
      <Field label="Action">{p.action}</Field>
      <Field label="Deliverable">{p.deliverable}</Field>
      <ol lang="en">
        {items.map((item, i) => (
          <li className="pronunciation-item" data-pronunciation-item={i} key={i}>
            {item}
          </li>
        ))}
      </ol>
      {sentence && (
        <div className="callout pronunciation-sentence">
          <Field
            lang="en"
            label={p.mode === 'shadow_sentence' ? 'Shadow sentence' : 'Natural sentence practice'}
          >
            {sentence}
          </Field>
          <AudioPlayer
            url={media?.pronunciationAudio?.primaryClip?.url}
            label="Pronunciation sentence audio"
            preview={preview}
          />
        </div>
      )}
      {'contourCue' in p && p.contourCue && <Field label="Contour cue">{p.contourCue}</Field>}
    </section>
  );
}
