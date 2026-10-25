import type { AssignmentPronunciation, FreshAssignmentV1 } from '@esl-pipeline/contracts';

/** Fictional current-format material for focused editor/browser acceptance; no learner records. */
export function editorFixture(): FreshAssignmentV1 {
  return {
    schemaVersion: 1,
    metadata: {
      title: 'Clear plans for the weekend',
      icon: '🧭',
      student: 'Alex',
      level: 'B1',
      topic: 'Making plans',
      instructionLanguage: 'en',
    },
    mission: {
      goal: 'Explain a plan and ask a useful follow-up question.',
      keyLanguage: ['I am `going to`…', 'What about…?'],
    },
    input: {
      kind: 'generate',
      source: { title: null, attribution: null, url: null },
      media: [],
      studyText: {
        type: 'dialogue',
        speakers: [
          {
            id: 'alex',
            displayName: 'Alex',
            role: 'Friend',
            persona: 'Thoughtful',
            voiceDirection: 'Relaxed',
            gender: 'neutral',
            age: 'adult',
            accent: null,
          },
          {
            id: 'jo',
            displayName: 'Jo',
            role: 'Friend',
            persona: null,
            voiceDirection: null,
            gender: 'female',
            age: null,
            accent: null,
          },
        ],
        turns: [
          { speakerId: 'alex', text: 'I am `going to` visit the park on Saturday.' },
          { speakerId: 'jo', text: 'What are you going to do if it rains?' },
          { speakerId: 'alex', text: 'We can visit the museum instead.' },
        ],
      },
      comprehension: [
        { prompt: 'Where does Alex plan to go?', answer: 'To the park.', explanation: null },
      ],
    },
    toolkit: {
      grammar: [
        {
          name: 'Plans and decisions',
          explanation: 'Use going to for an existing plan.',
          formBlocks: [
            {
              label: 'An existing plan',
              pattern: 'subject + am/is/are + `going to` + verb',
              examples: ['I am going to visit the park.'],
            },
          ],
          comparisons: [
            {
              label: 'Plan or immediate decision?',
              alternatives: [
                {
                  label: 'Plan',
                  example: 'I am going to call Jo.',
                  explanation: 'I decided earlier.',
                },
                {
                  label: 'Decision now',
                  example: 'I will call Jo now.',
                  explanation: 'I decide as I speak.',
                },
              ],
            },
          ],
          examples: ['They are going to meet at ten.'],
          uses: [{ label: 'Intention', example: 'We are going to take a picnic.' }],
          traps: [
            {
              original: 'She going to walk.',
              improved: 'She is going to walk.',
              explanation: 'Include the correct form of be.',
            },
          ],
        },
      ],
      vocabulary: [
        {
          expression: 'instead',
          meaning: 'As an alternative.',
          example: 'We can stay home instead.',
        },
      ],
    },
    practice: [
      {
        title: 'Complete the plans',
        instructions: 'Complete each sentence with the correct form of be going to.',
        items: [
          { prompt: 'I ___ visit the park.', answer: 'am going to', explanation: 'Use am with I.' },
          { prompt: 'She ___ take a picnic.', answer: 'is going to', explanation: null },
          { prompt: 'They ___ meet at ten.', answer: 'are going to', explanation: null },
        ],
      },
      {
        title: 'Make it natural',
        instructions: 'Respond to each situation. Choose your own words.',
        items: [
          {
            prompt: 'Your friend asks about Saturday. Tell them your plan.',
            answer: 'I am going to visit the park.',
            explanation: 'Other sensible plans are possible.',
          },
          {
            prompt: 'Your friend may be late. Suggest an alternative.',
            answer: 'We can meet at the museum instead.',
            explanation: null,
          },
        ],
      },
    ],
    pronunciation: pronunciationFixture('shadow_sentence'),
    outputTask: {
      task: 'Tell a friend about your weekend plan.',
      preparation: ['Choose a place and an alternative.'],
      requirements: ['Give a reason and ask one follow-up question.'],
      delivery: 'Speak for about a minute.',
      selfCheck: ['Did I include be before going to?'],
      extension: 'Respond to your friend’s suggestion.',
      sampleResponse: 'I am going to visit the park. What about you?',
    },
    learnerRationale: 'You can make plans clear and respond when circumstances change.',
    teacherRationale: 'PRIVATE_TEACHER_RATIONALE: contrast planned intentions with decisions now.',
    teacherFollowUp: {
      warmUp: 'PRIVATE_WARM_UP: ask about a changed plan.',
      correctionFocus: 'PRIVATE_CORRECTION: listen for missing be.',
    },
  };
}

export function pronunciationFixture(
  mode: AssignmentPronunciation['mode'],
): AssignmentPronunciation {
  const common = {
    target: 'going to',
    focus: 'Link the words naturally.',
    action: 'Listen and repeat.',
    deliverable: 'Say one clear plan.',
  };
  if (mode === 'shadow_sentence')
    return {
      ...common,
      mode,
      words: [{ text: 'going', transcription: '/ˈɡəʊɪŋ/' }],
      shadowSentence: 'I am going to visit the park.',
    };
  if (mode === 'minimal_pair')
    return {
      ...common,
      mode,
      pairs: [
        {
          left: { text: 'ship', transcription: '/ʃɪp/' },
          right: { text: 'sheep', transcription: '/ʃiːp/' },
        },
      ],
    };
  if (mode === 'connected_speech')
    return {
      ...common,
      mode,
      lines: [{ careful: 'going to', spoken: 'gonna' }],
      naturalSentence: 'I am going to visit the park.',
    };
  return {
    ...common,
    mode,
    naturalSentence: 'I am going to visit the park.',
    contourCue: null,
    drills: [
      {
        text: 'I am going to visit the park.',
        transcription: null,
        chunks: ['I am going to', 'visit the park.'],
        stressedWords: ['park'],
      },
    ],
  };
}
