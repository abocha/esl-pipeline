import { type Learner, today } from './fixtures';

export type ProfileData = {
  level: string;
  goal: string;
  contexts: string;
  interests: string;
  strengths: string;
  challenge: string;
  preferences: string;
  constraints: string;
  focus: string;
};
export function seedProfile(learner: Learner): ProfileData {
  const experienced = learner.id !== 'daniel';
  const workplace = learner.id === 'maria';
  return {
    level: learner.level,
    goal: experienced
      ? [
          learner.goal,
          workplace
            ? 'Give concise project updates and explain a design decision.\nHandle questions and polite disagreement without relying on a complete script.'
            : 'Tell a clear story about a trip or an everyday problem.\nAsk for clarification and keep a conversation going when a word is missing.',
        ].join('\n')
      : learner.goal,
    focus: learner.id === 'daniel' ? '' : learner.focus,
    challenge:
      learner.id === 'daniel'
        ? ''
        : `${learner.challenge}\n${
            workplace
              ? 'Article choice and fixed prepositions in longer explanations.\nRetrieving a polite alternative under time pressure.\nAnswering an unexpected follow-up without a complete script.\nSeparating an observation, a recommendation and its reason.\nKeeping tense consistent when discussing a past decision.\nNatural stress in longer words and phrases.\nChecking understanding without repeating the whole explanation.'
              : 'Choosing past forms while keeping the story moving.\nDistinguishing the setting from the sequence of events.\nUsing a clarification when vocabulary is missing.\nRemembering articles and common prepositions in spontaneous speech.'
          }`,
    contexts: workplace
      ? 'Weekly team meetings and project reviews.\nExplaining design choices to colleagues.\nAsking for clarification in international calls.\nInformal conversation before and after a meeting.'
      : 'Travel arrangements and everyday conversations.\nDescribing places, people and changes of plan.\nAsking for help and checking directions.',
    interests: experienced
      ? `${learner.interests}\n${workplace ? 'Public spaces, neighbourhood design and exhibitions.\nPodcasts about creative work.\nComparing how teams work in different places.' : 'Planning weekends and short trips.\nPhoto stories and describing a favourite place.\nFilms, local food and small practical problems.'}`
      : learner.interests,
    strengths: experienced
      ? workplace
        ? 'Explains familiar work clearly when there is time to prepare.\nUnderstands the main argument in authentic interviews.\nAsks precise questions about tone and word choice.\nUses examples to make an abstract idea easier to follow.\nSelf-corrects after a brief prompt.\nSustains a discussion when the topic is familiar.'
        : 'Keeps a conversation going with familiar vocabulary.\nUnderstands the main idea of a short authentic text.\nUses concrete examples to explain a point.\nNotices tense changes when rereading.\nResponds well to a short speaking plan.'
      : '',
    preferences: experienced
      ? 'Short preparation followed by meaningful speaking.\nA keyword plan rather than a complete written script.\nDirect, limited feedback after the first attempt.\nAuthentic material with a transcript available.\nRecycle useful language in a different situation.\nKeep homework in a few clearly separated steps.'
      : 'Use short questions and a model before independent practice.',
    constraints: experienced
      ? 'Homework needs to work on a phone.\nOffer an aloud-practice option when recording is inconvenient.\nKeep the first task manageable on a busy workday.\nCheck whether earlier plans and circumstances are still current.'
      : 'Keep written instructions brief and use familiar vocabulary.',
  };
}
export const profileGroups: { title: string; keys: (keyof ProfileData)[] }[] = [
  { title: 'Goals & communication', keys: ['contexts', 'interests'] },
  { title: 'Strengths & challenges', keys: ['strengths', 'challenge'] },
  { title: 'Study preferences & constraints', keys: ['preferences', 'constraints'] },
  { title: 'Teacher notes', keys: ['focus'] },
];
export type MemoryNotes = {
  lessons: MemoryNote[];
  homework: MemoryNote[];
  threads: { title: string; note: string }[];
};
type MemoryNote = {
  title: string;
  summary: string;
  generatedAt?: string;
  assignmentId?: string;
  sourceId?: string;
};
export type LearningMemory = {
  status: 'idle' | 'updating' | 'ready' | 'failed';
  initial: boolean;
  sourceId: string | null;
  assignmentId: string | null;
  processingIssue?: string;
  latest: { summary: string; updatedAt: string; sourceId: string; assignmentId: string } | null;
};

