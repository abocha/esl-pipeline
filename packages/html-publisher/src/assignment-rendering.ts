import type { AssignmentPronunciation, AssignmentV1 } from '@esl-pipeline/contracts';
import type {
  PronunciationAudioClip,
  PronunciationAudioPayload,
} from '@esl-pipeline/shared-infrastructure';

import { renderAudioFigure, renderAudioPlaceholder } from './rendering/audio.js';
import { buildBehaviorScript } from './rendering/behavior.js';
import { buildCss } from './rendering/css.js';
import { buildVideoEmbed } from './rendering/media.js';
import { type RenderOptions, resolveRenderOptions } from './rendering/options.js';
import { renderPageShell } from './rendering/page-shell.js';
import { sanitizeLinkHref, sanitizeMediaUrl } from './rendering/safety.js';
import { escapeHtml as e } from './rendering/shared.js';

export const ASSIGNMENT_HTML_RENDERER_VERSION = 2;
export interface AssignmentRenderOptions extends RenderOptions {
  studyTextAudioUrl?: string | null;
  pronunciationAudioUrl?: string | null;
  preview?: boolean;
}
const para = (text: string) => `<p>${e(text).replaceAll('\n', '<br>')}</p>`;
const field = (label: string, text: string) => `<p><strong>${e(label)}:</strong> ${e(text)}</p>`;
const list = (items: string[]) => `<ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;
const heading = (level: number, text: string, id?: string) =>
  `<h${level}${id ? ` id="${id}"` : ''}><span class="heading-text">${e(text)}</span></h${level}>`;
const disclosure = (label: string, body: string, cls = '') =>
  `<details${cls ? ` class="${cls}"` : ''}><summary>${e(label)}</summary><div class="content"><div class="content-inner">${body}</div></div></details>`;
const answer = (q: { prompt: string; answer: string; explanation: string | null }) =>
  `<div class="answer-key-item">${para(q.prompt)}${field('Answer', q.answer)}${q.explanation === null ? '' : field('Explanation', q.explanation)}</div>`;

function safeAudio(payload?: PronunciationAudioPayload | null): PronunciationAudioPayload | null {
  if (!payload) return null;
  const safe = (clip: PronunciationAudioClip) => ({
    ...clip,
    ...(clip.url ? { url: sanitizeMediaUrl(clip.url) ?? undefined } : {}),
  });
  return {
    ...payload,
    primaryClip: payload.primaryClip ? safe(payload.primaryClip) : null,
    itemClips: payload.itemClips?.map(safe) ?? [],
  };
}

function renderPronunciation(p: AssignmentPronunciation, options: AssignmentRenderOptions): string {
  const clips = options.pronunciationAudio?.itemClips ?? [];
  const controls = (index: number, kind?: string) => {
    const matches = clips.filter((c) => c.itemIndex === index && (!kind || c.kind === kind));
    return `<span class="pronunciation-word-tts">${matches
      .map((c) => {
        const safe = c.url ? sanitizeMediaUrl(c.url) : null;
        return `<button type="button" class="word-tts-button" data-pronunciation-clip="${e(c.id)}" aria-label="${e(`Play pronunciation for ${c.text}`)}"${safe ? '' : ' disabled aria-disabled="true" title="Audio clip not generated yet"'}>${e(c.label ?? 'Play')}</button>`;
      })
      .join(
        '',
      )}${!matches.length && options.preview ? '<button type="button" class="word-tts-button" disabled aria-disabled="true" title="Audio clip not generated yet">Play</button>' : ''}</span>`;
  };
  const word = (w: { text: string; transcription: string | null }, i: number, kind?: string) =>
    `<span class="pronunciation-word-main"><span class="pronunciation-word-content">${e(w.text)}</span>${controls(i, kind)}${w.transcription ? `<span class="word-tts-transcription" aria-hidden="true">${e(w.transcription)}</span>` : ''}</span>`;
  let items: string[];
  if (p.mode === 'shadow_sentence') items = p.words.map((w, i) => word(w, i));
  else if (p.mode === 'minimal_pair')
    items = p.pairs.map(
      (pair, i) =>
        `<span class="pronunciation-word-pair">${word(pair.left, i, 'pair_left')}<span> — </span>${word(pair.right, i, 'pair_right')}</span>`,
    );
  else if (p.mode === 'connected_speech')
    items = p.lines.map(
      (line, i) =>
        `<span class="pronunciation-connected-line"><span class="pronunciation-connected-text"><span class="pronunciation-connected-careful">${e(line.careful)}</span><span class="pronunciation-connected-arrow">→</span><span class="pronunciation-connected-target">${e(line.spoken)}</span></span><span class="pronunciation-line-meta">${controls(i)}</span></span>`,
    );
  else
    items = p.drills.map((d, i) => {
      const words = new Set(
        d.stressedWords.map(
          (w) =>
            w
              .normalize('NFKC')
              .toLowerCase()
              .match(/[\p{L}\p{M}\p{N}]+(?:['’‐‑-][\p{L}\p{M}\p{N}]+)*/gu)?.[0],
        ),
      );
      const text =
        p.mode === 'rhythm_chunking'
          ? d.chunks.map(e).join(' <span class="pronunciation-chunk-divider">|</span> ')
          : p.mode === 'sentence_stress'
            ? d.text
                .split(/([\p{L}\p{M}\p{N}]+(?:['’‐‑-][\p{L}\p{M}\p{N}]+)*)/gu)
                .map((w) =>
                  words.has(w.normalize('NFKC').toLowerCase()) ? `<strong>${e(w)}</strong>` : e(w),
                )
                .join('')
            : e(d.text);
      return `<span class="pronunciation-line-main"><span class="pronunciation-line-text">${text}</span><span class="pronunciation-line-meta">${controls(i)}${d.transcription ? `<span class="word-tts-transcription">${e(d.transcription)}</span>` : ''}</span></span>`;
    });
  const sentence =
    'shadowSentence' in p ? p.shadowSentence : 'naturalSentence' in p ? p.naturalSentence : null;
  const primaryUrl = options.pronunciationAudio?.primaryClip?.url ?? options.pronunciationAudioUrl;
  return `<section data-assignment-pronunciation="${p.mode}">${field('Mode', p.mode)}${field('Target', p.target)}${field('Focus', p.focus)}${field('Action', p.action)}${field('Deliverable', p.deliverable)}<ol>${items.map((item, i) => `<li class="pronunciation-word-item" data-pronunciation-item="${i}">${item}</li>`).join('')}</ol>${sentence ? `<p class="pronunciation-sentence-anchor ${p.mode === 'shadow_sentence' ? 'pronunciation-shadow-sentence' : 'pronunciation-natural-sentence'}"><strong>${p.mode === 'shadow_sentence' ? 'Shadow sentence' : 'Natural sentence practice'}:</strong> ${e(sentence)}</p>${primaryUrl ? renderAudioFigure(primaryUrl) : options.preview ? renderAudioPlaceholder() : ''}` : ''}${'contourCue' in p && p.contourCue ? field('Contour cue', p.contourCue) : ''}</section>`;
}

/** Domain fields are plain text. No Markdown parsing, directives or marker interpretation. */
export async function renderAssignmentToHtml(
  a: AssignmentV1,
  options: AssignmentRenderOptions = {},
): Promise<string> {
  options = { ...options, pronunciationAudio: safeAudio(options.pronunciationAudio) };
  const resolved = resolveRenderOptions(options);
  const titles = [
    "1. 🎯 This Week's Mission Briefing",
    '2. 🎧 Input Material: The Source',
    '3. 🛠️ Language Toolkit: Useful Language',
    a.pronunciation ? '4. ✍️ Practice & Pronunciation' : '4. ✍️ Practice',
    '5. ✅ Your Turn: Complete the Mission!',
    '6. 🧠 Why This Mission Helps You',
    '7. 🔑 Answer Key & Sample Mission',
    "8. 👨‍🏫 Teacher's Follow-up Plan",
  ];
  const h2 = (i: number) => heading(2, titles[i]!, `assignment-section-${i + 1}`);
  const practice = (answers: boolean) =>
    a.practice
      .map(
        (part, i) =>
          `${part.title !== null || a.practice.length > 1 ? heading(4, `Part ${i + 1}${part.title ? `: ${part.title}` : ''}`) : ''}${!answers && part.instructions ? para(part.instructions) : ''}${list(part.items.map((q) => (answers ? answer(q) : e(q.prompt))))}`,
      )
      .join('');
  const names = new Map(a.input.studyText.speakers.map((s) => [s.id, s.displayName]));
  const body = [
    h2(0),
    `<aside class="callout"><div class="icon">🎯</div><div class="content">${field('Your Goal This Week', a.mission.goal)}<p><strong>Key Language You Will Use:</strong></p><ul class="mission-key-language">${a.mission.keyLanguage.map((item) => `<li>${e(item)}</li>`).join('')}</ul></div></aside>`,
    h2(1),
    heading(3, a.input.kind === 'authentic' ? '🌐 Authentic Material' : '🤖 Generated Material'),
    a.input.source.title
      ? a.input.kind === 'authentic'
        ? field('Title/Source', a.input.source.title)
        : a.input.source.title === a.metadata.title || a.input.source.title === a.metadata.topic
          ? ''
          : `<p class="source-caption">${e(a.input.source.title)}</p>`
      : '',
    a.input.source.attribution ? para(a.input.source.attribution) : '',
    a.input.source.url
      ? `<p><strong>Source Link:</strong> <a href="${e(sanitizeLinkHref(a.input.source.url))}" target="_blank" rel="noopener noreferrer">${e(a.input.source.url)}</a></p>`
      : '',
    ...a.input.media.map((m) =>
      m.kind === 'video' ? buildVideoEmbed(m.url) : renderAudioFigure(m.url),
    ),
    options.studyTextAudioUrl
      ? renderAudioFigure(options.studyTextAudioUrl)
      : options.preview && a.input.kind === 'generate'
        ? renderAudioPlaceholder()
        : '',
    disclosure(
      'Study Text: Transcript',
      a.input.studyText.turns.map((t) => para(`${names.get(t.speakerId)}: ${t.text}`)).join(''),
      'study-text',
    ),
    heading(3, '🤔 Comprehension Check'),
    list(a.input.comprehension.map((q) => e(q.prompt))),
    h2(2),
    heading(3, 'A. 👀 Notice the Grammar'),
    ...a.toolkit.grammar.map(
      (g) =>
        `<div class="grammar-card"><p><strong>${e(g.name)}</strong></p>${g.form ? field('Form', g.form) : ''}${para(g.explanation)}<ul>${g.examples.map((ex) => `<li><em>${e(ex)}</em></li>`).join('')}${g.uses.map((u) => `<li><strong>${e(u.label)}:</strong> ${e(u.example)}</li>`).join('')}</ul>${g.traps.length ? `<ul class="grammar-traps">${g.traps.map((t) => `<li class="grammar-trap">${field('Wrong', t.original)}${field('Corrected', t.improved)}${field('Explanation', t.explanation)}</li>`).join('')}</ul>` : ''}</div>`,
    ),
    heading(3, 'B. 🗣️ Useful Chunks & Vocabulary'),
    `<div class="table-scroll"><table><thead><tr><th>Expression</th><th>Meaning</th><th>Example</th></tr></thead><tbody>${a.toolkit.vocabulary.map((v) => `<tr><td>${e(v.expression)}</td><td>${e(v.meaning)}</td><td>${e(v.example)}</td></tr>`).join('')}</tbody></table></div>`,
    h2(3),
    heading(3, 'A. 🔩 Controlled Practice'),
    practice(false),
    a.pronunciation
      ? heading(3, 'B. 🎙️ Pronunciation Micro-Focus (≈1 min)') +
        renderPronunciation(a.pronunciation, options)
      : '',
    h2(4),
    para(a.outputTask.task),
    a.outputTask.extension ? field('Optional extension', a.outputTask.extension) : '',
    h2(5),
    para(a.rationale),
    h2(6),
    disclosure(
      'Answer Key',
      heading(3, 'Comprehension Check Answers') +
        list(a.input.comprehension.map(answer)) +
        heading(3, 'A. Controlled Practice Answers') +
        practice(true) +
        heading(3, 'Sample Mission') +
        para(a.outputTask.sampleResponse),
    ),
    h2(7),
    disclosure(
      'Teacher’s Follow-up Plan',
      field('Warm-up', a.teacherFollowUp.warmUp) +
        field('Correction focus', a.teacherFollowUp.correctionFocus),
    ),
  ].join('\n');
  return renderPageShell({
    resolvedTitle: a.metadata.title,
    frontmatter: { ...a.metadata, icon: '🎧' },
    resolved,
    bodyHtml: body,
    css: buildCss(resolved),
    behaviorScript: buildBehaviorScript(resolved.features),
  });
}
