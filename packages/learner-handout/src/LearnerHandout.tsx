import {
  BookOpen,
  Brain,
  CircleCheck,
  Headphones,
  KeyRound,
  ListChecks,
  type LucideIcon,
  Mic,
  PencilLine,
  ScanText,
  Target,
  Wrench,
} from 'lucide-react';
import type { CSSProperties } from 'react';

import type { AssignmentV1 } from '@esl-pipeline/contracts';

import { Pronunciation } from './Pronunciation.js';
import {
  AudioPlayer,
  Disclosure,
  Field,
  GrammarPattern,
  Inline,
  RevealField,
  SourceLink,
  SourceVideo,
  Text,
} from './primitives.js';
import type { LearnerHandoutProps } from './types.js';

type Question = AssignmentV1['input']['comprehension'][number];

function IconHeading({
  icon: Icon,
  prefix,
  level: Heading = 'h3',
  id,
  tone,
  className,
  children,
}: {
  icon: LucideIcon;
  prefix?: string;
  level?: 'h2' | 'h3';
  id?: string;
  tone: 'goal' | 'listen' | 'grammar' | 'exercises' | 'complete' | 'rationale' | 'answers';
  className?: string;
  children: string;
}) {
  return (
    <Heading className={`icon-heading${className ? ` ${className}` : ''}`} id={id} lang="en">
      {prefix && (
        <>
          <span className="heading-prefix">{prefix}</span>{' '}
        </>
      )}
      <span className={`heading-icon icon-${tone}`} aria-hidden="true">
        <Icon size={22} strokeWidth={2} focusable="false" />
      </span>
      <span className="heading-text">{children}</span>
    </Heading>
  );
}

// Russian support metadata also occurs on older assignments with English questions.
// This bounded script heuristic applies only to question text, never explanations or answers.
function questionLanguage(prompt: string, supportLanguage: string): string {
  return supportLanguage.split('-')[0] === 'ru' && !/\p{Script=Cyrillic}/u.test(prompt)
    ? 'en'
    : supportLanguage;
}

