// Disposable design data. No API clients, browser persistence or provider writes belong here.
export const tutorTimezone = 'Asia/Ho_Chi_Minh';
export const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: tutorTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

export const learners = [
  {
    id: 'alex',
    name: 'Alex Morgan',
    initials: 'AM',
    level: 'B1',
    email: 'alex@example.test',
    goal: 'Speak with more confidence in everyday conversations.',
    focus: 'Telling stories clearly, with a natural sequence of events.',
    interests: 'Travel, photography and the small details of everyday life.',
    challenge: 'Finds the right words but sometimes loses the thread of a longer story.',
    balance: 3,
  },
  {
    id: 'maria',
    name: 'Maria Petrova',
    initials: 'MP',
    level: 'B2',
    email: 'maria@example.test',
    goal: 'Explain ideas clearly in international team meetings.',
    focus: 'Giving an opinion and responding to follow-up questions.',
    interests: 'Design, architecture and working across cultures.',
    challenge: 'Wants more precise language when disagreeing politely.',
    balance: 1,
  },
  {
    id: 'daniel',
    name: 'Daniel Kim',
    initials: 'DK',
    level: 'A2',
    email: '',
    goal: 'Feel comfortable using English while travelling.',
    focus: 'Asking for help and checking understanding.',
    interests: 'Food, hiking and planning a first trip abroad.',
    challenge: 'Needs extra time to form questions in conversation.',
    balance: 0,
  },
] as const;
export type Learner = {
  id: string;
  name: string;
  initials: string;
  level: string;
  email: string;
  goal: string;
  focus: string;
  interests: string;
  challenge: string;
  balance: number;
};
export type Lesson = {
  id: string;
  learnerId: string;
  date: string;
  time: string;
  duration: number;
  state: 'Scheduled' | 'Completed' | 'No-show' | 'Canceled';
  notes: string;
  charge: boolean;
};
const nextDay = new Date(`${today}T12:00:00+07:00`);
nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const tomorrow = new Intl.DateTimeFormat('en-CA', {
  timeZone: tutorTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(nextDay);
export const initialLessons: Lesson[] = [
  {
    id: 'lesson-alex-next',
    learnerId: 'alex',
    date: tomorrow,
    time: '10:00',
    duration: 60,
    state: 'Scheduled',
    notes: 'Continue storytelling and natural follow-up questions.',
    charge: true,
  },
  {
    id: 'lesson-alex',
    learnerId: 'alex',
    date: today,
    time: '09:00',
    duration: 60,
    state: 'Completed',
    notes: 'A story about an unexpected change of plans.',
    charge: true,
  },
  {
    id: 'lesson-maria',
    learnerId: 'maria',
    date: today,
    time: '15:00',
    duration: 60,
    state: 'Scheduled',
    notes: 'Practice presenting an idea to the team.',
    charge: true,
  },
  {
    id: 'lesson-daniel',
    learnerId: 'daniel',
    date: today,
    time: '17:30',
    duration: 45,
    state: 'Scheduled',
    notes: '',
    charge: true,
  },
];
export const initialPassage =
  'Last Saturday, I planned to spend a quiet morning at home. Then a friend called with an idea: a day trip to a small town by the coast. At first, I wasn’t sure. I had a long list of things to do. But an hour later, we were on the train, watching the city disappear behind us. Sometimes the best days begin with a change of plans.';

export type StudioView =
  | 'day'
  | 'overview'
  | 'learning'
  | 'history'
  | 'schedule'
  | 'billing'
  | 'assignments'
  | 'editor'
  | 'settings';
export const studioViews: StudioView[] = [
  'day',
  'overview',
  'learning',
  'history',
  'schedule',
  'billing',
  'assignments',
  'editor',
  'settings',
];
export const studentViews: StudioView[] = [
  'overview',
  'learning',
  'history',
  'schedule',
  'billing',
];

export function displayDate(date: string, weekday = false) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tutorTimezone,
    day: 'numeric',
    month: 'long',
    ...(weekday ? ({ weekday: 'long' } as const) : {}),
  }).format(new Date(`${date}T12:00:00+07:00`));
}

// Prototype lessons use the fixed workspace clock above. Completion for homework
// is eligible only after the scheduled end, matching the current backend boundary.
export function lessonNeedsHomeworkCompletion(lesson: Lesson | undefined, now = Date.now()) {
  return (
    !!lesson &&
    lesson.state === 'Scheduled' &&
    new Date(`${lesson.date}T${lesson.time}:00+07:00`).getTime() + lesson.duration * 60_000 <= now
  );
}
