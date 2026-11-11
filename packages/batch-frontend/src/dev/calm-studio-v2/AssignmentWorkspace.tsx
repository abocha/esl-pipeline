import { ArrowLeft, ArrowRight, Check, Download, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ProductButton } from '../../ui/system/ProductButton';
import { type Learner } from './fixtures';
import './AssignmentWorkspace.css';
import {
  type AssignmentSlot,
  handoutHtml,
  type StudioAssignment,
  sampleWorkbook,
  type Workbook,
  workbookError,
} from './assignment-model';

export function AssignmentWorkspace({
  slot,
  learner,
  step,
  onStep,
  onChange,
  onCommit,
  onBack,
  onOpenExisting,
  knownSources,
  saveFailure,
  lessonLabel,
}: {
  slot: AssignmentSlot;
  learner: Learner;
  step: number;
  onStep: (step: number) => void;
  onChange: (assignment: StudioAssignment) => void;
  onCommit: (assignment: StudioAssignment) => boolean;
  onBack: () => void;
  onOpenExisting: (id: string) => void;
  knownSources: StudioAssignment[];
  saveFailure: boolean;
  lessonLabel?: string;
}) {
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [showHandout, setShowHandout] = useState(false);
  const [sourceSelection, setSourceSelection] = useState('new');
  const [relatedReviewed, setRelatedReviewed] = useState(true);
  const draft = slot.draft;
  const dirty = JSON.stringify(slot.draft) !== JSON.stringify(slot.saved);
  const locked = slot.saved.status !== 'draft';
  const retainWorkbook =
    Boolean(draft.content.passage.trim()) &&
    draft.material === slot.saved.material &&
    draft.authentic === slot.saved.authentic &&
    draft.guidance === slot.saved.guidance;
  const stages = [
    'Source',
    'Teaching context',
    'Material & guidance',
    'Edit assignment',
    'Preview & share',
  ];
  const update = (patch: Partial<StudioAssignment>) => {
    const unlocked =
      patch.source !== undefined || patch.homework !== undefined
        ? 1
        : patch.context !== undefined
          ? Math.min(draft.unlocked, 2)
          : patch.material !== undefined ||
              patch.authentic !== undefined ||
              patch.guidance !== undefined
            ? Math.min(draft.unlocked, 3)
            : patch.content
              ? Math.min(draft.unlocked, 4)
              : draft.unlocked;
    onChange({ ...draft, ...patch, unlocked });
    setError('');
  };
  const content = (patch: Partial<Workbook>) => {
    update({ content: { ...draft.content, ...patch } });
  };
  function commit(next = draft) {
    if (saveFailure) {
      setError('Could not save. Your edits are still here.');
      return false;
    }
    const invalid = next.unlocked >= 4 ? workbookError(next.content) : null;
    if (invalid) {
      setError(invalid);
      return false;
    }
    if (!onCommit(next)) return false;
    setError('');
    return true;
  }
  function advance(next: StudioAssignment, stage: number) {
    if (commit(next)) onStep(stage);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([handoutHtml(slot.saved.content)], { type: 'text/html;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slot.saved.content.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (showHandout)
    return (
      <div className="cs2-assignment-workspace">
        <button
          type="button"
          className="cs2-text-button cs2-back"
          onClick={() => setShowHandout(false)}
        >
          <ArrowLeft size={15} />
          Return to assignment
        </button>
        <div className="cs2-section-heading">
          <span>Learner handout · saved publication</span>
          <ProductButton variant="secondary" icon={<Download />} onClick={download}>
            Download HTML
          </ProductButton>
        </div>
        <WorkbookPreview content={slot.saved.content} />
      </div>
    );
  return (
    <div className="cs2-assignment-workspace">
      <button type="button" className="cs2-text-button cs2-back" onClick={onBack}>
        <ArrowLeft size={15} />
        Assignments
      </button>
      <header className="cs2-page-heading">
        <div>
          <h1>
            {draft.content.title === 'Untitled assignment' ? 'New assignment' : draft.content.title}
          </h1>
          <p>
            {learner.name} · {learner.level}
            {lessonLabel ? ` · ${lessonLabel}` : ' · Unscheduled work'}
          </p>
        </div>
        <span className="cs2-save-state">
          {locked
            ? slot.saved.status === 'published'
              ? 'Published in sandbox'
              : 'Transcript-only · finished'
            : dirty
              ? 'Unsaved changes'
              : 'Saved'}
        </span>
      </header>
      {error && (
        <p role="alert" className="cs2-message cs2-error">
          {error}
        </p>
      )}
      {slot.saved.status === 'transcript' ? (
        <section className="cs2-finished">
          <Check size={28} />
          <h2>Transcript-only lesson finished</h2>
          <p>{slot.saved.source}</p>
          <p>No homework was published. Lesson status and billing are unchanged.</p>
          <ProductButton
            onClick={() => {
              const next = { ...draft, status: 'draft' as const, homework: true, unlocked: 2 };
              if (commit(next)) onStep(2);
            }}
          >
            Prepare homework from this source
          </ProductButton>
        </section>
      ) : (
        <>
          <nav className="cs2-stepper" aria-label="Assignment stages">
            {stages.map((label, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index + 1 ? 'step' : undefined}
                disabled={index + 1 > draft.unlocked || (locked && index < 3)}
                onClick={() => {
                  onStep(index + 1);
                  setPreview(false);
                }}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          {step === 1 && (
            <section className="cs2-focused-form">
              <h2>Lesson source</h2>
              {knownSources.length > 0 && (
                <label>
                  Source
                  <select
                    value={sourceSelection}
                    onChange={(event) => setSourceSelection(event.target.value)}
                  >
                    <option value="new">Paste a new transcript or source</option>
                    {knownSources.map((item) => (
                      <option key={item.id} value={item.id}>
                        Existing source · {item.content.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {sourceSelection !== 'new' ? (
                <>
                  <p>
                    This source already belongs to an assignment. Continue that work with its saved
                    context.
                  </p>
                  <ProductButton onClick={() => onOpenExisting(sourceSelection)}>
                    Open existing assignment
                  </ProductButton>
                </>
              ) : (
                <>
                  <label>
                    Transcript or source text
                    <textarea
                      rows={7}
                      value={draft.source}
                      onChange={(event) => update({ source: event.target.value })}
                    />
                  </label>
                  <fieldset className="cs2-choice">
                    <legend>Outcome</legend>
                    <label>
                      <input
                        type="radio"
                        name="intent"
                        checked={draft.homework}
                        onChange={() => update({ homework: true })}
                      />
                      Prepare homework
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="intent"
                        checked={!draft.homework}
                        onChange={() => update({ homework: false })}
                      />
                      Transcript only
                    </label>
                  </fieldset>
                  {slot.saved.unlocked > 1 && draft.source !== slot.saved.source && (
                    <p className="cs2-inline-warning">
                      Confirming a replacement source clears the downstream draft.
                    </p>
                  )}
                  <ProductButton
                    disabled={!draft.source.trim()}
                    onClick={() =>
                      advance(
                        {
                          ...draft,
                          sourceId:
                            draft.source !== slot.saved.source
                              ? crypto.randomUUID()
                              : draft.sourceId,
                          unlocked: draft.homework
                            ? draft.source === slot.saved.source
                              ? Math.max(2, slot.saved.unlocked)
                              : 2
                            : 1,
                          status: draft.homework ? 'draft' : 'transcript',
                          content:
                            draft.source === slot.saved.source
                              ? draft.content
                              : {
                                  ...draft.content,
                                  passage: '',
                                  questions: [],
                                  words: [],
                                  practice: '',
                                },
                        },
                        draft.homework ? 2 : 1,
                      )
                    }
                  >
                    {draft.homework
                      ? 'Confirm source & continue'
                      : 'Confirm source & finish transcript-only lesson'}
                  </ProductButton>
                </>
              )}
            </section>
          )}
          {step === 2 && (
            <section className="cs2-focused-form">
              <h2>Teaching context</h2>
              <label>
                Context to use for this assignment
                <textarea
                  rows={5}
                  value={draft.context}
                  onChange={(event) => update({ context: event.target.value })}
                />
              </label>
              <details>
                <summary>Read current learner profile</summary>
                <p>{learner.goal}</p>
                <p>{learner.challenge}</p>
                <p>{learner.interests}</p>
              </details>
              <ProductButton
                onClick={() =>
                  advance(
                    {
                      ...draft,
                      unlocked:
                        draft.context === slot.saved.context ? Math.max(3, slot.saved.unlocked) : 3,
                    },
                    3,
                  )
                }
              >
                Confirm teaching context
              </ProductButton>
            </section>
          )}
          {step === 3 && (
            <section className="cs2-focused-form">
              <h2>Material & guidance</h2>
              <fieldset className="cs2-choice">
                <legend>Material</legend>
                <label>
                  <input
                    type="radio"
                    name="material"
                    checked={draft.material === 'generated'}
                    onChange={() => update({ material: 'generated' })}
                  />
                  Sample generated material
                </label>
                <label>
                  <input
                    type="radio"
                    name="material"
                    checked={draft.material === 'authentic'}
                    onChange={() => update({ material: 'authentic' })}
                  />
                  Authentic text
                </label>
              </fieldset>
              {draft.material === 'authentic' && (
                <label>
                  Exact authentic text
                  <textarea
                    rows={6}
                    value={draft.authentic}
                    onChange={(event) => update({ authentic: event.target.value })}
                  />
                </label>
              )}
              <label>
                Teaching guidance
                <textarea
                  rows={4}
                  value={draft.guidance}
                  onChange={(event) => update({ guidance: event.target.value })}
                />
              </label>
              <p className="cs2-muted cs2-small">
                Generated material uses an editable example for {learner.name.split(' ')[0]}.
                Authentic text is carried into the draft exactly. No AI provider is called.
              </p>
              <ProductButton
                disabled={draft.material === 'authentic' && !draft.authentic.trim()}
                onClick={() => {
                  if (retainWorkbook) {
                    advance({ ...draft, unlocked: Math.max(4, slot.saved.unlocked) }, 4);
                    return;
                  }
                  const example = sampleWorkbook(learner);
                  const workbook =
                    draft.material === 'authentic'
                      ? {
                          ...example,
                          passage: draft.authentic,
                          questions: [],
                          words: [],
                          practice: draft.guidance,
                        }
                      : example;
                  advance({ ...draft, unlocked: 4, content: workbook }, 4);
                }}
              >
                {retainWorkbook
                  ? 'Continue to editor'
                  : slot.saved.content.passage.trim()
                    ? 'Replace existing draft'
                    : draft.material === 'authentic'
                      ? 'Create draft from this text'
                      : 'Create example draft'}
              </ProductButton>
            </section>
          )}
          {step >= 4 && (
            <>
              <div className="cs2-editor-toolbar">
                <div className="cs2-mode-switch">
                  <button
                    type="button"
                    aria-pressed={!preview && step !== 5}
                    onClick={() => {
                      onStep(4);
                      setPreview(false);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-pressed={preview || step === 5}
                    onClick={() => setPreview(true)}
                  >
                    Learner preview
                  </button>
                </div>
                <div className="cs2-row-actions">
                  {dirty && (
                    <ProductButton
                      variant="quiet"
                      onClick={() => onChange(structuredClone(slot.saved))}
                    >
                      Discard changes
                    </ProductButton>
                  )}
                  {!locked && (
                    <ProductButton variant="secondary" disabled={!dirty} onClick={() => commit()}>
                      Save changes
                    </ProductButton>
                  )}
                  {locked && (
                    <ProductButton onClick={() => setShowHandout(true)}>
                      Open learner handout
                    </ProductButton>
                  )}
                </div>
              </div>
              {preview || step === 5 || locked ? (
                <>
                  <WorkbookPreview content={slot.saved.content} />
                  {dirty && (
                    <p className="cs2-inline-warning">
                      Preview shows saved content. Save your changes to update it.
                    </p>
                  )}
                </>
              ) : (
                <div className="cs2-editor-layout">
                  <nav aria-label="Assignment sections">
                    <a href="#cs2-text">Study text</a>
                    <a href="#cs2-questions">Comprehension</a>
                    <a href="#cs2-vocabulary">Useful language</a>
                    <a href="#cs2-practice">Speaking practice</a>
                    <a href="#cs2-teacher">Teacher notes</a>
                  </nav>
                  <article className="cs2-workbook">
                    <label>
                      Assignment title
                      <input
                        value={draft.content.title}
                        onChange={(event) => content({ title: event.target.value })}
                      />
                    </label>
                    <section id="cs2-text">
                      <h3>Study text</h3>
                      <label className="cs2-visually-labelled">
                        <span>Study text</span>
                        <textarea
                          rows={8}
                          value={draft.content.passage}
                          onChange={(event) => {
                            content({ passage: event.target.value });
                            setRelatedReviewed(false);
                          }}
                        />
                      </label>
                    </section>
                    <section id="cs2-questions">
                      <h3>Comprehension</h3>
                      {draft.content.questions.map((question, index) => (
                        <div className="cs2-editable-item" key={question.id}>
                          <div className="cs2-section-heading">
                            <span>Question {index + 1}</span>
                            <button
                              className="cs2-icon-button"
                              type="button"
                              aria-label={`Remove question ${index + 1}`}
                              onClick={() =>
                                content({
                                  questions: draft.content.questions.filter(
                                    (item) => item.id !== question.id,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <label>
                            Question
                            <textarea
                              rows={2}
                              value={question.prompt}
                              onChange={(event) =>
                                content({
                                  questions: draft.content.questions.map((item) =>
                                    item.id === question.id
                                      ? { ...item, prompt: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Model answer
                            <textarea
                              rows={2}
                              value={question.answer}
                              onChange={(event) =>
                                content({
                                  questions: draft.content.questions.map((item) =>
                                    item.id === question.id
                                      ? { ...item, answer: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                        </div>
                      ))}
                      <ProductButton
                        variant="quiet"
                        icon={<Plus />}
                        onClick={() =>
                          content({
                            questions: [
                              ...draft.content.questions,
                              { id: crypto.randomUUID(), prompt: '', answer: '' },
                            ],
                          })
                        }
                      >
                        Add question
                      </ProductButton>
                    </section>
                    <section id="cs2-vocabulary">
                      <h3>Useful language</h3>
                      {draft.content.words.map((word, index) => (
                        <div className="cs2-editable-item" key={word.id}>
                          <div className="cs2-section-heading">
                            <span>Entry {index + 1}</span>
                            <button
                              className="cs2-icon-button"
                              type="button"
                              aria-label={`Remove vocabulary entry ${index + 1}`}
                              onClick={() =>
                                content({
                                  words: draft.content.words.filter((item) => item.id !== word.id),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <label>
                            Word or phrase
                            <input
                              value={word.term}
                              onChange={(event) =>
                                content({
                                  words: draft.content.words.map((item) =>
                                    item.id === word.id
                                      ? { ...item, term: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Meaning
                            <textarea
                              rows={2}
                              value={word.meaning}
                              onChange={(event) =>
                                content({
                                  words: draft.content.words.map((item) =>
                                    item.id === word.id
                                      ? { ...item, meaning: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                        </div>
                      ))}
                      <ProductButton
                        variant="quiet"
                        icon={<Plus />}
                        onClick={() =>
                          content({
                            words: [
                              ...draft.content.words,
                              { id: crypto.randomUUID(), term: '', meaning: '' },
                            ],
                          })
                        }
                      >
                        Add vocabulary
                      </ProductButton>
                    </section>
                    <section id="cs2-practice">
                      <h3>Speaking practice</h3>
                      <label className="cs2-visually-labelled">
                        <span>Speaking practice</span>
                        <textarea
                          rows={4}
                          value={draft.content.practice}
                          onChange={(event) => content({ practice: event.target.value })}
                        />
                      </label>
                    </section>
                    <section id="cs2-teacher">
                      <h3>Teacher-only notes</h3>
                      <label className="cs2-visually-labelled">
                        <span>Teacher-only notes</span>
                        <textarea
                          rows={3}
                          value={draft.content.teacherNotes}
                          onChange={(event) => content({ teacherNotes: event.target.value })}
                        />
                      </label>
                      <p className="cs2-muted cs2-small">
                        Excluded from learner preview and downloaded handouts.
                      </p>
                    </section>
                  </article>
                </div>
              )}
              {!locked && (
                <footer className="cs2-editor-footer">
                  <div>
                    {!relatedReviewed && (
                      <label className="cs2-check">
                        <input
                          type="checkbox"
                          checked={relatedReviewed}
                          onChange={(event) => setRelatedReviewed(event.target.checked)}
                        />
                        I’ve reviewed the activities against the changed text
                      </label>
                    )}
                    <span className="cs2-muted cs2-small">
                      {step === 5
                        ? 'Publishing creates a local handout snapshot.'
                        : 'Save and review before sharing.'}
                    </span>
                  </div>
                  <ProductButton
                    disabled={!relatedReviewed}
                    onClick={() => {
                      if (step !== 5) advance({ ...draft, unlocked: 5 }, 5);
                      else advance({ ...draft, status: 'published', unlocked: 5 }, 5);
                    }}
                  >
                    {step === 5 ? 'Publish local handout' : 'Review before sharing'}
                    <ArrowRight size={16} />
                  </ProductButton>
                </footer>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function WorkbookPreview({ content }: { content: Workbook }) {
  return (
    <article className="cs2-workbook cs2-learner-preview cs2-full-preview">
      <header>
        <span className="cs2-muted cs2-small">English practice</span>
        <h2>{content.title}</h2>
      </header>
      <section>
        <h3>Study text</h3>
        <p className="cs2-passage">{content.passage}</p>
      </section>
      {content.questions.length > 0 && (
        <section>
          <h3>Comprehension</h3>
          {content.questions.map((item, index) => (
            <div key={item.id}>
              <p>
                {index + 1}. {item.prompt}
              </p>
              <details>
                <summary>Show model answer</summary>
                <p>{item.answer}</p>
              </details>
            </div>
          ))}
        </section>
      )}
      {content.words.length > 0 && (
        <section>
          <h3>Useful language</h3>
          <dl>
            {content.words.map((item) => (
              <div key={item.id}>
                <dt>{item.term}</dt>
                <dd>{item.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {content.practice && (
        <section>
          <h3>Your turn</h3>
          <p>{content.practice}</p>
        </section>
      )}
    </article>
  );
}
