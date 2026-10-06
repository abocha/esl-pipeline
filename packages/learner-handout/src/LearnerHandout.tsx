import type { CSSProperties } from 'react';

import type { AssignmentV1 } from '@esl-pipeline/contracts';

import { Pronunciation } from './Pronunciation.js';
import { AudioPlayer, Disclosure, Field, SourceLink, SourceVideo, Text } from './primitives.js';
import type { LearnerHandoutProps } from './types.js';

type Question = AssignmentV1['input']['comprehension'][number];

function Answers({ questions }: { questions: Question[] }) {
  return (
    <ol>
      {questions.map((q, i) => (
        <li className="answer-key-item" key={i}>
          <Text lang="en">{q.prompt}</Text>
          <Field label="Answer" lang="en">
            {q.answer}
          </Field>
          {q.explanation !== null && <Field label="Explanation">{q.explanation}</Field>}
        </li>
      ))}
    </ol>
  );
}

function PracticeParts({
  assignment,
  answers = false,
}: {
  assignment: AssignmentV1;
  answers?: boolean;
}) {
  return (
    <>
      {assignment.practice.map((part, i) => (
        <div className="practice-part" key={i}>
          {(part.title !== null || assignment.practice.length > 1) && (
            <h4>
              Part {i + 1}
              {part.title ? `: ${part.title}` : ''}
            </h4>
          )}
          {!answers && part.instructions && <Text>{part.instructions}</Text>}
          {answers ? (
            <Answers questions={part.items} />
          ) : (
            <ol lang="en">
              {part.items.map((q, j) => (
                <li key={j} className="plain-text">
                  {q.prompt}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </>
  );
}

function InputMaterial({ assignment: a, media, presentation }: LearnerHandoutProps) {
  const names = new Map(a.input.studyText.speakers.map((s) => [s.id, s.displayName]));
  const source = a.input.source;
  return (
    <>
      <h3 lang="en">
        {a.input.kind === 'authentic' ? '🌐 Authentic Material' : '🤖 Generated Material'}
      </h3>
      {source.title &&
        (a.input.kind === 'authentic' ? (
          <Field label="Title/Source">{source.title}</Field>
        ) : (
          source.title !== a.metadata.title &&
          source.title !== a.metadata.topic && <p className="source-caption">{source.title}</p>
        ))}
      {source.attribution && <Text>{source.attribution}</Text>}
      {source.url && (
        <p>
          <strong>Source Link:</strong> <SourceLink url={source.url} />
        </p>
      )}
      {a.input.media.map((m, i) =>
        m.kind === 'video' ? (
          <SourceVideo key={i} url={m.url} />
        ) : (
          <AudioPlayer key={i} url={m.url} label="Source audio" />
        ),
      )}
      {(media?.studyTextAudioUrl || a.input.kind === 'generate') && (
        <AudioPlayer
          url={media?.studyTextAudioUrl}
          label="Study audio"
          preview={presentation?.preview}
        />
      )}
      <Disclosure label="Study Text: Transcript" className="study-text">
        {a.input.studyText.turns.map((turn, i) => (
          <Text
            key={i}
            lang="en"
          >{`${names.get(turn.speakerId) ?? turn.speakerId}: ${turn.text}`}</Text>
        ))}
      </Disclosure>
      <h3 lang="en">🤔 Comprehension Check</h3>
      <ol lang="en">
        {a.input.comprehension.map((q, i) => (
          <li className="plain-text" key={i}>
            {q.prompt}
          </li>
        ))}
      </ol>
    </>
  );
}

function LanguageToolkit({ assignment: a }: { assignment: AssignmentV1 }) {
  return (
    <>
      <h3 lang="en">A. 👀 Notice the Grammar</h3>
      {a.toolkit.grammar.map((g, i) => (
        <div className="grammar-card" key={i}>
          <h4 className="grammar-topic">{g.name}</h4>
          <Text>{g.explanation}</Text>
          {'form' in g ? (
            g.form && (
              <Field label="Form" lang="en">
                {g.form}
              </Field>
            )
          ) : (
            <>
              <div className="grammar-forms">
                {g.formBlocks.map((block, j) => (
                  <section className="grammar-form" key={j}>
                    <h5>{block.label}</h5>
                    <Field label="Pattern" lang="en">
                      {block.pattern}
                    </Field>
                    <ul lang="en">
                      {block.examples.map((example, k) => (
                        <li className="plain-text" key={k}>
                          <em>{example}</em>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {g.comparisons.map((comparison, j) => (
                <section className="grammar-comparison" key={j}>
                  <h5>{comparison.label}</h5>
                  <div className="grammar-alternatives">
                    {comparison.alternatives.map((alternative, k) => (
                      <div className="grammar-alternative" key={k}>
                        <h6>{alternative.label}</h6>
                        <p className="plain-text">
                          <em lang="en">{alternative.example}</em>
                        </p>
                        <Text>{alternative.explanation}</Text>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
          {(g.examples.length > 0 || g.uses.length > 0) && (
            <ul className="grammar-guidance">
              {g.examples.map((ex, j) => (
                <li key={j}>
                  <em lang="en">{ex}</em>
                </li>
              ))}
              {g.uses.map((u, j) => (
                <li key={`use-${j}`}>
                  <strong>{u.label}:</strong> <span lang="en">{u.example}</span>
                </li>
              ))}
            </ul>
          )}
          {g.traps.length > 0 && (
            <ul className="grammar-traps">
              {g.traps.map((t, j) => (
                <li className="grammar-trap" key={j}>
                  <Field label="Wrong" lang="en">
                    {t.original}
                  </Field>
                  <Field label="Corrected" lang="en">
                    {t.improved}
                  </Field>
                  <Field label="Explanation">{t.explanation}</Field>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <h3 lang="en">B. 🗣️ Useful Chunks & Vocabulary</h3>
      <div className="table-scroll" role="region" aria-label="Vocabulary" tabIndex={0}>
        <table>
          <thead lang="en">
            <tr>
              <th>Expression</th>
              <th>Meaning</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {a.toolkit.vocabulary.map((v, i) => (
              <tr key={i}>
                <td lang="en">{v.expression}</td>
                <td>{v.meaning}</td>
                <td lang="en">{v.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MissionList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h3 lang="en">{label}</h3>
      <ul>
        {items.map((item, i) => (
          <li className="plain-text" key={i}>
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}

function OutputMission({ mission }: { mission: AssignmentV1['outputTask'] }) {
  return (
    <section className="output-mission" aria-labelledby="assignment-section-5">
      <div className="callout mission-task">
        <Text>{mission.task}</Text>
      </div>
      {'preparation' in mission && (
        <>
          <MissionList label="Prepare" items={mission.preparation} />
          <MissionList label="Include in your response" items={mission.requirements} />
          {mission.delivery !== null && (
            <>
              <h3 lang="en">How to do it</h3>
              <Text>{mission.delivery}</Text>
            </>
          )}
          <MissionList label="Before you finish" items={mission.selfCheck} />
        </>
      )}
      {mission.extension && <Field label="Optional extension">{mission.extension}</Field>}
    </section>
  );
}

/** AssignmentV1 is plain text. Audience/contract evolution remains outside this presentation seam. */
export function LearnerHandout(props: LearnerHandoutProps) {
  const { assignment: a, media, publication, presentation } = props;
  const headingStyle: CSSProperties & Record<string, string> = {};
  for (const level of ['h2', 'h3'] as const) {
    const color = presentation?.headingTheme?.[level];
    if (color && /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color))
      headingStyle[`--theme-${level}`] = color;
  }
  return (
    <article className="learner-handout" style={headingStyle} lang={a.metadata.instructionLanguage}>
      <header>
        <p className="eyebrow" lang="en">
          English practice · {a.metadata.level}
        </p>
        <h1>{a.metadata.title}</h1>
        <p className="page-tags">
          {a.metadata.student} · {a.metadata.topic}
        </p>
        {publication?.displayDate && <p>{publication.displayDate}</p>}
      </header>
      <main>
        <h2 id="assignment-section-1" lang="en">
          1. 🎯 This Week's Mission Briefing
        </h2>
        <aside className="callout">
          <Field label="Your Goal This Week">{a.mission.goal}</Field>
          <p>
            <strong lang="en">Key Language You Will Use:</strong>
          </p>
          <ul className="mission-key-language" lang="en">
            {a.mission.keyLanguage.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </aside>
        <h2 id="assignment-section-2" lang="en">
          2. 🎧 Input Material: The Source
        </h2>
        <InputMaterial {...props} />
        <h2 id="assignment-section-3" lang="en">
          3. 🛠️ Language Toolkit: Useful Language
        </h2>
        <LanguageToolkit assignment={a} />
        <h2 id="assignment-section-4" lang="en">
          {a.pronunciation ? '4. ✍️ Practice & Pronunciation' : '4. ✍️ Practice'}
        </h2>
        <h3 lang="en">A. 🔩 Controlled Practice</h3>
        <PracticeParts assignment={a} />
        {a.pronunciation && (
          <>
            <h3 lang="en">B. 🎙️ Pronunciation Micro-Focus (≈1 min)</h3>
            <Pronunciation
              pronunciation={a.pronunciation}
              media={media}
              preview={presentation?.preview}
            />
          </>
        )}
        <h2 id="assignment-section-5" lang="en">
          5. ✅ Your Turn: Complete the Mission!
        </h2>
        <OutputMission mission={a.outputTask} />
        {'learnerRationale' in a && (
          <>
            <h2 id="assignment-section-6" lang="en">
              6. 🧠 Why This Mission Helps You
            </h2>
            <Text>{a.learnerRationale}</Text>
          </>
        )}
        <h2 id="assignment-section-7" lang="en">
          7. 🔑 Answer Key & Sample Mission
        </h2>
        <Disclosure label="Answer Key">
          <h3 lang="en">Comprehension Check Answers</h3>
          <Answers questions={a.input.comprehension} />
          <h3 lang="en">A. Controlled Practice Answers</h3>
          <PracticeParts assignment={a} answers />
          <h3 lang="en">Sample Mission</h3>
          <Text lang="en">{a.outputTask.sampleResponse}</Text>
        </Disclosure>
        <h2 id="assignment-section-8" lang="en">
          8. 👨‍🏫 Teacher's Follow-up Plan
        </h2>
        <Disclosure label="Teacher’s Follow-up Plan">
          <Field label="Warm-up">{a.teacherFollowUp.warmUp}</Field>
          <Field label="Correction focus">{a.teacherFollowUp.correctionFocus}</Field>
        </Disclosure>
      </main>
    </article>
  );
}
