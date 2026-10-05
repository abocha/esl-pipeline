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
          <Text>{q.prompt}</Text>
          <Field label="Answer">{q.answer}</Field>
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
            <ol>
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

function InputMaterial({ assignment: a, media }: LearnerHandoutProps) {
  const names = new Map(a.input.studyText.speakers.map((s) => [s.id, s.displayName]));
  const source = a.input.source;
  return (
    <>
      <h3>{a.input.kind === 'authentic' ? '🌐 Authentic Material' : '🤖 Generated Material'}</h3>
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
        <AudioPlayer url={media?.studyTextAudioUrl} label="Study audio" />
      )}
      <Disclosure label="Study Text: Transcript" className="study-text">
        {a.input.studyText.turns.map((turn, i) => (
          <Text key={i}>{`${names.get(turn.speakerId) ?? turn.speakerId}: ${turn.text}`}</Text>
        ))}
      </Disclosure>
      <h3>🤔 Comprehension Check</h3>
      <ol>
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
      <h3>A. 👀 Notice the Grammar</h3>
      {a.toolkit.grammar.map((g, i) => (
        <div className="grammar-card" key={i}>
          <p>
            <strong>{g.name}</strong>
          </p>
          {g.form && <Field label="Form">{g.form}</Field>}
          <Text>{g.explanation}</Text>
          <ul>
            {g.examples.map((ex, j) => (
              <li key={j}>
                <em>{ex}</em>
              </li>
            ))}
            {g.uses.map((u, j) => (
              <li key={`use-${j}`}>
                <strong>{u.label}:</strong> {u.example}
              </li>
            ))}
          </ul>
          {g.traps.length > 0 && (
            <ul className="grammar-traps">
              {g.traps.map((t, j) => (
                <li className="grammar-trap" key={j}>
                  <Field label="Wrong">{t.original}</Field>
                  <Field label="Corrected">{t.improved}</Field>
                  <Field label="Explanation">{t.explanation}</Field>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <h3>B. 🗣️ Useful Chunks & Vocabulary</h3>
      <div className="table-scroll" role="region" aria-label="Vocabulary" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Expression</th>
              <th>Meaning</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {a.toolkit.vocabulary.map((v, i) => (
              <tr key={i}>
                <td>{v.expression}</td>
                <td>{v.meaning}</td>
                <td>{v.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** AssignmentV1 is plain text. Audience/contract evolution remains outside this presentation seam. */
export function LearnerHandout(props: LearnerHandoutProps) {
  const { assignment: a, media, publication } = props;
  return (
    <article className="learner-handout">
      <header>
        <p className="eyebrow">English practice · {a.metadata.level}</p>
        <h1>{a.metadata.title}</h1>
        <p className="page-tags">
          {a.metadata.student} · {a.metadata.topic}
        </p>
        {publication?.displayDate && <p>{publication.displayDate}</p>}
      </header>
      <main>
        <h2 id="assignment-section-1">1. 🎯 This Week's Mission Briefing</h2>
        <aside className="callout">
          <Field label="Your Goal This Week">{a.mission.goal}</Field>
          <p>
            <strong>Key Language You Will Use:</strong>
          </p>
          <ul className="mission-key-language">
            {a.mission.keyLanguage.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </aside>
        <h2 id="assignment-section-2">2. 🎧 Input Material: The Source</h2>
        <InputMaterial {...props} />
        <h2 id="assignment-section-3">3. 🛠️ Language Toolkit: Useful Language</h2>
        <LanguageToolkit assignment={a} />
        <h2 id="assignment-section-4">
          {a.pronunciation ? '4. ✍️ Practice & Pronunciation' : '4. ✍️ Practice'}
        </h2>
        <h3>A. 🔩 Controlled Practice</h3>
        <PracticeParts assignment={a} />
        {a.pronunciation && (
          <>
            <h3>B. 🎙️ Pronunciation Micro-Focus (≈1 min)</h3>
            <Pronunciation pronunciation={a.pronunciation} media={media} />
          </>
        )}
        <h2 id="assignment-section-5">5. ✅ Your Turn: Complete the Mission!</h2>
        <Text>{a.outputTask.task}</Text>
        {a.outputTask.extension && (
          <Field label="Optional extension">{a.outputTask.extension}</Field>
        )}
        <h2 id="assignment-section-6">6. 🧠 Why This Mission Helps You</h2>
        <Text>{a.rationale}</Text>
        <h2 id="assignment-section-7">7. 🔑 Answer Key & Sample Mission</h2>
        <Disclosure label="Answer Key">
          <h3>Comprehension Check Answers</h3>
          <Answers questions={a.input.comprehension} />
          <h3>A. Controlled Practice Answers</h3>
          <PracticeParts assignment={a} answers />
          <h3>Sample Mission</h3>
          <Text>{a.outputTask.sampleResponse}</Text>
        </Disclosure>
        <h2 id="assignment-section-8">8. 👨‍🏫 Teacher's Follow-up Plan</h2>
        <Disclosure label="Teacher’s Follow-up Plan">
          <Field label="Warm-up">{a.teacherFollowUp.warmUp}</Field>
          <Field label="Correction focus">{a.teacherFollowUp.correctionFocus}</Field>
        </Disclosure>
      </main>
    </article>
  );
}
