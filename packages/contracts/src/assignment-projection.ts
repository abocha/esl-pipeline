import type { Frontmatter, PronunciationFocus, StudyText } from './assignment-domain.js';
import type { AssignmentV1 } from './assignment-v1.js';

/** Keep the established voice labels stable when executing Slice 2 publications. */
export function assignmentSpeakerLabels(a: AssignmentV1): string[] {
  const { speakers, type } = a.input.studyText;
  const names = speakers.map((speaker) => speaker.displayName.trim());
  const safe =
    names.every((name) => /^[A-Za-zА-Яа-яЁё0-9 _.-]{1,32}$/.test(name)) &&
    new Set(names.map((name) => name.toLowerCase())).size === names.length;
  return speakers.map((_, i) =>
    type === 'monologue' ? 'Narrator' : safe ? names[i]! : `Speaker${i + 1}`,
  );
}

export function assignmentMetadata(a: AssignmentV1): Frontmatter {
  const labels = assignmentSpeakerLabels(a);
  return {
    ...a.metadata,
    input_type: a.input.kind,
    study_text_type: a.input.studyText.type,
    speaker_labels: labels,
    speaker_profiles: a.input.studyText.speakers.map((s, i) => ({
      id: labels[i]!,
      display_name: s.displayName,
      role: s.role,
      gender: s.gender,
      ...(s.persona === null ? {} : { persona: s.persona }),
      ...(s.voiceDirection === null ? {} : { voice_direction: s.voiceDirection }),
      ...(s.age === null ? {} : { age: s.age }),
      ...(s.accent === null ? {} : { accent: s.accent }),
    })),
  };
}

export function assignmentStudySegments(a: AssignmentV1) {
  const labels = assignmentSpeakerLabels(a);
  const byId = new Map(a.input.studyText.speakers.map((s, i) => [s.id, labels[i]!]));
  return a.input.studyText.turns.map((turn, i) => ({
    id: `segment-${i + 1}`,
    // Match the established speech speaker token without parsing authored turn text.
    speaker: byId.get(turn.speakerId)!.replaceAll('_', '').replaceAll(/\s+/g, ' ').trim(),
    text: turn.text,
  }));
}

export function assignmentStudyText(a: AssignmentV1): StudyText {
  return {
    type: a.input.studyText.type,
    lines: assignmentStudySegments(a).map((s) => `${s.speaker}: ${s.text}`),
  };
}

/** line is an item ordinal for typed inputs; legacy readers retain source line numbers. */
export function assignmentPronunciation(a: AssignmentV1): PronunciationFocus | null {
  const p = a.pronunciation;
  if (!p) return null;
  const common = {
    target: p.target,
    focus: p.focus,
    action: p.action,
    deliverable: p.deliverable,
    sectionStartLine: 0,
    issues: [],
  };
  const word = (w: { text: string; transcription: string | null }, i: number) => ({
    text: w.text,
    transcription: w.transcription ?? '',
    line: i + 1,
  });
  if (p.mode === 'shadow_sentence')
    return { ...common, mode: p.mode, shadowSentence: p.shadowSentence, words: p.words.map(word) };
  if (p.mode === 'minimal_pair')
    return {
      ...common,
      mode: p.mode,
      pairs: p.pairs.map((pair, i) => ({
        left: word(pair.left, i),
        right: word(pair.right, i),
        line: i + 1,
      })),
    };
  if (p.mode === 'connected_speech')
    return {
      ...common,
      mode: p.mode,
      naturalSentence: p.naturalSentence,
      lines: p.lines.map((line, i) => ({
        careful: line.careful,
        connected: line.spoken,
        line: i + 1,
      })),
    };
  return {
    ...common,
    mode: p.mode,
    naturalSentence: p.naturalSentence,
    ...(p.contourCue === null ? {} : { contourCue: p.contourCue }),
    drills: p.drills.map((drill, i) => ({
      text: drill.text,
      ...(drill.transcription === null ? {} : { transcription: drill.transcription }),
      line: i + 1,
    })),
  };
}
