import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { LearnerHandout } from '@esl-pipeline/learner-handout';
import '@esl-pipeline/learner-handout/handout.css';
import {
  type AssignmentValidationContext,
  assignmentInlineParts,
  type FreshAssignmentV1,
  validateAssignmentV1,
} from '@esl-pipeline/contracts';

import {
  type EditorPath,
  editAssignment,
  editorValue,
  fieldKey,
  highlightSelection,
  readEditorAssignment,
  textProblem,
} from './AssignmentEditor.model';
import './AssignmentEditor.css';

type Focus = { field: string; start: number; end: number };
type Snapshot = { text: string; selected: string | null; focus: Focus | null };
type History = { past: Snapshot[]; future: Snapshot[] };
interface EditorContext {
  assignment: FreshAssignmentV1;
  disabled: boolean;
  readOnly: boolean;
  selected: string | null;
  select: (id: string | null) => void;
  change: (path: EditorPath, value: unknown, typing?: boolean) => void;
  endTyping: () => void;
  scheduleFocus: (work: () => void) => void;
  fields: React.RefObject<Map<string, HTMLTextAreaElement>>;
  focus: React.RefObject<Focus | null>;
  suppliedUrls: readonly string[];
}
const Context = createContext<EditorContext | null>(null);
function useEditor() {
  const editor = useContext(Context);
  if (!editor) throw new Error('Assignment editor context is missing');
  return editor;
}