// Fictional records with the same reading density as the live Learning surface.
// Earlier memories have no assignment link in this prototype; only exact saved sources do.
export const memoryNotes: Record<string, MemoryNotes> = {
  alex: {
    lessons: [
      {
        title: 'A change of plans',
        generatedAt: `${today}T09:30:00+07:00`,
        assignmentId: 'assignment-alex',
        sourceId: 'source-alex-lesson',
        summary: 'Discussed a spontaneous trip and how a change of plans can lead to a good day.',
      },
      {
        title: 'Telling a photo story',
        generatedAt: '2026-10-22T10:20:00+07:00',
        summary:
          'Used a photograph to introduce a place, explain what happened and describe a reaction. A three-part plan helped the second attempt; independent use needs another check.',
      },
      {
        title: 'An everyday problem',
        generatedAt: '2026-10-15T10:20:00+07:00',
        summary:
          'Explained a delayed delivery, clarified what was missing and practised a polite request. Repeated practice helped with word retrieval.',
      },
      {
        title: 'Choosing a weekend plan',
        generatedAt: '2026-10-08T10:20:00+07:00',
        summary:
          'Compared two possible trips and gave reasons for a preference. Worked on sequencing and follow-up questions.',
      },
      {
        title: 'A place worth visiting',
        generatedAt: '2026-10-01T10:20:00+07:00',
        summary:
          'Read a short travel article, clarified unfamiliar phrases and gave a personal recommendation using selected language.',
      },
    ],
    homework: [
      {
        title: 'A different ending',
        generatedAt: '2026-10-23T11:10:00+07:00',
        summary:
          'Retell a short trip with one change of plan. Use a keyword plan and separate the setting, problem and outcome.',
      },
      {
        title: 'Explain a practical problem',
        generatedAt: '2026-10-16T11:10:00+07:00',
        summary:
          'Give a short spoken update about an everyday problem. Say what happened and what should happen next.',
      },
      {
        title: 'Describe a photograph',
        generatedAt: '2026-10-09T11:10:00+07:00',
        summary:
          'Choose a photograph and explain why the place matters. Aloud practice is sufficient; submission is optional.',
      },
    ],
    threads: [
      {
        title: 'Independent narrative sequence',
        note: 'A planned retelling is clearer. Check whether the sequence holds without a complete model.',
      },
      {
        title: 'Past tense retrieval',
        note: 'Forms improve after correction; spontaneous use in a new story remains unconfirmed.',
      },
      {
        title: 'Keeping the conversation going',
        note: 'Practise a clarification or follow-up when a word is missing.',
      },
      {
        title: 'Homework outcome',
        note: 'An assigned task is not evidence of completion or independent performance.',
      },
    ],
  },
  maria: {
    lessons: [
      {
        title: 'Explaining a design choice',
        generatedAt: '2026-10-23T16:20:00+07:00',
        summary:
          'Compared two layouts and explained the trade-off. A brief plan supported a clear first contribution, while unexpected follow-up questions needed more time.',
      },
      {
        title: 'Disagreeing constructively',
        generatedAt: '2026-10-16T16:20:00+07:00',
        summary:
          'Read a short exchange between colleagues and rehearsed a polite alternative. The language was available during guided practice; independent transfer has not been checked.',
      },
      {
        title: 'A concise project update',
        generatedAt: '2026-10-09T16:20:00+07:00',
        summary:
          'Separated progress, a problem and the next step. Practised shorter sentences and clarified which details the listener needed first.',
      },
      {
        title: 'Clarifying an unfamiliar request',
        generatedAt: '2026-10-02T16:20:00+07:00',
        summary:
          'Used paraphrase to check the meaning of a request. Worked on question formation and explaining what was still unclear.',
      },
      {
        title: 'A different working culture',
        generatedAt: '2026-09-25T16:20:00+07:00',
        summary:
          'Discussed an interview about creative teams. Followed the main argument and compared it with familiar work situations.',
      },
    ],
    homework: [
      {
        title: 'A short team contribution',
        generatedAt: `${today}T09:30:00+07:00`,
        assignmentId: 'assignment-maria',
        sourceId: 'source-maria-notes',
        summary:
          'Prepare one point for a meeting and practise responding to a colleague’s question. This is preparation guidance; no completion evidence is recorded.',
      },
      {
        title: 'Recommend an alternative',
        generatedAt: '2026-10-17T16:20:00+07:00',
        summary:
          'Explain one concern, suggest an alternative and give a reason. Use keywords and record only if convenient.',
      },
      {
        title: 'An update in three parts',
        generatedAt: '2026-10-10T16:20:00+07:00',
        summary:
          'Practise a brief spoken update with progress, a problem and a next step. Check that the listener can identify the request.',
      },
    ],
    threads: [
      {
        title: 'Responding beyond the prepared point',
        note: 'Prepared contributions are clear. Independent follow-up responses need another observation.',
      },
      {
        title: 'Polite disagreement',
        note: 'Guided phrases are available; check tone and retrieval in a fresh situation.',
      },
      {
        title: 'Concise explanations',
        note: 'A short plan helps. Avoid treating a rehearsed answer as spontaneous fluency.',
      },
      {
        title: 'Articles and prepositions',
        note: 'Recurring errors reappear in longer contributions despite successful focused practice.',
      },
      {
        title: 'Speaking from keywords',
        note: 'Reduce support gradually rather than removing the plan all at once.',
      },
      {
        title: 'Homework completion',
        note: 'The latest assignment has no recorded performance outcome.',
      },
    ],
  },
};
// Hand-authored memory examples supported by the corresponding fictional source.
export const learningMemoryNotes: Record<string, string> = {
  'source-alex-lesson':
    'Alex keeps a conversation going and uses concrete examples well. Recent work centres on a clear narrative sequence, past-tense retrieval and asking for clarification. A short plan improves a retelling; independent use in a new story still needs checking. The latest conversation covered a spontaneous trip and a change of plans.',
  'source-maria-notes':
    'Maria explains familiar work clearly after brief preparation. Current priorities are unexpected follow-up questions, concise explanations and polite disagreement. Guided practice is more secure than independent transfer. The latest preparation calls for a team-meeting contribution and a response to a colleague; no completion or lesson outcome is recorded for that task.',
  'source-daniel-first':
    'Daniel corrected “How I get…” to “How do I get…” after a model. The tutor asked him to repeat directions to check understanding.',
};

export const profileFields: { key: keyof ProfileData; label: string; prompt: string }[] = [
  { key: 'level', label: 'Current level', prompt: 'What level is currently recorded?' },
  {
    key: 'goal',
    label: 'Learning goals',
    prompt: 'What would this learner like to be able to do?',
  },
  {
    key: 'contexts',
    label: 'Communication contexts',
    prompt: 'Where does this learner use English?',
  },
  { key: 'interests', label: 'Interests & useful themes', prompt: 'What makes the work relevant?' },
  { key: 'strengths', label: 'Stable strengths', prompt: 'What can you build on?' },
  {
    key: 'challenge',
    label: 'Persistent challenges',
    prompt: 'Where is recurring support useful?',
  },
  {
    key: 'preferences',
    label: 'Study preferences',
    prompt: 'How does this learner work best?',
  },
  {
    key: 'constraints',
    label: 'Durable constraints',
    prompt: 'What should shape tasks and format?',
  },
  { key: 'focus', label: 'Teacher notes', prompt: 'What durable teaching context is useful?' },
];
