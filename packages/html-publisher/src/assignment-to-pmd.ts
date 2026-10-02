import type { AssignmentPronunciation, AssignmentV1 } from '@esl-pipeline/contracts';

/** Plain text cannot introduce a heading, directive, link, table cell or HTML node. */
function prose(value: string): string {
  const escapeCharacter = (char: string) => `&#${char.codePointAt(0)};`;
  return value
    .trim()
    .replace(/[\s\u0085]+/g, ' ')
    .replace(/[&<>[\]`*_\\|#]/g, escapeCharacter)
    .replace(/^[-+=:]+(?=\s|$)/, (marker) => [...marker].map(escapeCharacter).join(''))
    .replace(/^(\d+)[.)](?=\s)/, '$1&#46;');
}
function field(value: string): string {
  return prose(value).replace(/[/—–→"()]/g, (char) => `&#${char.codePointAt(0)};`);
}
const yaml = (value: unknown): string =>
  JSON.stringify(value).replace(
    /[\u0085\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
const numbered = (values: readonly string[]): string =>
  values.map((value, i) => `${i + 1}. ${value}`).join('\n');

function practiceHeading(title: string | null, index: number, count: number): string[] {
  return title === null && count === 1
    ? []
    : [`#### Part ${index + 1}${title === null ? '' : `: ${prose(title)}`}`];
}

/** The only AssignmentV1 compatibility projection. It does not own persisted truth. */
export function renderAssignmentToPmd(a: AssignmentV1): string {
  const { speakers, turns, type } = a.input.studyText;
  const names = speakers.map((speaker) => speaker.displayName.trim());
  const safeNames =
    names.every((name) => /^[A-Za-zА-Яа-яЁё0-9 _.-]{1,32}$/.test(name)) &&
    new Set(names.map((name) => name.toLowerCase())).size === names.length;
  const labels = speakers.map((_, i) =>
    type === 'monologue' ? 'Narrator' : safeNames ? names[i]! : `Speaker${i + 1}`,
  );
  const labelById = new Map(speakers.map((speaker, i) => [speaker.id, labels[i]]));
  const profiles = speakers.map((speaker, i) => ({
    id: labels[i],
    display_name: speaker.displayName,
    role: speaker.role,
    gender: speaker.gender,
    ...(speaker.persona === null ? {} : { persona: speaker.persona }),
    ...(speaker.voiceDirection === null ? {} : { voice_direction: speaker.voiceDirection }),
    ...(speaker.age === null ? {} : { age: speaker.age }),
    ...(speaker.accent === null ? {} : { accent: speaker.accent }),
  }));
  const sections = [
    [
      '---',
      ...Object.entries({
        ...a.metadata,
        input_type: a.input.kind,
        study_text_type: type,
        icon: '🎧',
        assignment_projection: 'assignment_v1',
        speaker_labels: labels,
        speaker_profiles: profiles,
      }).map(([key, value]) => `${key}: ${yaml(value)}`),
      '---',
    ].join('\n'),
    "## 1. 🎯 This Week's Mission Briefing",
    `:::callout 🎯\n**Your Goal This Week:** ${prose(a.mission.goal)}\n\n**Key Language You Will Use:** ${a.mission.keyLanguage.map(prose).join('; ')}\n:::`,
    '## 2. 🎧 Input Material: The Source',
    a.input.kind === 'authentic' ? '### 🌐 Authentic Material' : '### 🤖 Generated Material',
    ...(a.input.source.title === null ? [] : [`**Title/Source:** ${prose(a.input.source.title)}`]),
    ...(a.input.source.attribution === null ? [] : [prose(a.input.source.attribution)]),
    ...(a.input.source.url === null ? [] : [`**Source Link:** <${a.input.source.url}>`]),
    ...a.input.media.map((media) => `:::${media.kind} ${media.url}`),
    `:::study-text Transcript\n${turns.map((turn) => `${labelById.get(turn.speakerId)}: ${prose(turn.text)}`).join('\n\n')}\n:::`,
    '### 🤔 Comprehension Check',
    numbered(a.input.comprehension.map((item) => prose(item.prompt))),
    '## 3. 🛠️ Language Toolkit: Useful Language',
    '### A. 👀 Notice the Grammar',
    ...a.toolkit.grammar.map((grammar) =>
      [
        `**${prose(grammar.name)}**`,
        ...(grammar.form === null ? [] : [`**Form:** ${prose(grammar.form)}`]),
        prose(grammar.explanation),
        ...grammar.examples.map((example) => `- _${prose(example)}_`),
        ...grammar.uses.map((use) => `- **${prose(use.label)}:** ${prose(use.example)}`),
        ...grammar.traps.map(
          (trap) =>
            `- ⚠️ ${prose(trap.original)} → ${prose(trap.improved)}. ${prose(trap.explanation)}`,
        ),
      ].join('\n\n'),
    ),
    '### B. 🗣️ Useful Chunks & Vocabulary',
    [
      '| Expression | Meaning | Example |',
      '| --- | --- | --- |',
      ...a.toolkit.vocabulary.map(
        (item) => `| ${prose(item.expression)} | ${prose(item.meaning)} | ${prose(item.example)} |`,
      ),
    ].join('\n'),
    '## 4. ✍️ Practice & Pronunciation',
    '### A. 🔩 Controlled Practice',
    ...a.practice.map((part, i) =>
      [
        ...practiceHeading(part.title, i, a.practice.length),
        ...(part.instructions === null ? [] : [prose(part.instructions)]),
        numbered(part.items.map((item) => prose(item.prompt))),
      ].join('\n\n'),
    ),
    ...(a.pronunciation === null
      ? []
      : ['### B. 🎙️ Pronunciation Micro-Focus (≈1 min)', renderPronunciation(a.pronunciation)]),
    '## 5. ✅ Your Turn: Complete the Mission!',
    prose(a.outputTask.task),
    ...(a.outputTask.extension === null
      ? []
      : [`**Optional extension:** ${prose(a.outputTask.extension)}`]),
    '## 6. 🧠 Why This Mission Helps You',
    prose(a.rationale),
    '## 7. 🔑 Answer Key & Sample Mission',
    [
      ':::toggle Answer Key',
      '### Comprehension Answers',
      numbered(a.input.comprehension.map(answer)),
      '### A. Controlled Practice Answers',
      ...a.practice.map((part, i) =>
        [
          ...practiceHeading(part.title, i, a.practice.length),
          numbered(part.items.map(answer)),
        ].join('\n\n'),
      ),
      '### Sample Mission',
      prose(a.outputTask.sampleResponse),
      ':::',
    ].join('\n\n'),
    "## 8. 👨‍🏫 Teacher's Follow-up Plan",
    `:::toggle Teacher’s Follow-up Plan\n\n**Warm-up:** ${prose(a.teacherFollowUp.warmUp)}\n\n**Correction focus:** ${prose(a.teacherFollowUp.correctionFocus)}\n\n:::`,
  ];
  return `${sections.join('\n\n')}\n`;
}

function answer(item: { answer: string; explanation: string | null }): string {
  return `${prose(item.answer)}${item.explanation === null ? '' : ` — ${prose(item.explanation)}`}`;
}

function renderPronunciation(p: AssignmentPronunciation): string {
  const word = (w: { text: string; transcription: string | null }) =>
    `${field(w.text)}${w.transcription === null ? '' : ` /${field(w.transcription.replace(/^\/|\/$/g, ''))}/`}`;
  const lines = [
    `**Mode:** ${p.mode}`,
    `**Target:** ${prose(p.target)}`,
    `**Focus:** ${prose(p.focus)}`,
    `**Action:** ${prose(p.action)}`,
    `**Deliverable:** ${prose(p.deliverable)}`,
  ];
  if (p.mode === 'shadow_sentence')
    lines.push(numbered(p.words.map(word)), `**Shadow sentence:** ${field(p.shadowSentence)}`);
  else if (p.mode === 'minimal_pair')
    lines.push(numbered(p.pairs.map((pair) => `${word(pair.left)} — ${word(pair.right)}`)));
  else if (p.mode === 'connected_speech')
    lines.push(
      numbered(
        p.lines.map(
          (line) =>
            `"${field(line.careful).replaceAll('"', '&#34;')}" -> ${field(line.spoken).replaceAll('->', '&#45;&#62;')}`,
        ),
      ),
      `**Natural sentence practice:** ${field(p.naturalSentence)}`,
    );
  else {
    lines.push(
      numbered(
        p.drills.map((drill) => {
          const value =
            p.mode === 'rhythm_chunking'
              ? drill.chunks.map(field).join(' | ')
              : p.mode === 'sentence_stress'
                ? drill.text
                    .split(/\s+/)
                    .map((token) =>
                      drill.stressedWords.includes(token) ? `**${field(token)}**` : field(token),
                    )
                    .join(' ')
                : field(drill.text);
          return `${value}${drill.transcription === null ? '' : ` — /${field(drill.transcription.replace(/^\/|\/$/g, ''))}/`}`;
        }),
      ),
      `**Natural sentence practice:** ${field(p.naturalSentence)}`,
    );
    if (p.contourCue !== null) lines.push(`**Contour cue:** ${prose(p.contourCue)}`);
  }
  return lines.join('\n\n');
}