function InlineText({ value }: { value: string }) {
  return (
    <>
      {assignmentInlineParts(value).map((part, i) =>
        part.highlighted ? (
          <mark key={i}>{part.text}</mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function TextField({
  path,
  label,
  optional = false,
  compact = false,
  domainProblem,
}: {
  path: EditorPath;
  label: string;
  optional?: boolean;
  compact?: boolean;
  domainProblem?: string;
}) {
  const e = useEditor();
  const key = fieldKey(path);
  const value = String(editorValue(e.assignment, path) ?? '');
  const problem = textProblem(value, path, optional) ?? domainProblem;
  const id = `assignment-field-${key}`;
  const [focused, setFocused] = useState(false);
  const remember = (field: HTMLTextAreaElement) => {
    e.focus.current = { field: key, start: field.selectionStart, end: field.selectionEnd };
  };
  if (e.readOnly)
    return (
      <div className="assignment-editor-field">
        <span className="assignment-editor-label">{label}</span>
        <div className="assignment-editor-read-text">
          <InlineText value={value || '—'} />
        </div>
      </div>
    );
  return (
    <div className={`assignment-editor-field${compact ? ' is-compact' : ''}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="assignment-editor-optional"> · optional</span>}
      </label>
      <textarea
        id={id}
        ref={(node) => {
          if (node) e.fields.current.set(key, node);
          else e.fields.current.delete(key);
        }}
        aria-label={label}
        value={value}
        rows={
          compact
            ? 1
            : Math.min(8, Math.max(1, value.split('\n').length, Math.ceil(value.length / 95)))
        }
        disabled={e.disabled}
        aria-invalid={Boolean(problem)}
        aria-describedby={problem ? `${id}-error` : undefined}
        onFocus={(event) => {
          setFocused(true);
          remember(event.currentTarget);
        }}
        onBlur={() => {
          setFocused(false);
          e.endTyping();
        }}
        onCompositionStart={e.endTyping}
        onCompositionEnd={e.endTyping}
        onSelect={(event) => remember(event.currentTarget)}
        onChange={(event) => {
          remember(event.currentTarget);
          e.change(path, optional && !event.target.value.trim() ? null : event.target.value, true);
        }}
      />
      {!focused && value.includes('`') && (
        <div className="assignment-editor-highlight-preview" aria-label={`${label} highlights`}>
          <InlineText value={value} />
        </div>
      )}
      {problem && (
        <small id={`${id}-error`} className="minimal-error">
          {problem}
        </small>
      )}
    </div>
  );
}

function Choice({
  path,
  label,
  options,
  nullable = false,
}: {
  path: EditorPath;
  label: string;
  options: readonly string[];
  nullable?: boolean;
}) {
  const e = useEditor();
  const value = String(editorValue(e.assignment, path) ?? '');
  const id = `assignment-field-${fieldKey(path)}`;
  if (e.readOnly)
    return (
      <p>
        <strong>{label}:</strong> {value || 'None'}
      </p>
    );
  return (
    <div className="assignment-editor-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={e.disabled || e.readOnly}
        onChange={(event) =>
          e.change(path, nullable && !event.target.value ? null : event.target.value)
        }
      >
        {nullable && <option value="">None</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function Entity({
  id,
  title,
  children,
  related,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  related?: React.ReactNode;
}) {
  const e = useEditor();
  const main = useRef<HTMLDivElement>(null);
  const selected = e.selected === id;
  const close = () => {
    main.current?.querySelector<HTMLElement>('textarea, select, button')?.focus();
    e.select(null);
  };
  return (
    <div className={`assignment-editor-entity${selected ? ' is-selected' : ''}`}>
      <div
        ref={main}
        onFocusCapture={(event) => {
          if (
            related &&
            (event.target instanceof HTMLTextAreaElement ||
              event.target instanceof HTMLSelectElement)
          )
            e.select(id);
        }}
      >
        {children}
        {related && (
          <button
            type="button"
            className="assignment-editor-related"
            aria-label={`${e.readOnly ? 'View' : 'Edit'} related fields · ${title}`}
            onClick={() => e.select(selected ? null : id)}
            aria-expanded={selected}
          >
            Details
          </button>
        )}
      </div>
      {selected && related && (
        <aside className="assignment-editor-context" aria-label={`${title} related fields`}>
          <div className="assignment-editor-context-heading">
            <h4>{title}</h4>
            <button type="button" onClick={close} aria-label="Close related fields">
              ×
            </button>
          </div>
          {related}
        </aside>
      )}
    </div>
  );
}

function focusPath(e: EditorContext, path: EditorPath, list: EditorPath) {
  e.scheduleFocus(() => {
    const prefix = fieldKey(path);
    const field = [...e.fields.current].find(
      ([key]) => key === prefix || key.startsWith(`${prefix}.`),
    )?.[1];
    if (field) field.focus();
    else document.getElementById(`assignment-add-${fieldKey(list)}`)?.focus();
  });
}

function ItemActions({
  path,
  index,
  minimum = 0,
  label,
}: {
  path: EditorPath;
  index: number;
  minimum?: number;
  label: string;
}) {
  const e = useEditor();
  const items = editorValue(e.assignment, path) as unknown[];
  if (e.readOnly) return null;
  const move = (offset: number) => {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    e.change(path, next);
    e.select(fieldKey([...path, index + offset]));
    focusPath(e, [...path, index + offset], path);
  };
  const remove = () => {
    e.change(
      path,
      items.filter((_, i) => i !== index),
    );
    e.select(fieldKey([...path, Math.max(0, Math.min(index, items.length - 2))]));
    focusPath(e, [...path, Math.max(0, Math.min(index, items.length - 2))], path);
  };
  return (
    <div className="assignment-editor-item-actions">
      <button
        type="button"
        disabled={e.disabled || index === 0}
        onClick={() => move(-1)}
        aria-label={`Move ${label} up`}
      >
        ↑
      </button>
      <button
        type="button"
        disabled={e.disabled || index === items.length - 1}
        onClick={() => move(1)}
        aria-label={`Move ${label} down`}
      >
        ↓
      </button>
      <button
        type="button"
        disabled={e.disabled || items.length <= minimum}
        onClick={remove}
        title={
          items.length <= minimum
            ? `Keep at least ${minimum} ${minimum === 1 ? 'item' : 'items'} in this list.`
            : undefined
        }
        aria-label={`Remove ${label}`}
      >
        Remove
      </button>
      {items.length <= minimum && <small>At least {minimum} required</small>}
    </div>
  );
}

function AddItem({ path, value, label }: { path: EditorPath; value: unknown; label: string }) {
  const e = useEditor();
  if (e.readOnly) return null;
  return (
    <button
      type="button"
      id={`assignment-add-${fieldKey(path)}`}
      className="assignment-editor-add"
      aria-label={label}
      disabled={e.disabled}
      onClick={() => {
        const items = editorValue(e.assignment, path) as unknown[];
        e.change(path, [...items, structuredClone(value)]);
        e.select(fieldKey([...path, items.length]));
        focusPath(e, [...path, items.length], path);
      }}
    >
      + {label}
    </button>
  );
}

function TextList({
  path,
  label,
  minimum = 0,
  domainProblem,
}: {
  path: EditorPath;
  label: string;
  minimum?: number;
  domainProblem?: string;
}) {
  const e = useEditor();
  const items = editorValue(e.assignment, path) as string[];
  return (
    <div className="assignment-editor-list">
      <h5>{label}</h5>
      {items.map((_, i) => (
        <div key={i}>
          <TextField
            path={[...path, i]}
            label={`${label} ${i + 1}`}
            domainProblem={domainProblem}
          />
          <ItemActions path={path} index={i} minimum={minimum} label={`${label} ${i + 1}`} />
        </div>
      ))}
      <AddItem path={path} value="" label={`Add ${label.toLowerCase()}`} />
    </div>
  );
}

function Questions({ path, title }: { path: EditorPath; title: string }) {
  const e = useEditor();
  const items = editorValue(e.assignment, path) as FreshAssignmentV1['practice'][number]['items'];
  return (
    <>
      <ol className="assignment-editor-questions">
        {items.map((_, i) => {
          const item = [...path, i];
          return (
            <li key={i}>
              <Entity
                id={fieldKey(item)}
                title={`${title} · Item ${i + 1}`}
                related={
                  <>
                    <p className="assignment-editor-hint">
                      Answers and explanations appear in the learner answer key.
                    </p>
                    <TextField path={[...item, 'answer']} label="Answer" />
                    <TextField path={[...item, 'explanation']} label="Explanation" optional />
                  </>
                }
              >
                <TextField path={[...item, 'prompt']} label={`${title} · Prompt ${i + 1}`} />
                <ItemActions
                  path={path}
                  index={i}
                  minimum={path[0] === 'practice' ? 1 : 0}
                  label={`${title} item ${i + 1}`}
                />
              </Entity>
            </li>
          );
        })}
      </ol>
      <AddItem
        path={path}
        value={{ prompt: '', answer: '', explanation: null }}
        label={`Add ${title.toLowerCase()} item`}
      />
    </>
  );
}

function Practice() {
  const e = useEditor();
  return (
    <section id="editor-practice">
      <h2>4. Practice</h2>
      {e.assignment.practice.map((_group, i) => (
        <div className="assignment-editor-group" key={i}>
          <Entity id={`practice.${i}`} title={`Group ${i + 1}`}>
            <TextField
              path={['practice', i, 'title']}
              label={`Group ${i + 1} title`}
              optional
              compact
            />
            <TextField
              path={['practice', i, 'instructions']}
              label={`Group ${i + 1} instructions`}
              optional
            />
            <ItemActions path={['practice']} index={i} minimum={1} label={`group ${i + 1}`} />
          </Entity>
          <Questions path={['practice', i, 'items']} title={`Group ${i + 1}`} />
        </div>
      ))}
    </section>
  );
}

interface AssignmentEditorProps {
  text: string;
  onChange: (text: string) => void;
  validationContext?: AssignmentValidationContext;
  readOnly?: boolean;
  disabled?: boolean;
  saveStatus: string;
}

export function AssignmentEditor({
  text,
  onChange,
  validationContext,
  readOnly = false,
  disabled = false,
  saveStatus,
}: AssignmentEditorProps) {
  const assignment = useMemo(() => readEditorAssignment(text), [text]);
  const [selected, select] = useState<string | null>(null);
  const [learnerView, setLearnerView] = useState(false);
  const [notes, showNotes] = useState(false);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const typing = useRef<{ key: string; time: number } | null>(null);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const focus = useRef<Focus | null>(null);
  const focusFrame = useRef<number | null>(null);
  const scheduleFocus = (work: () => void) => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      work();
    });
  };
  useEffect(
    () => () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );
  const snapshot = (): Snapshot => ({
    text,
    selected,
    focus: focus.current ? { ...focus.current } : null,
  });
  const restore = (entry: Snapshot) => {
    select(entry.selected);
    if (entry.focus?.field.startsWith('teacher')) showNotes(true);
    onChange(entry.text);
    typing.current = null;
    scheduleFocus(() => {
      const field = entry.focus && fields.current.get(entry.focus.field);
      if (field && entry.focus) {
        field.focus();
        field.setSelectionRange(entry.focus.start, entry.focus.end);
      }
    });
  };
  const undo = () => {
    const entry = history.past.at(-1);
    if (!entry || readOnly || disabled) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, snapshot()] });
    restore(entry);
  };
  const redo = () => {
    const entry = history.future.at(-1);
    if (!entry || readOnly || disabled) return;
    setHistory({ past: [...history.past, snapshot()], future: history.future.slice(0, -1) });
    restore(entry);
  };
  const commit = (next: FreshAssignmentV1, group?: string) => {
    if (disabled || readOnly || !assignment) return;
    const now = Date.now();
    const continuous = group && typing.current?.key === group && now - typing.current.time < 800;
    const previous = snapshot();
    setHistory((current) => ({
      past: continuous ? current.past : [...current.past, previous].slice(-100),
      future: [],
    }));
    typing.current = group ? { key: group, time: now } : null;
    onChange(JSON.stringify(next, null, 2));
  };
  const change = (path: EditorPath, value: unknown, continuous = false) => {
    if (assignment)
      commit(editAssignment(assignment, path, value), continuous ? fieldKey(path) : undefined);
  };
  const problem = useMemo(() => {
    if (!assignment) return null;
    try {
      if (!validationContext)
        throw new Error('Assignment validation context is missing. Reload the saved draft.');
      validateAssignmentV1(assignment, validationContext);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [assignment, validationContext]);
  const highlight = (remove = false) => {
    const target = focus.current;
    const field = target && fields.current.get(target.field);
    if (!assignment || !target || !field) return;
    const result = highlightSelection(field.value, target.start, target.end, remove);
    if (!result) return;
    const path = target.field.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    change(path, result.value);
    scheduleFocus(() => {
      field.focus();
      field.setSelectionRange(result.start, result.end);
    });
  };
  if (!assignment)
    return text.trim() ? (
      <p className="minimal-muted">
        This saved format is available through its existing learner preview. Visual editing requires
        a current-format assignment.
      </p>
    ) : null;
  const context: EditorContext = {
    assignment,
    disabled,
    readOnly,
    selected,
    select,
    change,
    endTyping: () => {
      typing.current = null;
    },
    scheduleFocus,
    fields,
    focus,
    suppliedUrls: validationContext?.suppliedUrls ?? [],
  };
  return (
    <Context.Provider value={context}>
      <div
        className="assignment-editor"
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            event.key.toLowerCase() === 'z' &&
            !readOnly &&
            !learnerView
          ) {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
          }
        }}
      >
        <div className="assignment-editor-toolbar" aria-label="Assignment editor tools">
          <strong>{assignment.metadata.title || 'Assignment'}</strong>
          <span role="status" aria-live="polite">
            {problem && !readOnly ? 'Changes not saved · fix fields' : saveStatus}
          </span>
          {!readOnly && !learnerView && (
            <>
              <button type="button" onClick={undo} disabled={disabled || !history.past.length}>
                Undo
              </button>
              <button type="button" onClick={redo} disabled={disabled || !history.future.length}>
                Redo
              </button>
              <button type="button" disabled={disabled} onClick={() => highlight()}>
                Highlight
              </button>
              <button type="button" disabled={disabled} onClick={() => highlight(true)}>
                Remove highlight
              </button>
            </>
          )}
          {!learnerView && (
            <button type="button" aria-pressed={notes} onClick={() => showNotes(!notes)}>
              Teacher notes
            </button>
          )}
          <button
            type="button"
            onClick={() => setLearnerView(!learnerView)}
            disabled={!learnerView && Boolean(problem)}
            aria-pressed={learnerView}
          >
            {learnerView ? (readOnly ? 'Reference view' : 'Edit') : 'Learner view'}
          </button>
          <label>
            Sections{' '}
            <select
              aria-label="Go to assignment section"
              defaultValue=""
              onChange={(event) =>
                document
                  .getElementById(event.target.value)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              <option value="" disabled>
                Go to…
              </option>
              {['goal', 'input', 'toolkit', 'practice', 'pronunciation', 'output', 'rationale'].map(
                (section) => (
                  <option
                    key={section}
                    value={`${learnerView ? `assignment-section-${{ goal: 1, input: 2, toolkit: 3, practice: 4, pronunciation: 4, output: 5, rationale: 6 }[section]}` : `editor-${section}`}`}
                  >
                    {section}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {learnerView && !problem ? (
          <LearnerHandout assignment={assignment} presentation={{ preview: true }} />
        ) : (
          <>
            {problem && (
              <div className="assignment-editor-errors" role="alert">
                <strong>Changes have not saved. Fix the fields below.</strong>
                <p>{problem.replace(/^AssignmentV1 (?:domain|schema) validation failed: /, '')}</p>
              </div>
            )}
            <p className="assignment-editor-hint">
              Edit the workbook; select an item for its related fields. Audio is not regenerated
              while editing. Learner view does not replace the final preview in step 5.
            </p>
            {notes && (
              <div className="assignment-editor-notes" aria-label="Assignment teaching notes">
                <h3>Assignment teaching notes</h3>
                <p>
                  Private teaching material for this assignment, separate from the generation
                  guidance in step 3.
                </p>
                <TextField path={['teacherRationale']} label="Teacher rationale" optional />
                <TextField path={['teacherFollowUp', 'warmUp']} label="Next-lesson warm-up" />
                <TextField path={['teacherFollowUp', 'correctionFocus']} label="Correction focus" />
              </div>
            )}
            <div className="assignment-editor-workbook">
              <Metadata />
              <section id="editor-goal">
                <h2>1. Your goal</h2>
                <TextField path={['mission', 'goal']} label="Goal" />
                <TextList path={['mission', 'keyLanguage']} label="Key language" minimum={1} />
              </section>
              <InputMaterial />
              <Toolkit />
              <Practice />
              <PronunciationEditor />
              <OutputEditor />
              <section id="editor-rationale">
                <h2>6. Why this helps</h2>
                <TextField path={['learnerRationale']} label="Learner rationale" />
              </section>
              <p className="assignment-editor-hint">
                The learner answer key includes comprehension and practice answers and the sample
                response. Open Learner view to check their presentation.
              </p>
            </div>
          </>
        )}
      </div>
    </Context.Provider>
  );
}

function Metadata() {
  const { assignment: a } = useEditor();
  return (
    <Entity
      id="metadata"
      title="Assignment details"
      related={
        <>
          <TextField path={['metadata', 'icon']} label="Icon" compact />
          <TextField path={['metadata', 'topic']} label="Topic" compact />
          <TextField path={['metadata', 'level']} label="Level" compact />
          <TextField path={['metadata', 'instructionLanguage']} label="Support language" compact />
          <p>Student: {a.metadata.student} (canonical identity)</p>
        </>
      }
    >
      <TextField path={['metadata', 'title']} label="Assignment title" compact />
    </Entity>
  );
}

function InputMaterial() {
  const e = useEditor();
  const study = e.assignment.input.studyText;
  return (
    <section id="editor-input">
      <h2>2. Listen and read</h2>
      <Entity
        id="input.source"
        title="Source and media"
        related={
          <>
            <p>
              Source type: {e.assignment.input.kind}. Only URLs supplied with the source can be
              selected.
            </p>
            <Choice
              path={['input', 'source', 'url']}
              label="Source URL"
              options={e.suppliedUrls}
              nullable
            />
            {e.assignment.input.media.map((media, i) => (
              <Choice
                key={i}
                path={['input', 'media', i, 'url']}
                label={`${media.kind} URL ${i + 1}`}
                options={e.suppliedUrls}
              />
            ))}
          </>
        }
      >
        <TextField path={['input', 'source', 'title']} label="Source title" optional compact />
        <TextField path={['input', 'source', 'attribution']} label="Source attribution" optional />
      </Entity>
      <h3>Study text · {study.type}</h3>
      <p className="assignment-editor-hint">
        The existing speaker set and text type stay fixed. Renaming a speaker keeps their turns
        linked.
      </p>
      {study.speakers.map((speaker, i) => (
        <Entity
          key={speaker.id}
          id={`speaker.${speaker.id}`}
          title={`Speaker ${i + 1}`}
          related={
            <>
              <TextField
                path={['input', 'studyText', 'speakers', i, 'role']}
                label="Speaker role"
              />
              <TextField
                path={['input', 'studyText', 'speakers', i, 'persona']}
                label="Persona"
                optional
              />
              <TextField
                path={['input', 'studyText', 'speakers', i, 'voiceDirection']}
                label="Voice direction"
                optional
              />
              <Choice
                path={['input', 'studyText', 'speakers', i, 'gender']}
                label="Voice gender"
                options={['male', 'female', 'neutral']}
              />
              <Choice
                path={['input', 'studyText', 'speakers', i, 'age']}
                label="Voice age"
                options={['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal']}
                nullable
              />
              <TextField
                path={['input', 'studyText', 'speakers', i, 'accent']}
                label="Accent"
                optional
              />
            </>
          }
        >
          <TextField
            path={['input', 'studyText', 'speakers', i, 'displayName']}
            label={`Speaker ${i + 1} name`}
            compact
          />
        </Entity>
      ))}
      {study.turns.map((turn, i) => (
        <div className="assignment-editor-turn" key={i}>
          <span className="assignment-editor-label">
            {study.speakers.find((speaker) => speaker.id === turn.speakerId)?.displayName}
          </span>
          <TextField
            path={['input', 'studyText', 'turns', i, 'text']}
            label={`${study.type === 'dialogue' ? 'Turn' : 'Paragraph'} ${i + 1}`}
          />
        </div>
      ))}
      <h3>Check your understanding</h3>
      <Questions path={['input', 'comprehension']} title="Comprehension" />
    </section>
  );
}

function Toolkit() {
  const e = useEditor();
  return (
    <section id="editor-toolkit">
      <h2>3. Grammar and vocabulary</h2>
      {e.assignment.toolkit.grammar.map((grammar, i) => {
        const path = ['toolkit', 'grammar', i];
        return (
          <div className="assignment-editor-group" key={i}>
            <TextField path={[...path, 'name']} label={`Grammar topic ${i + 1}`} compact />
            <TextField path={[...path, 'explanation']} label={`Grammar ${i + 1} explanation`} />
            {grammar.formBlocks.map((_, j) => (
              <div className="assignment-editor-subgroup" key={j}>
                <TextField
                  path={[...path, 'formBlocks', j, 'label']}
                  label={`Form ${j + 1} label`}
                  compact
                />
                <TextField
                  path={[...path, 'formBlocks', j, 'pattern']}
                  label={`Form ${j + 1} pattern`}
                />
                <TextList
                  path={[...path, 'formBlocks', j, 'examples']}
                  label={`Form ${j + 1} example`}
                  minimum={1}
                />
              </div>
            ))}
            {grammar.comparisons.map((comparison, j) => (
              <div className="assignment-editor-subgroup" key={j}>
                <TextField
                  path={[...path, 'comparisons', j, 'label']}
                  label={`Comparison ${j + 1}`}
                  compact
                />
                <div className="assignment-editor-pair">
                  {comparison.alternatives.map((_, k) => (
                    <div key={k}>
                      <TextField
                        path={[...path, 'comparisons', j, 'alternatives', k, 'label']}
                        label={`Alternative ${k + 1} label`}
                        compact
                      />
                      <TextField
                        path={[...path, 'comparisons', j, 'alternatives', k, 'example']}
                        label={`Alternative ${k + 1} example`}
                      />
                      <TextField
                        path={[...path, 'comparisons', j, 'alternatives', k, 'explanation']}
                        label={`Alternative ${k + 1} meaning`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <TextList path={[...path, 'examples']} label={`Grammar ${i + 1} example`} />
            {grammar.uses.map((_, j) => (
              <div className="assignment-editor-subgroup" key={j}>
                <TextField
                  path={[...path, 'uses', j, 'label']}
                  label={`Use ${j + 1} label`}
                  compact
                />
                <TextField path={[...path, 'uses', j, 'example']} label={`Use ${j + 1} example`} />
              </div>
            ))}
            {grammar.traps.map((_, j) => (
              <div className="assignment-editor-subgroup" key={j}>
                <TextField
                  path={[...path, 'traps', j, 'original']}
                  label={`Trap ${j + 1} original`}
                />
                <TextField
                  path={[...path, 'traps', j, 'improved']}
                  label={`Trap ${j + 1} corrected`}
                />
                <TextField
                  path={[...path, 'traps', j, 'explanation']}
                  label={`Trap ${j + 1} explanation`}
                />
              </div>
            ))}
          </div>
        );
      })}
      <h3>Useful vocabulary</h3>
      {e.assignment.toolkit.vocabulary.map((_, i) => (
        <div className="assignment-editor-subgroup" key={i}>
          <TextField
            path={['toolkit', 'vocabulary', i, 'expression']}
            label={`Vocabulary ${i + 1} expression`}
            compact
          />
          <TextField
            path={['toolkit', 'vocabulary', i, 'meaning']}
            label={`Vocabulary ${i + 1} meaning`}
          />
          <TextField
            path={['toolkit', 'vocabulary', i, 'example']}
            label={`Vocabulary ${i + 1} example`}
          />
          <ItemActions
            path={['toolkit', 'vocabulary']}
            index={i}
            minimum={1}
            label={`vocabulary ${i + 1}`}
          />
        </div>
      ))}
      <AddItem
        path={['toolkit', 'vocabulary']}
        value={{ expression: '', meaning: '', example: '' }}
        label="Add vocabulary entry"
      />
    </section>
  );
}

function PronunciationEditor() {
  const e = useEditor();
  const p = e.assignment.pronunciation;
  // Use contract validation to associate cross-field drill problems; saving has one authority.
  const drillProblems = useMemo(() => {
    if (!p || !('drills' in p)) return [];
    return p.drills.map((drill) => {
      try {
        validateAssignmentV1(
          { ...e.assignment, pronunciation: { ...p, drills: [drill] } },
          { suppliedUrls: e.suppliedUrls },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return {
          chunks: /chunks must reconstruct|requires chunks/.test(message)
            ? 'Chunks must reconstruct this drill text.'
            : undefined,
          stress: /stressedWords must occur|requires stressedWords/.test(message)
            ? 'Choose stressed words that occur in this drill text.'
            : undefined,
        };
      }
      return {};
    });
  }, [e.assignment, e.suppliedUrls, p]);
  if (!p) return null;
  const payload =
    p.mode === 'shadow_sentence'
      ? 'words'
      : p.mode === 'minimal_pair'
        ? 'pairs'
        : p.mode === 'connected_speech'
          ? 'lines'
          : 'drills';
  const path = ['pronunciation', payload];
  const items = editorValue(e.assignment, path) as unknown[];
  const word = (prefix: EditorPath, label: string, domainProblem?: string) => (
    <>
      <TextField path={[...prefix, 'text']} label={label} domainProblem={domainProblem} />
      <TextField path={[...prefix, 'transcription']} label={`${label} transcription`} optional />
    </>
  );
  const newItem =
    payload === 'words'
      ? { text: '', transcription: null }
      : payload === 'pairs'
        ? { left: { text: '', transcription: null }, right: { text: '', transcription: null } }
        : payload === 'lines'
          ? { careful: '', spoken: '' }
          : {
              text: '',
              transcription: null,
              chunks: p.mode === 'rhythm_chunking' ? [''] : [],
              stressedWords: p.mode === 'sentence_stress' ? [''] : [],
            };
  return (
    <section id="editor-pronunciation">
      <h2>Say it clearly</h2>
      <p className="assignment-editor-hint">
        Mode: {p.mode.replaceAll('_', ' ')}. Text edits do not regenerate audio.
      </p>
      {!e.readOnly && (
        <button
          type="button"
          disabled={e.disabled}
          onClick={() => e.change(['pronunciation'], null)}
        >
          Remove pronunciation
        </button>
      )}
      <TextField path={['pronunciation', 'target']} label="Pronunciation target" />
      <TextField path={['pronunciation', 'focus']} label="Pronunciation focus" />
      <TextField path={['pronunciation', 'action']} label="Pronunciation action" />
      <TextField path={['pronunciation', 'deliverable']} label="Pronunciation deliverable" />
      {'shadowSentence' in p && (
        <TextField path={['pronunciation', 'shadowSentence']} label="Shadow sentence" />
      )}
      {'naturalSentence' in p && (
        <TextField path={['pronunciation', 'naturalSentence']} label="Natural sentence" />
      )}
      {'contourCue' in p && (
        <TextField path={['pronunciation', 'contourCue']} label="Contour cue" optional />
      )}
      {items.map((_, i) => (
        <div className="assignment-editor-subgroup" key={i}>
          {payload === 'words' ? (
            word([...path, i], `Word ${i + 1}`)
          ) : payload === 'pairs' ? (
            <div className="assignment-editor-pair">
              <div>{word([...path, i, 'left'], `Pair ${i + 1} left`)}</div>
              <div>{word([...path, i, 'right'], `Pair ${i + 1} right`)}</div>
            </div>
          ) : payload === 'lines' ? (
            <>
              <TextField path={[...path, i, 'careful']} label={`Line ${i + 1} careful`} />
              <TextField path={[...path, i, 'spoken']} label={`Line ${i + 1} spoken`} />
            </>
          ) : (
            <>
              {word(
                [...path, i],
                `Drill ${i + 1}`,
                drillProblems[i]?.chunks ?? drillProblems[i]?.stress,
              )}
              <TextList
                path={[...path, i, 'chunks']}
                label={`Drill ${i + 1} chunk`}
                domainProblem={drillProblems[i]?.chunks}
                minimum={p.mode === 'rhythm_chunking' ? 1 : 0}
              />
              <TextList
                path={[...path, i, 'stressedWords']}
                label={`Drill ${i + 1} stressed word`}
                domainProblem={drillProblems[i]?.stress}
                minimum={p.mode === 'sentence_stress' ? 1 : 0}
              />
              <p className="assignment-editor-hint">
                Chunks must reconstruct the drill text; stressed words must occur in it.
              </p>
            </>
          )}
          <ItemActions path={path} index={i} minimum={1} label={`pronunciation item ${i + 1}`} />
        </div>
      ))}
      <AddItem path={path} value={newItem} label="Add pronunciation item" />
    </section>
  );
}

function OutputEditor() {
  return (
    <section id="editor-output">
      <h2>5. Your task</h2>
      <Entity
        id="outputTask"
        title="Output task"
        related={
          <>
            <TextField path={['outputTask', 'sampleResponse']} label="Sample response" />
            <p className="assignment-editor-hint">
              The sample response appears in the learner answer key.
            </p>
          </>
        }
      >
        <TextField path={['outputTask', 'task']} label="Main task" />
        <TextList path={['outputTask', 'preparation']} label="Preparation" />
        <TextList path={['outputTask', 'requirements']} label="Requirement" />
        <TextField path={['outputTask', 'delivery']} label="Delivery" optional />
        <TextList path={['outputTask', 'selfCheck']} label="Self-check" />
        <TextField path={['outputTask', 'extension']} label="Extension" optional />
      </Entity>
    </section>
  );
}
