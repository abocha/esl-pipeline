import type { AssignmentPronunciation, AssignmentV1 } from '@esl-pipeline/contracts';

import grammar from '../../contracts/tests/assignment-grammar-fixture.json';
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

/** Synthetic ESL-33 visual regression fixture; uses only the existing local test tone. */
export function createPolishFixture(): LearnerHandoutProps {
  const props = createFixture('shadow_sentence', 'available');
  const a = props.assignment;
  a.metadata.icon = '🏝️';
  a.metadata.title = 'Explain an Island Quest';
  a.metadata.student = 'Demo learner';
  a.metadata.instructionLanguage = 'en';
  a.metadata.topic = 'Future Conditions and Time Clauses';
  a.mission = {
    goal: "Explain a player's next steps in an island-building game, including what depends on a condition and what happens at a particular time.",
    keyLanguage: [
      "If I find enough metal, I'll finish the workshop.",
      'Before you leave, check your tools.',
      'You cannot buy tools until the workshop opens.',
    ],
  };
  a.input.source = {
    title: 'The Workshop Quest',
    attribution: 'Synthetic local demonstration dialogue.',
    url: null,
  };
  a.input.media = [];
  a.input.studyText.speakers[0]!.displayName = 'Leo';
  a.input.studyText.turns = [
    {
      speakerId: a.input.studyText.speakers[0]!.id,
      text: "I need more metal to finish the workshop. Before I leave, I'll check my tools and make space in my bag.",
    },
    {
      speakerId: a.input.studyText.speakers[0]!.id,
      text: "If I find enough metal, I'll finish the workshop. I cannot buy tools until it opens. As soon as it opens, I'll buy a better shovel.",
    },
  ];
  a.input.comprehension = [
    {
      prompt: 'What does Leo need, and what should he do before leaving?',
      answer: 'He needs more metal. He should check his tools and make space in his bag.',
      explanation: null,
    },
    {
      prompt: 'When can Leo buy a better shovel?',
      answer: 'He can buy one as soon as the workshop opens.',
      explanation: null,
    },
  ];
  a.toolkit.grammar = structuredClone(grammar.toolkit.grammar);
  const g = a.toolkit.grammar[0]!;
  if ('formBlocks' in g) {
    g.name = 'Future conditions and time clauses';
    g.explanation =
      'Use present simple after `if`, `when`, `before` and `until` for these future situations. Use `will + base verb` for an expected future result, or `can + base verb` for an available option.';
    g.formBlocks = [
      {
        label: 'Condition and result',
        pattern: 'if + subject + present simple, subject + will / can + base verb',
        examples: ["If I find more metal, I'll finish the workshop."],
      },
      {
        label: 'Preparation and waiting',
        pattern:
          'before + subject + present simple, imperative; subject + cannot + base verb + until + subject + present simple',
        examples: [
          'Before you leave, check your tools.',
          'You cannot buy tools until the workshop opens.',
        ],
      },
      {
        label: 'Authored formula chunks',
        pattern:
          '`when / after / as soon as + subject + present simple`, `subject + will + base verb`',
        examples: ["As soon as the workshop opens, I'll buy a better shovel."],
      },
    ];
    g.comparisons = [
      {
        label: 'An uncertain condition or an expected event?',
        alternatives: [
          {
            label: 'If',
            example: "If Leo finds enough metal, he'll finish the workshop.",
            explanation: 'Choose `if` because finding enough metal is not certain.',
          },
          {
            label: 'When',
            example: "When Leo returns, he'll finish the workshop.",
            explanation: 'Choose `when` when the return is expected.',
          },
        ],
      },
    ];
    g.examples = [];
    g.uses = [];
    g.traps = [
      {
        original: 'If he will find metal, he will builds the workshop.',
        improved: 'If he finds metal, he will build the workshop.',
        explanation: 'Use `present simple` in this future condition and a `base verb` after will.',
      },
    ];
  }
  a.toolkit.vocabulary = [
    {
      expression: 'take something with you',
      meaning: 'Carry something to the place you are going.',
      example: 'Take a shovel and a ladder with you.',
    },
    {
      expression: 'be worth doing',
      meaning:
        'Be useful enough to justify the effort or inconvenience. Use an `-ing` form after `worth`.',
      example: "It's worth taking the ladder.",
    },
    {
      expression: 'keep something in storage',
      meaning: 'Save something in a place where you can use it later.',
      example: 'Keep extra metal in storage.',
    },
  ];
  a.practice = [
    {
      title: 'Complete the quest rules',
      instructions: 'Complete each gap with the correct form of the supplied verb.',
      items: [
        {
          prompt:
            'The gate might be locked tomorrow. If the gate ___ (`be`) locked, Leo ___ (`not enter`) the cave.',
          answer: "If the gate is locked, Leo won't enter the cave.",
          explanation: 'Use `present simple` in this future condition.',
        },
        {
          prompt:
            'Leo plans to leave when the storm ends. As soon as the storm ___ (`end`), he ___ (`sail`) home.',
          answer: 'As soon as the storm ends, he will sail home.',
          explanation: null,
        },
      ],
    },
    {
      title: 'Repair and explain',
      instructions: 'Find the mistake and rewrite the sentence.',
      items: [
        {
          prompt: 'Leo cannot buy tools until the workshop will open.',
          answer: 'Leo cannot buy tools until the workshop opens.',
          explanation: 'This future time clause uses `present simple`.',
        },
      ],
    },
  ];
  if (a.pronunciation?.mode === 'shadow_sentence') {
    Object.assign(a.pronunciation, {
      target: 'museum',
      focus: 'Stress the second syllable: mu-SE-um. Keep the final syllable light.',
      action: 'Say the word slowly three times, then say the complete sentence twice.',
      words: [{ text: 'museum', transcription: '/mjuˈziːəm/' }],
      shadowSentence: 'If you find a fossil during your trip, take it to the museum.',
    });
    props.media!.pronunciationAudio!.itemClips = [
      {
        id: 'polish-museum',
        itemIndex: 0,
        kind: 'word_item',
        text: 'museum',
        label: 'Word',
        url: './fixture-tone.wav',
      },
    ];
  }
  if ('learnerRationale' in a)
    a.learnerRationale =
      'This mission helps you turn future conditions and time clauses into useful game advice.';
  if ('preparation' in a.outputTask) {
    Object.assign(a.outputTask, {
      task: "Explain Leo's workshop quest so a listener understands his problem, preparation, and next steps.",
      preparation: [
        'Read the dialogue again.',
        'Write a few keywords, then try your explanation without reading the dialogue.',
      ],
      requirements: [
        'Explain what Leo needs.',
        'Describe what happens before leaving and after finding enough metal.',
        'Explain when he can buy new tools.',
      ],
      delivery: 'Speak for about a minute. You can repeat your explanation once if you wish.',
      selfCheck: [
        'Can a listener follow the steps?',
        'Check your condition and time clauses, then your result clauses.',
      ],
      extension: null,
      sampleResponse:
        "Leo needs more metal to finish the workshop. Before he leaves, he'll check his tools and make space in his bag. If he finds enough metal, he'll finish the workshop. He cannot buy tools until it opens. As soon as it opens, he'll buy a better shovel.",
    });
  }
  return props;
}
