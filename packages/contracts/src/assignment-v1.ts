import { z } from 'zod';

export const ASSIGNMENT_RESPONSE_SCHEMA_NAME = 'assignment_v1';
export const ASSIGNMENT_TEMPLATE_ID = 'hw_prompt_assignment_v1.md';
export const ASSIGNMENT_TEMPLATE_CONTRACT = 'Assignment output contract: assignment_v1';

const text = z.string();
const optionalText = text.nullable();
const texts = z.array(text);
const word = z.strictObject({ text, transcription: optionalText });
const questionAnswer = z.strictObject({ prompt: text, answer: text, explanation: optionalText });
const pronunciationCommon = { target: text, focus: text, action: text, deliverable: text };
const drill = z.strictObject({
  text,
  transcription: optionalText,
  chunks: texts,
  stressedWords: texts,
});
const pronunciation = z.union([
  z.strictObject({
    ...pronunciationCommon,
    mode: z.literal('shadow_sentence'),
    words: z.array(word),
    shadowSentence: text,
  }),
  z.strictObject({
    ...pronunciationCommon,
    mode: z.literal('minimal_pair'),
    pairs: z.array(z.strictObject({ left: word, right: word })),
  }),
  z.strictObject({
    ...pronunciationCommon,
    mode: z.literal('connected_speech'),
    lines: z.array(z.strictObject({ careful: text, spoken: text })),
    naturalSentence: text,
  }),
  ...(['intonation', 'rhythm_chunking', 'sentence_stress'] as const).map((mode) =>
    z.strictObject({
      ...pronunciationCommon,
      mode: z.literal(mode),
      drills: z.array(drill),
      naturalSentence: text,
      contourCue: optionalText,
    }),
  ),
]);

/** Transient generation domain. Saved drafts remain Markdown in Slice 1. */
export const AssignmentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  metadata: z.strictObject({ title: text, student: text, level: text, topic: text }),
  mission: z.strictObject({ goal: text, keyLanguage: texts }),
  input: z.strictObject({
    kind: z.enum(['generate', 'authentic']),
    source: z.strictObject({ title: optionalText, attribution: optionalText, url: optionalText }),
    media: z.array(z.strictObject({ kind: z.enum(['audio', 'video']), url: text })),
    studyText: z.strictObject({
      type: z.enum(['monologue', 'dialogue']),
      speakers: z.array(
        z.strictObject({
          id: text,
          displayName: text,
          role: text,
          persona: optionalText,
          voiceDirection: optionalText,
          gender: z.enum(['male', 'female', 'neutral']),
          age: z
            .enum(['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'])
            .nullable(),
          accent: optionalText,
        }),
      ),
      turns: z.array(z.strictObject({ speakerId: text, text })),
    }),
    comprehension: z.array(questionAnswer),
  }),
  toolkit: z.strictObject({
    grammar: z.array(
      z.strictObject({
        name: text,
        form: optionalText,
        explanation: text,
        examples: texts,
        uses: z.array(z.strictObject({ label: text, example: text })),
        traps: z.array(z.strictObject({ original: text, improved: text, explanation: text })),
      }),
    ),
    vocabulary: z.array(z.strictObject({ expression: text, meaning: text, example: text })),
  }),
  practice: z.array(
    z.strictObject({
      title: optionalText,
      instructions: optionalText,
      items: z.array(questionAnswer),
    }),
  ),
  pronunciation: pronunciation.nullable(),
  outputTask: z.strictObject({ task: text, extension: optionalText, sampleResponse: text }),
  rationale: text,
  teacherFollowUp: z.strictObject({ warmUp: text, correctionFocus: text }),
});

export type AssignmentV1 = z.infer<typeof AssignmentV1Schema>;
export type AssignmentSpeaker = AssignmentV1['input']['studyText']['speakers'][number];
export type AssignmentPronunciation = NonNullable<AssignmentV1['pronunciation']>;

// One schema definition owns runtime admission, TypeScript and the provider projection.
const { $schema: _dialect, ...providerSchema } = z.toJSONSchema(AssignmentV1Schema);
export const ASSIGNMENT_RESPONSE_SCHEMA = {
  name: ASSIGNMENT_RESPONSE_SCHEMA_NAME,
  description: 'One complete ESL homework assignment with plain text domain fields.',
  schema: providerSchema as Record<string, unknown>,
  strict: true,
} as const;

