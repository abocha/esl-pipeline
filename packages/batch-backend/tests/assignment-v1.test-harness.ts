import {
  ASSIGNMENT_TEMPLATE_CONTRACT,
  ASSIGNMENT_TEMPLATE_ID,
  type AssignmentV1,
} from '@esl-pipeline/contracts';

import { stitchPromptEnvelope } from '../src/application/prompt-assembly.js';

export function assignmentFixture(): AssignmentV1 {
  return {
    schemaVersion: 1,
    metadata: {
      title: 'Homework Assignment: Clear demos',
      student: 'Eval Persona One',
      level: 'B1',
      topic: 'Product demonstrations',
    },
    mission: { goal: 'Explain a product clearly.', keyLanguage: ['first', 'then', 'finally'] },
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
            role: 'Presenter',
            persona: null,
            voiceDirection: null,
            gender: 'neutral',
            age: 'adult',
            accent: null,
          },
          {
            id: 'jo',
            displayName: 'Jo',
            role: 'Colleague',
            persona: 'Curious',
            voiceDirection: null,
            gender: 'female',
            age: null,
            accent: 'british',
          },
        ],
        turns: [
          { speakerId: 'alex', text: 'First, open the app.' },
          { speakerId: 'jo', text: 'What happens next?' },
          { speakerId: 'alex', text: 'Then, select a feature.' },
          { speakerId: 'jo', text: 'Can I save it?' },
          { speakerId: 'alex', text: 'Finally, save your work.' },
        ],
      },
      comprehension: [
        { prompt: 'What happens first?', answer: 'Open the app.', explanation: null },
        {
          prompt: 'What happens finally?',
          answer: 'Save your work.',
          explanation: 'The last step.',
        },
      ],
    },
    toolkit: {
      grammar: [
        {
          name: 'Sequencing',
          form: 'First + imperative',
          explanation: 'Guide the listener through steps.',
          examples: ['First, open the app.'],
          uses: [{ label: 'Beginning', example: 'First, open the app.' }],
          traps: [
            {
              original: 'Firstly firstly',
              improved: 'First, then',
              explanation: 'Vary signposting.',
            },
          ],
        },
      ],
      vocabulary: [
        {
          expression: 'select a feature',
          meaning: 'choose a function',
          example: 'Then, select a feature.',
        },
      ],
    },
    practice: [
      {
        title: 'Retrieve',
        instructions: 'Complete the steps.',
        items: Array.from({ length: 8 }, (_, i) => ({
          prompt: `Step ${i + 1}: give a signpost.`,
          answer: i === 0 ? 'First' : 'Then',
          explanation: null,
        })),
      },
      {
        title: null,
        instructions: null,
        items: [
          {
            prompt: 'Finish the demo.',
            answer: 'Finally, save your work.',
            explanation: 'Signal the final step.',
          },
        ],
      },
    ],
    pronunciation: {
      mode: 'shadow_sentence',
      target: 'Clear signposting',
      focus: 'Stress the first word',
      action: 'Repeat',
      deliverable: 'Optional practice recording',
      words: [
        { text: 'first', transcription: 'fɜːst' },
        { text: 'then', transcription: 'ðen' },
        { text: 'finally', transcription: 'ˈfaɪnəli' },
      ],
      shadowSentence: 'First, open the app.',
    },
    outputTask: {
      task: 'Explain a familiar app.',
      extension: null,
      sampleResponse: 'First, open it. Then, choose a feature. Finally, save your work.',
    },
    rationale: 'Signposting makes your demo easier to follow.',
    teacherFollowUp: {
      warmUp: 'Give a short demonstration.',
      correctionFocus: 'Natural signposting.',
    },
  };
}

export function promptPackageFixture() {
  const requestEnvelope = stitchPromptEnvelope({
    template: `${ASSIGNMENT_TEMPLATE_CONTRACT}\nCreate a useful homework assignment.`,
    canonicalStudentName: 'Eval Persona One',
    profile: 'B1',
    studentMemorySnapshot: '',
    recentLessonMemory: '',
    recentHomeworkMemory: '',
    unresolvedIssues: '',
    transcript: 'First, then, finally.',
    notes: 'Input Type: generate',
  });
  return {
    id: 'prompt-1',
    text: 'PROMPT',
    requestEnvelope,
    templateSnapshot: { resolvedTemplateId: ASSIGNMENT_TEMPLATE_ID },
  };
}

export function openAiAssignmentPayload(text: string = JSON.stringify(assignmentFixture())) {
  return {
    id: 'resp-assignment',
    model: 'gpt-6.1-sol',
    status: 'completed',
    usage: { input_tokens: 12, output_tokens: 24, total_tokens: 36 },
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
  };
}