function Answers({
  questions,
  promptLanguage = 'en',
}: {
  questions: Question[];
  promptLanguage?: string;
}) {
  return (
    <ol>
      {questions.map((q, i) => (
        <li className="answer-key-item" key={i}>
          <Text className="answer-question" lang={questionLanguage(q.prompt, promptLanguage)}>
            {q.prompt}
          </Text>
          <Field label="Answer" lang="en" className="answer-content">
            {q.answer}
          </Field>
          {q.explanation !== null && (
            <Field label="Explanation" className="answer-explanation">
              {q.explanation}
            </Field>
          )}
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
  const Heading = answers ? 'h4' : 'h3';
  return (
    <>
      {assignment.practice.map((part, i) => (
        <div className="practice-part" key={i}>
          {(part.title !== null || assignment.practice.length > 1) && (
            <Heading>
              <span className="practice-part-number">Part {i + 1}</span>
              {part.title && (
                <>
                  :{' '}
                  <Inline>
                    {part.title.replace(/^\s*(?:(?:Part|Часть)\s+)?\d+\s*[.):\-–—]\s*/iu, '')}
                  </Inline>
                </>
              )}
            </Heading>
          )}
          {!answers && part.instructions && <Text>{part.instructions}</Text>}
          {answers ? (
            <Answers questions={part.items} />
          ) : (
            <ol lang="en">
              {part.items.map((q, j) => (
                <li key={j} className="plain-text">
                  <Inline>{q.prompt}</Inline>
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
      <section className="listening-panel" aria-label="Listening material">
        <h3 lang="en">Listen first</h3>
        <p lang="en">Listen for the main idea. Use the transcript below whenever it helps.</p>
        {source.title && (
          <h4 className="source-title">
            <Inline>{source.title}</Inline>
          </h4>
        )}
        {source.attribution && <Text>{source.attribution}</Text>}
        {source.url && (
          <p>
            <strong>Source:</strong> <SourceLink url={source.url} />
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
        <Disclosure label="Transcript" className="study-text connected-disclosure">
          {a.input.studyText.turns.map((turn, i) => (
            <p key={i} lang="en" className="plain-text transcript-turn">
              <strong className="transcript-speaker">
                {names.get(turn.speakerId) ?? turn.speakerId}:
              </strong>{' '}
              <Inline>{turn.text}</Inline>
            </p>
          ))}
        </Disclosure>
        <p className="source-caption" lang="en">
          {a.input.kind === 'authentic' ? 'Authentic material' : 'Generated material'}
        </p>
      </section>
      <IconHeading icon={ListChecks} tone="complete">
        Check Your Understanding
      </IconHeading>
      <ol lang={a.metadata.instructionLanguage ?? 'en'}>
        {a.input.comprehension.map((q, i) => (
          <li
            className="plain-text"
            key={i}
            lang={questionLanguage(q.prompt, a.metadata.instructionLanguage ?? 'en')}
          >
            <Inline>{q.prompt}</Inline>
          </li>
        ))}
      </ol>
    </>
  );
}

function LanguageToolkit({ assignment: a }: { assignment: AssignmentV1 }) {
  return (
    <>
      <IconHeading icon={ScanText} prefix="A." tone="grammar">
        How the Grammar Works
      </IconHeading>
      {a.toolkit.grammar.map((g, i) => (
        <div className="grammar-card" key={i}>
          <h4 className="grammar-topic">
            <Inline>{g.name}</Inline>
          </h4>
          <Text>{g.explanation}</Text>
          {'form' in g ? (
            g.form && <GrammarPattern label="Form">{g.form}</GrammarPattern>
          ) : (
            <>
              <div className="grammar-forms">
                {g.formBlocks.map((block, j) => (
                  <section className="grammar-form" key={j}>
                    <h5>
                      <Inline>{block.label}</Inline>
                    </h5>
                    <GrammarPattern>{block.pattern}</GrammarPattern>
                    <ul lang="en">
                      {block.examples.map((example, k) => (
                        <li className="plain-text" key={k}>
                          <em>
                            <Inline>{example}</Inline>
                          </em>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {g.comparisons.map((comparison, j) => (
                <section className="grammar-comparison" key={j}>
                  <h5>
                    <Inline>{comparison.label}</Inline>
                  </h5>
                  <div className="grammar-alternatives">
                    {comparison.alternatives.map((alternative, k) => (
                      <div className="grammar-alternative" key={k}>
                        <h6>
                          <Inline>{alternative.label}</Inline>
                        </h6>
                        <p className="plain-text">
                          <em lang="en">
                            <Inline>{alternative.example}</Inline>
                          </em>
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
                  <em lang="en">
                    <Inline>{ex}</Inline>
                  </em>
                </li>
              ))}
              {g.uses.map((u, j) => (
                <li key={`use-${j}`}>
                  <strong>
                    <Inline>{u.label}</Inline>:
                  </strong>{' '}
                  <span lang="en">
                    <Inline>{u.example}</Inline>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {g.traps.length > 0 && (
            <ul className="grammar-traps" role="list">
              {g.traps.map((t, j) => (
                <li className="grammar-trap" key={j}>
                  <Field label="Wrong" lang="en">
                    {t.original}
                  </Field>
                  <RevealField
                    label="Corrected"
                    lang="en"
                    name={`Reveal corrected sentence for grammar topic ${i + 1}, trap ${j + 1}`}
                  >
                    {t.improved}
                  </RevealField>
                  <RevealField
                    label="Explanation"
                    name={`Reveal explanation for grammar topic ${i + 1}, trap ${j + 1}`}
                  >
                    {t.explanation}
                  </RevealField>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <IconHeading icon={BookOpen} prefix="B." tone="listen">
        Vocabulary
      </IconHeading>
      <div className="table-scroll" role="region" aria-label="Vocabulary" tabIndex={0}>
        <table className="vocabulary-table" role="table">
          <thead lang="en" role="rowgroup">
            <tr role="row">
              <th id="vocabulary-expression" scope="col" role="columnheader">
                Word or Phrase
              </th>
              <th id="vocabulary-meaning" scope="col" role="columnheader">
                Meaning
              </th>
              <th id="vocabulary-example" scope="col" role="columnheader">
                Example
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {a.toolkit.vocabulary.map((v, i) => (
              <tr key={i} role="row">
                <td lang="en" role="cell" headers="vocabulary-expression">
                  <strong>
                    <Inline>{v.expression}</Inline>
                  </strong>
                </td>
                <td role="cell" headers="vocabulary-meaning">
                  <span className="vocabulary-cell-label" aria-hidden="true" lang="en">
                    Meaning
                  </span>
                  <span className="vocabulary-value">
                    <Inline>{v.meaning}</Inline>
                  </span>
                </td>
                <td lang="en" role="cell" headers="vocabulary-example">
                  <span className="vocabulary-cell-label" aria-hidden="true" lang="en">
                    Example
                  </span>
                  <em>
                    <Inline>{v.example}</Inline>
                  </em>
                </td>
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
            <Inline>{item}</Inline>
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
          <MissionList label="What to Include" items={mission.requirements} />
          {mission.delivery !== null && (
            <>
              <h3 lang="en">How to do it</h3>
              <Text>{mission.delivery}</Text>
            </>
          )}
          <MissionList label="Check Your Work" items={mission.selfCheck} />
        </>
      )}
      {mission.extension && <Field label="Extra Task">{mission.extension}</Field>}
    </section>
  );
}

/** Escaped AssignmentV1 strings with only the explicit linguistic-highlight convention. */
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
        <h1>
          <span className="hero-icon" aria-hidden="true">
            {a.metadata.icon ?? '🎧'}
          </span>{' '}
          <Inline>{a.metadata.title}</Inline>
        </h1>
        <p className="page-tags">
          {a.metadata.student} · <Inline>{a.metadata.topic}</Inline>
        </p>
        {publication?.displayDate && <p>{publication.displayDate}</p>}
      </header>
      <main>
        <IconHeading level="h2" id="assignment-section-1" icon={Target} prefix="1." tone="goal">
          Your Goal
        </IconHeading>
        <aside className="callout">
          <Field label="Your Goal">{a.mission.goal}</Field>
          <p>
            <strong lang="en">Key Language You Will Use:</strong>
          </p>
          <ul className="mission-key-language" lang="en">
            {a.mission.keyLanguage.map((item, i) => (
              <li key={i}>
                <Inline>{item}</Inline>
              </li>
            ))}
          </ul>
        </aside>
        <IconHeading
          level="h2"
          id="assignment-section-2"
          icon={Headphones}
          prefix="2."
          tone="listen"
        >
          Listen and Read
        </IconHeading>
        <InputMaterial {...props} />
        <IconHeading level="h2" id="assignment-section-3" icon={Wrench} prefix="3." tone="grammar">
          Grammar and Vocabulary
        </IconHeading>
        <LanguageToolkit assignment={a} />
        <IconHeading
          level="h2"
          id="assignment-section-4"
          icon={PencilLine}
          prefix="4."
          tone="exercises"
        >
          Practice
        </IconHeading>
        <PracticeParts assignment={a} />
        {a.pronunciation && (
          <>
            <IconHeading icon={Mic} tone="listen">
              Say It Clearly (≈1 min)
            </IconHeading>
            <Pronunciation
              pronunciation={a.pronunciation}
              media={media}
              preview={presentation?.preview}
            />
          </>
        )}
        <IconHeading
          level="h2"
          id="assignment-section-5"
          icon={CircleCheck}
          prefix="5."
          tone="complete"
        >
          Your Turn
        </IconHeading>
        <OutputMission mission={a.outputTask} />
        {'learnerRationale' in a && (
          <>
            <IconHeading
              level="h2"
              id="assignment-section-6"
              icon={Brain}
              prefix="6."
              tone="rationale"
              className="rationale-heading"
            >
              Why This Helps You
            </IconHeading>
            <Text className="learner-rationale">{a.learnerRationale}</Text>
          </>
        )}
        <IconHeading
          level="h2"
          id="assignment-section-7"
          icon={KeyRound}
          prefix="7."
          tone="answers"
        >
          Answers and Example
        </IconHeading>
        <Disclosure label="Answer Key" className="connected-disclosure">
          <h3 lang="en">Understanding Answers</h3>
          <Answers
            questions={a.input.comprehension}
            promptLanguage={a.metadata.instructionLanguage ?? 'en'}
          />
          <h3 lang="en">A. Exercise Answers</h3>
          <PracticeParts assignment={a} answers />
          <h3 lang="en">Example Response</h3>
          <Text lang="en" className="sample-mission">
            {a.outputTask.sampleResponse}
          </Text>
        </Disclosure>
      </main>
    </article>
  );
}