export interface AssignmentValidationContext {
  studentName?: string;
  inputKind?: 'generate' | 'authentic';
  /** Exact supplied URLs, never model-invented links. An absent list admits none. */
  suppliedUrls?: readonly string[];
}

export function validateAssignmentV1(
  output: unknown,
  context: AssignmentValidationContext = {},
): AssignmentV1 {
  const parsed = AssignmentV1Schema.safeParse(output);
  if (!parsed.success)
    throw new Error(
      `AssignmentV1 schema validation failed: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  const assignment = parsed.data;
  const errors: string[] = [];
  function meaningful(value: unknown, path: string): void {
    if (typeof value === 'string' && !value.trim())
      errors.push(`${path} must contain meaningful text`);
    else if (Array.isArray(value))
      value.forEach((item, i) => {
        meaningful(item, `${path}[${i}]`);
      });
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, item]) => {
        meaningful(item, `${path}.${key}`);
      });
  }
  meaningful(assignment, 'assignment');
  if (context.studentName && assignment.metadata.student !== context.studentName)
    errors.push('metadata.student must match the canonical student display name');
  if (context.inputKind && assignment.input.kind !== context.inputKind)
    errors.push('input.kind does not match the supplied source type');
  const { speakers, turns, type } = assignment.input.studyText;
  const ids = new Set(speakers.map((speaker) => speaker.id));
  if (ids.size !== speakers.length) errors.push('studyText speaker IDs must be unique');
  if (type === 'monologue' ? speakers.length !== 1 : speakers.length < 2 || speakers.length > 4)
    errors.push('studyText speaker count does not match its type');
  for (const turn of turns)
    if (!ids.has(turn.speakerId)) errors.push('studyText turn references an undeclared speaker');
  for (const id of ids)
    if (!turns.some((turn) => turn.speakerId === id))
      errors.push('studyText has an unused speaker');
  // Length/count recommendations remain advisory; a real study text must exist.
  if (!turns.length) errors.push('studyText requires at least one turn or paragraph');
  for (const [label, items] of Object.entries({
    keyLanguage: assignment.mission.keyLanguage,
    grammar: assignment.toolkit.grammar,
    vocabulary: assignment.toolkit.vocabulary,
    practice: assignment.practice,
  })) {
    if (!items.length) errors.push(`${label} must not be empty`);
  }
  for (const part of assignment.practice)
    if (!part.items.length) errors.push('practice parts require question/answer pairs');
  for (const url of [
    assignment.input.source.url,
    ...assignment.input.media.map((media) => media.url),
  ]) {
    if (url === null) continue;
    try {
      const parsed = new URL(url);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        /[\s<>"'`\\]/.test(url)
      )
        throw new Error();
      if (!context.suppliedUrls?.includes(url)) throw new Error();
    } catch {
      errors.push('input URLs must be safe HTTP(S) URLs supplied in the source context');
    }
  }
  const p = assignment.pronunciation;
  if (p) {
    const items =
      p.mode === 'shadow_sentence'
        ? p.words
        : p.mode === 'minimal_pair'
          ? p.pairs
          : p.mode === 'connected_speech'
            ? p.lines
            : p.drills;
    if (!items.length) errors.push('pronunciation mode requires a nonempty payload');
    if ('drills' in p)
      for (const item of p.drills) {
        if (
          item.chunks.length &&
          item.chunks.join(' ').replace(/\s+/g, ' ').trim() !==
            item.text.replace(/\s+/g, ' ').trim()
        )
          errors.push('pronunciation chunks must reconstruct drill text');
        if (item.stressedWords.some((word) => !item.text.split(/\s+/).includes(word)))
          errors.push('pronunciation stressedWords must occur in drill text');
        if (p.mode === 'rhythm_chunking' && !item.chunks.length)
          errors.push('rhythm_chunking requires chunks');
        if (p.mode === 'sentence_stress' && !item.stressedWords.length)
          errors.push('sentence_stress requires stressedWords');
      }
  }
  if (errors.length) throw new Error(`AssignmentV1 domain validation failed: ${errors.join('; ')}`);
  return assignment;
}
