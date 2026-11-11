import { initialPassage, type Learner, learners } from './fixtures';

export type Workbook = {
  title: string;
  passage: string;
  questions: { id: string; prompt: string; answer: string }[];
  words: { id: string; term: string; meaning: string }[];
  practice: string;
  teacherNotes: string;
};
export type StudioAssignment = {
  id: string;
  learnerId: string;
  lessonId: string | null;
  sourceId: string;
  source: string;
  homework: boolean;
  context: string;
  material: 'generated' | 'authentic';
  authentic: string;
  guidance: string;
  unlocked: number;
  status: 'draft' | 'published' | 'transcript';
  content: Workbook;
};
export type AssignmentSlot = { saved: StudioAssignment; draft: StudioAssignment };

export function sampleWorkbook(learner: Learner): Workbook {
  const alex = learner.id === 'alex';
  return {
    title: alex
      ? 'A change of plans'
      : learner.id === 'maria'
        ? 'An idea worth sharing'
        : 'Finding the right way',
    passage: alex
      ? initialPassage
      : learner.id === 'maria'
        ? 'At the team meeting, Maya suggested a different approach. Instead of starting with a long presentation, she asked everyone to share one thing they wanted to improve. At first, the room was quiet. Then one colleague described a problem, and another offered a solution. By the end of the meeting, the team had agreed on a small experiment they could try together.'
        : 'Sam is visiting a new city. He wants to find a small café near the station. He asks a woman for help. “Excuse me, is there a café near here?” She smiles and points to the next street. “Turn left at the corner. It is next to the bookshop.” Sam repeats the directions to check. Then he thanks her and walks to the café.',
    questions: [
      {
        id: crypto.randomUUID(),
        prompt: alex
          ? 'Why wasn’t the narrator sure about the trip?'
          : learner.id === 'maria'
            ? 'How did Maya help everyone join the discussion?'
            : 'How does Sam check the directions?',
        answer: alex
          ? 'They had planned to stay at home and had a long list of things to do.'
          : learner.id === 'maria'
            ? 'She asked each person to share one thing they wanted to improve.'
            : 'He repeats the directions.',
      },
    ],
    words: [
      {
        id: crypto.randomUUID(),
        term: alex ? 'A change of plans' : learner.id === 'maria' ? 'An approach' : 'At the corner',
        meaning: alex
          ? 'Deciding to do something different from your original plan.'
          : learner.id === 'maria'
            ? 'A way of thinking about or doing something.'
            : 'At the place where two streets meet.',
      },
    ],
    practice: alex
      ? 'Tell your tutor about a time you changed your plans. What happened first? What did you decide to do? How did the day turn out?'
      : learner.id === 'maria'
        ? 'Suggest one change to a team routine. Explain why it could help, and respond to a follow-up question.'
        : 'Ask your tutor for directions to a place you want to visit. Repeat the directions to check.',
    teacherNotes: '',
  };
}

export function newAssignment(learner: Learner, lessonId: string | null = null): StudioAssignment {
  return {
    id: crypto.randomUUID(),
    learnerId: learner.id,
    lessonId,
    sourceId: crypto.randomUUID(),
    source: '',
    homework: true,
    context: learner.goal,
    material: 'generated',
    authentic: '',
    guidance: learner.focus,
    unlocked: 1,
    status: 'draft',
    content: {
      title: 'Untitled assignment',
      passage: '',
      questions: [],
      words: [],
      practice: '',
      teacherNotes: '',
    },
  };
}

const alexDraft = {
  ...newAssignment(learners[0], 'lesson-alex'),
  id: 'assignment-alex',
  sourceId: 'source-alex-lesson',
  source: 'We talked about a spontaneous trip and how a change of plans can lead to a good day.',
  unlocked: 4,
  content: sampleWorkbook(learners[0]),
};
const mariaDraft = {
  ...newAssignment(learners[1]),
  id: 'assignment-maria',
  sourceId: 'source-maria-notes',
  source:
    'Practice a short contribution to a team meeting, then respond to a colleague’s question.',
  unlocked: 3,
};

export function initialAssignments(): Record<string, AssignmentSlot> {
  const danielDraft = {
    ...newAssignment(learners[2]),
    id: 'assignment-daniel',
    sourceId: 'source-daniel-first',
    source:
      'Tutor: Ask me how to get to the station. Daniel: How I get to the station? Tutor: Try “How do I get to the station?” Daniel: How do I get to the station? Tutor: Good. Repeat the directions to check you understood.',
    unlocked: 2,
    content: { ...newAssignment(learners[2]).content, title: 'Finding the station' },
  };
  return Object.fromEntries(
    [alexDraft, mariaDraft, danielDraft].map((assignment) => [
      assignment.id,
      { saved: assignment, draft: structuredClone(assignment) },
    ]),
  );
}

export function workbookError(content: Workbook): string | null {
  if (!content.title.trim() || !content.passage.trim())
    return 'Add a title and study text before saving.';
  if (content.questions.some((item) => !item.prompt.trim() || !item.answer.trim()))
    return 'Each comprehension question needs a prompt and model answer.';
  if (content.words.some((item) => !item.term.trim() || !item.meaning.trim()))
    return 'Each vocabulary entry needs a word or phrase and a meaning.';
  return null;
}

export function handoutHtml(content: Workbook): string {
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.title)}</title><style>body{max-width:700px;margin:50px auto;padding:0 24px;color:#263744;font:17px/1.8 Georgia,serif}h1,h2,h3,summary{font-family:system-ui,sans-serif}section{margin-top:32px}p{white-space:pre-wrap}summary{cursor:pointer;color:#285982}dt{font-weight:bold}dd{margin:0 0 20px}details{margin:10px 0 24px}</style><h1>${escapeHtml(content.title)}</h1><section><h2>Study text</h2><p>${escapeHtml(content.passage)}</p></section><section><h2>Comprehension</h2>${content.questions.map((item) => `<p>${escapeHtml(item.prompt)}</p><details><summary>Show model answer</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</section><section><h2>Useful language</h2><dl>${content.words.map((item) => `<dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.meaning)}</dd>`).join('')}</dl></section><section><h2>Your turn</h2><p>${escapeHtml(content.practice)}</p></section></html>`;
}
