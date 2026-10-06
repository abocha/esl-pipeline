import type { AssignmentPronunciation, AssignmentV1 } from '@esl-pipeline/contracts';

import base from '../../contracts/tests/assignment-mission-fixture.json';
import type { LearnerHandoutProps, PronunciationClipInput } from '../src/types.js';

export const pronunciationModes = [
  'shadow_sentence',
  'minimal_pair',
  'connected_speech',
  'intonation',
  'rhythm_chunking',
  'sentence_stress',
] as const;
export type FixtureMode = (typeof pronunciationModes)[number] | 'none';
export type FixtureAudio = 'available' | 'mixed' | 'unavailable';

const common = {
  target: 'Clear speech',
  focus: 'Natural signposting',
  action: 'Listen and repeat',
  deliverable: 'Optional practice recording',
};
const drill = {
  text: 'First, save it.',
  transcription: '/fɜːst seɪv ɪt/',
  chunks: ['First,', 'save it.'],
  stressedWords: ['FIRST'],
};
const pronunciations: Record<(typeof pronunciationModes)[number], AssignmentPronunciation> = {
  shadow_sentence: base.pronunciation as AssignmentPronunciation,
  minimal_pair: {
    ...common,
    mode: 'minimal_pair',
    pairs: [0, 1].map(() => ({
      left: { text: 'ship', transcription: '/ʃɪp/' },
      right: { text: 'sheep', transcription: '/ʃiːp/' },
    })),
  },
  connected_speech: {
    ...common,
    mode: 'connected_speech',
    lines: [{ careful: 'want to', spoken: '/wɒnə/' }],
    naturalSentence: 'I want to try.',
  },
  intonation: {
    ...common,
    mode: 'intonation',
    drills: [{ ...drill, text: 'Ready?', transcription: null, chunks: [], stressedWords: [] }],
    naturalSentence: 'Ready?',
    contourCue: 'Rise at the end.',
  },
  rhythm_chunking: {
    ...common,
    mode: 'rhythm_chunking',
    drills: [drill],
    naturalSentence: drill.text,
    contourCue: null,
  },
  sentence_stress: {
    ...common,
    mode: 'sentence_stress',
    drills: [drill],
    naturalSentence: drill.text,
    contourCue: 'Emphasize the first step.',
  },
};

/** Local tone demonstrates controls only; it is not speech or synthesized pronunciation. */
export function createFixture(
  mode: FixtureMode = 'shadow_sentence',
  audio: FixtureAudio = 'mixed',
): LearnerHandoutProps {
  const assignment = structuredClone(base) as AssignmentV1;
  assignment.metadata.icon = '🧭';
  assignment.toolkit.grammar[0]!.explanation +=
    ' После `will` нет окончания `-s` или `-ed`. Формула: `subject + will + base verb + a longer phrase that wraps comfortably on mobile`.';
  assignment.toolkit.vocabulary[0]!.expression = '`First`';
  assignment.toolkit.vocabulary[0]!.example = 'We `get back` soon.';
  assignment.practice[0]!.title = '1. Complete the `sentence`';
  assignment.practice[0]!.items[0]!.prompt += ' (`windy`)';
  assignment.input.source = {
    title: 'A useful demo',
    attribution: 'Local demonstration fixture',
    url: 'https://example.com/source?a=1&b=2',
  };
  assignment.input.media = [{ kind: 'audio', url: './fixture-tone.wav' }];
  assignment.pronunciation = mode === 'none' ? null : structuredClone(pronunciations[mode]);
  const p = assignment.pronunciation;
  const itemClips: PronunciationClipInput[] = [];
  const add = (itemIndex: number, kind: PronunciationClipInput['kind'], text: string) => {
    const index = itemClips.length;
    itemClips.push({
      id: `${mode}-${itemIndex}-${kind}`,
      itemIndex,
      kind,
      text,
      url:
        audio === 'unavailable' || (audio === 'mixed' && index === 1) ? null : './fixture-tone.wav',
    });
  };
  if (p?.mode === 'shadow_sentence')
    p.words.forEach((w, i) => {
      add(i, 'word_item', w.text);
    });
  else if (p?.mode === 'minimal_pair')
    p.pairs.forEach((pair, i) => {
      add(i, 'pair_left', pair.left.text);
      add(i, 'pair_right', pair.right.text);
    });
  else if (p?.mode === 'connected_speech')
    p.lines.forEach((line, i) => {
      add(i, 'connected_target', line.spoken);
    });
  else if (p && 'drills' in p)
    p.drills.forEach((d, i) => {
      add(i, 'sentence_item', d.text);
    });
  return {
    assignment,
    media: {
      studyTextAudioUrl: audio === 'unavailable' ? null : './fixture-tone.wav',
      pronunciationAudio: {
        itemClips,
        primaryClip: {
          id: `${mode}-primary`,
          kind: 'primary',
          text: 'Sentence',
          url: audio === 'unavailable' ? null : './fixture-tone.wav',
        },
      },
    },
  };
}
