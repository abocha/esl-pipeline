import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  GripVertical,
  Highlighter,
  Library,
  MessageSquare,
  NotebookPen,
  PencilLine,
  Redo2,
  Settings2,
  Target,
  Trash2,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { LearnerHandout } from '@esl-pipeline/learner-handout';
import '@esl-pipeline/learner-handout/handout.css';
import '@esl-pipeline/learner-handout/handout-interactions.js';

import {
  type AssignmentValidationContext,
  assignmentInlineParts,
  assignmentPlainText,
  type FreshAssignmentV1,
  validateAssignmentV1,
} from '@esl-pipeline/contracts';

import {
  type EditorSelection,
  EditorTextField,
  type EditorTextHandle,
} from './AssignmentEditor.field';
import {
  type EditorPath,
  editAssignment,
  editorValue,
  fieldKey,
  readEditorAssignment,
  textProblem,
} from './AssignmentEditor.model';
import './AssignmentEditor.css';

type Focus = { field: string; start: number; end: number };
type Snapshot = { text: string; selected: string | null; focus: Focus | null; route: string };
type History = { past: Snapshot[]; future: Snapshot[] };
type Drag = { list: string; from: number; to: number; x: number; y: number; label: string };
interface EditorContext {
  assignment: FreshAssignmentV1;
  disabled: boolean;
  readOnly: boolean;
  selected: string | null;
  select: (id: string | null) => void;
  change: (path: EditorPath, value: unknown, typing?: boolean) => boolean;
  endTyping: () => void;
  scheduleFocus: (work: () => void) => void;
  fields: React.RefObject<Map<string, EditorTextHandle>>;
  focus: React.RefObject<Focus | null>;
  suppliedUrls: readonly string[];
  selection: (selection: EditorSelection | null) => void;
  reveal: (path: EditorPath) => void;
  announce: (message: string) => void;
  drag: Drag | null;
  startDrag: (event: React.PointerEvent, path: EditorPath, index: number, label: string) => void;
}
const Context = createContext<EditorContext | null>(null);
function useEditor() {
  const e = useContext(Context);
  if (!e) throw new Error('Assignment editor context is missing');
  return e;
}
function InlineText({ value }: { value: string }) {
  return (
    <>
      {assignmentInlineParts(value).map((part, i) =>
        part.highlighted ? (
          <mark className="linguistic-highlight" key={i}>
            {part.text}
          </mark>
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
  const e = useEditor(),
    key = fieldKey(path),
    value = String(editorValue(e.assignment, path) ?? ''),
    problem = textProblem(value, path, optional) ?? domainProblem,
    id = `assignment-field-${key}`;
  const tail = path.at(-1),
    heading =
      (tail === 'name' && path[0] === 'toolkit') ||
      tail === 'label' ||
      (tail === 'title' && path[0] === 'practice');
  const className = `assignment-editor-field${compact ? ' is-compact' : ''}${heading ? ' is-heading' : ''}${value ? '' : ' is-empty'}`;
  if (e.readOnly)
    return (
      <div className={className}>
        <span className="assignment-editor-setting-label">{label}</span>
        <div className="assignment-editor-read-text">
          <InlineText value={value || '—'} />
        </div>
      </div>
    );
  return (
    <div className={className}>
      <label className="assignment-editor-setting-label" htmlFor={id}>
        {label}
      </label>
      <EditorTextField
        id={id}
        field={key}
        label={label}
        value={value}
        disabled={e.disabled}
        problem={problem}
        placeholder={
          optional
            ? path.at(-1) === 'explanation'
              ? 'Add explanation'
              : `Add ${label.toLowerCase()}`
            : label
        }
        ref={(handle) => {
          if (handle) e.fields.current.set(key, handle);
          else e.fields.current.delete(key);
        }}
        onChange={(next, typing) =>
          e.change(path, optional && !assignmentPlainText(next).trim() ? null : next, typing)
        }
        onRemember={(selection) => {
          e.focus.current = { field: key, ...selection };
        }}
        onSelection={e.selection}
        onEndTyping={e.endTyping}
      />
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
  const e = useEditor(),
    main = useRef<HTMLDivElement>(null),
    open = e.selected === id;
  return (
    <div className="assignment-editor-entity">
      <div ref={main}>
        {children}
        {related && (
          <button
            type="button"
            className="assignment-editor-related"
            aria-label={`${e.readOnly ? 'View' : 'Edit'} related fields · ${title}`}
            aria-expanded={open}
            onClick={() => e.select(open ? null : id)}
          >
            <Settings2 size={14} />
            {title === 'Source and media'
              ? 'Source & media'
              : title.startsWith('Speaker')
                ? 'Speaker settings'
                : title}
          </button>
        )}
      </div>
      {open && related && (
        <aside className="assignment-editor-context" aria-label={`${title} related fields`}>
          <div className="assignment-editor-context-heading">
            <h3>{title}</h3>
            <button
              type="button"
              aria-label="Close related fields"
              onClick={() => {
                e.select(null);
                main.current?.querySelector<HTMLElement>('[role="textbox"],select,button')?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {related}
        </aside>
      )}
    </div>
  );
}
function focusPath(e: EditorContext, path: EditorPath, list: EditorPath) {
  e.reveal(path);
  e.scheduleFocus(() => {
    const prefix = fieldKey(path),
      field = [...e.fields.current].find(
        ([key]) => key === prefix || key.startsWith(`${prefix}.`),
      )?.[1];
    if (field) field.focus();
    else document.getElementById(`assignment-add-${fieldKey(list)}`)?.focus();
  });
}
function EditorItem({
  path,
  index,
  minimum = 0,
  label,
  children,
  as = 'div',
  className = '',
}: {
  path: EditorPath;
  index: number;
  minimum?: number;
  label: string;
  children: React.ReactNode;
  as?: 'div' | 'li';
  className?: string;
}) {
  const e = useEditor(),
    [menu, setMenu] = useState(false),
    items = editorValue(e.assignment, path) as unknown[],
    key = fieldKey(path),
    Tag = as;
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (
        event.type === 'pointerdown' &&
        (event.target as Element).closest('.assignment-editor-item-menu,.assignment-editor-grip')
      )
        return;
      setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  const move = (offset: number) => {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    if (e.change(path, next)) e.announce('Item moved');
    e.select(fieldKey([...path, index + offset]));
    setMenu(false);
    focusPath(e, [...path, index + offset], path);
  };
  const remove = () => {
    if (
      e.change(
        path,
        items.filter((_, i) => i !== index),
      )
    )
      e.announce('Item removed');
    const neighbor = Math.max(0, Math.min(index, items.length - 2));
    e.select(fieldKey([...path, neighbor]));
    setMenu(false);
    focusPath(e, [...path, neighbor], path);
  };
  const before = e.drag?.list === key && e.drag.to === index,
    after = e.drag?.list === key && e.drag.to === items.length && index === items.length - 1;
  return (
    <Tag
      className={`assignment-editor-item ${className}${e.drag?.list === key && e.drag.from === index ? ' is-dragging' : ''}`}
      data-editor-list={key}
      data-editor-index={index}
      onFocusCapture={() => {
        if (!e.readOnly) e.select(fieldKey([...path, index]));
      }}
    >
      {(before || after) && (
        <div className={`assignment-editor-drop${after ? ' is-after' : ''}`} aria-hidden="true" />
      )}
      {!e.readOnly && (
        <div className="assignment-editor-grip-slot">
          <button
            type="button"
            className="assignment-editor-grip"
            aria-label={`Actions for ${label}`}
            title={path.length === 1 ? 'Item actions' : 'Drag to move · Click for actions'}
            disabled={e.disabled}
            onPointerDown={(event) => e.startDrag(event, path, index, label)}
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
          >
            <GripVertical size={17} />
          </button>
          {menu && (
            <div className="assignment-editor-item-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={e.disabled || index === 0}
                aria-label={`Move ${label} up`}
                onClick={() => move(-1)}
              >
                <ArrowUp size={15} />
                Move up
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={e.disabled || index === items.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => move(1)}
              >
                <ArrowDown size={15} />
                Move down
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={e.disabled || items.length <= minimum}
                title={
                  items.length <= minimum
                    ? `Keep at least ${minimum} ${minimum === 1 ? 'item' : 'items'} in this list.`
                    : undefined
                }
                aria-label={`Remove ${label}`}
                onClick={remove}
              >
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      <div className="assignment-editor-item-content">{children}</div>
    </Tag>
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
  heading,
  minimum = 0,
  domainProblem,
}: {
  path: EditorPath;
  label: string;
  heading?: string;
  minimum?: number;
  domainProblem?: string;
}) {
  const e = useEditor(),
    items = editorValue(e.assignment, path) as string[];
  return (
    <div className="assignment-editor-list">
      <h3>
        {heading ??
          label
            .replace(/^Form \d+ example$/, 'Examples')
            .replace(/^Grammar \d+ example$/, 'Examples')}
      </h3>
      {items.map((_, i) => (
        <EditorItem key={i} path={path} index={i} minimum={minimum} label={`${label} ${i + 1}`}>
          <TextField
            path={[...path, i]}
            label={`${label} ${i + 1}`}
            domainProblem={domainProblem}
          />
        </EditorItem>
      ))}
      <AddItem path={path} value="" label={`Add ${label.toLowerCase()}`} />
    </div>
  );
}
function Questions({ path, title }: { path: EditorPath; title: string }) {
  const e = useEditor(),
    items = editorValue(e.assignment, path) as FreshAssignmentV1['practice'][number]['items'];
  return (
    <>
      <div className="assignment-editor-question-heading">
        <span />
        <span>Answer</span>
      </div>
      <ol className="assignment-editor-questions">
        {items.map((_, i) => {
          const item = [...path, i];
          return (
            <EditorItem
              as="li"
              key={i}
              path={path}
              index={i}
              minimum={path[0] === 'practice' ? 1 : 0}
              label={`${title} item ${i + 1}`}
              className="assignment-editor-question"
            >
              <div className="assignment-editor-question-prompt">
                <span className="assignment-editor-number">{i + 1}.</span>
                <TextField path={[...item, 'prompt']} label={`${title} · Prompt ${i + 1}`} />
              </div>
              <div className="assignment-editor-answer">
                <TextField path={[...item, 'answer']} label={`${title} · Answer ${i + 1}`} />
                <TextField
                  path={[...item, 'explanation']}
                  label={`${title} · Explanation ${i + 1}`}
                  optional
                />
              </div>
            </EditorItem>
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
function Practice({ index }: { index: number }) {
  const e = useEditor();
  if (!e.assignment.practice[index]) return null;
  return (
    <section id="editor-practice">
      <EditorItem
        path={['practice']}
        index={index}
        minimum={1}
        label={`group ${index + 1}`}
        className="assignment-editor-group-heading"
      >
        <TextField
          path={['practice', index, 'title']}
          label={`Group ${index + 1} title`}
          optional
          compact
        />
        <TextField
          path={['practice', index, 'instructions']}
          label={`Group ${index + 1} instructions`}
          optional
        />
      </EditorItem>
      <Questions path={['practice', index, 'items']} title={`Group ${index + 1}`} />
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
  toolbarActions?: React.ReactNode;
  onContinue?: () => void;
  continueDisabled?: boolean;
}
const sections = [
  ['goal', 'Your goal', Target],
  ['input', 'Listen and read', BookOpen],
  ['toolkit', 'Grammar & vocabulary', Library],
  ['practice', 'Practice', PencilLine],
  ['pronunciation', 'Say it clearly', Volume2],
  ['output', 'Your task', MessageSquare],
  ['rationale', 'Why this helps', BookOpen],
] as const;
const pathRoute = (path: EditorPath) =>
  path[0] === 'practice'
    ? `practice.${path[1] ?? 0}`
    : ({
        metadata: 'metadata',
        mission: 'goal',
        input: 'input',
        toolkit: 'toolkit',
        pronunciation: 'pronunciation',
        outputTask: 'output',
        learnerRationale: 'rationale',
        teacherRationale: 'notes',
        teacherFollowUp: 'notes',
      }[String(path[0])] ?? 'goal');
export function AssignmentEditor({
  text,
  onChange,
  validationContext,
  readOnly = false,
  disabled = false,
  saveStatus,
  toolbarActions,
  onContinue,
  continueDisabled,
}: AssignmentEditorProps) {
  const assignment = useMemo(() => readEditorAssignment(text), [text]);
  const hasAssignment = assignment !== null;
  const [selected, select] = useState<string | null>(null),
    [learnerView, setLearnerView] = useState(false),
    [route, setRoute] = useState('practice.0'),
    [history, setHistory] = useState<History>({ past: [], future: [] }),
    [floating, setFloating] = useState<EditorSelection | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [drag, setDrag] = useState<Drag | null>(null);
  const typing = useRef<{ key: string; time: number } | null>(null),
    fields = useRef(new Map<string, EditorTextHandle>()),
    focus = useRef<Focus | null>(null),
    focusFrame = useRef<number | null>(null),
    root = useRef<HTMLDivElement>(null),
    toolbar = useRef<HTMLElement>(null),
    formatButton = useRef<HTMLButtonElement>(null),
    dragging = useRef<{ x: number; y: number; moved: boolean; state: Drag } | null>(null),
    suppressClick = useRef(false),
    dragCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const host = root.current;
    const bar = toolbar.current;
    if (!hasAssignment || !host || !bar) return;
    const measure = () => {
      host.style.setProperty(
        '--assignment-editor-toolbar-height',
        `${bar.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      host.style.removeProperty('--assignment-editor-toolbar-height');
    };
  }, [hasAssignment]);
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
      dragCleanup.current?.();
    },
    [],
  );
  useEffect(() => {
    if (!assignment) return;
    const index = Number(route.split('.')[1]);
    if (route.startsWith('practice.') && index >= assignment.practice.length)
      setRoute(`practice.${Math.max(0, assignment.practice.length - 1)}`);
  }, [assignment, route]);
  const reveal = (path: EditorPath) => {
    setRoute(pathRoute(path));
    setLearnerView(false);
  };
  const snapshot = (): Snapshot => ({
    text,
    selected,
    focus: focus.current ? { ...focus.current } : null,
    route,
  });
  const restore = (entry: Snapshot) => {
    dragCleanup.current?.();
    select(entry.selected);
    setRoute(entry.route);
    setLearnerView(false);
    setFloating(null);
    setNotice(null);
    onChange(entry.text);
    typing.current = null;
    scheduleFocus(() => {
      if (entry.focus) fields.current.get(entry.focus.field)?.focus(entry.focus);
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
    if (disabled || readOnly || !assignment || JSON.stringify(next) === JSON.stringify(assignment))
      return false;
    dragCleanup.current?.();
    const now = Date.now(),
      continuous = group && typing.current?.key === group && now - typing.current.time < 800,
      previous = snapshot();
    setHistory((current) => ({
      past: continuous ? current.past : [...current.past, previous].slice(-100),
      future: [],
    }));
    typing.current = group ? { key: group, time: now } : null;
    setNotice(null);
    onChange(JSON.stringify(next, null, 2));
    return true;
  };
  const change = (path: EditorPath, value: unknown, continuous = false) =>
    assignment
      ? commit(editAssignment(assignment, path, value), continuous ? fieldKey(path) : undefined)
      : false;
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
  const highlight = () => {
    if (!floating || readOnly || disabled) return;
    fields.current.get(floating.field)?.format(floating.highlighted);
  };
  const startDrag = (event: React.PointerEvent, path: EditorPath, index: number, label: string) => {
    if (event.button !== 0 || disabled || readOnly || (path.length === 1 && path[0] === 'practice'))
      return;
    event.preventDefault();
    dragCleanup.current?.();
    setNotice(null);
    setFloating(null);
    window.getSelection()?.removeAllRanges();
    const list = fieldKey(path);
    dragging.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      state: { list, from: index, to: index, x: event.clientX, y: event.clientY, label },
    };
    const moving = (next: PointerEvent) => {
      const d = dragging.current;
      if (!d) return;
      if (Math.hypot(next.clientX - d.x, next.clientY - d.y) > 5) d.moved = true;
      if (!d.moved) return;
      const items = editorValue(assignment, path) as unknown[];
      let to = items.length;
      for (const row of root.current?.querySelectorAll<HTMLElement>('[data-editor-list]') ?? []) {
        if (row.dataset.editorList !== list || Number(row.dataset.editorIndex) === index) continue;
        const r = row.getBoundingClientRect();
        if (next.clientY < r.top + r.height / 2) {
          to = Number(row.dataset.editorIndex);
          break;
        }
      }
      d.state = { ...d.state, to, x: next.clientX, y: next.clientY };
      setDrag(d.state);
      if (next.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
      if (next.clientY < 110) window.scrollBy(0, -12);
    };
    const end = () => {
      const d = dragging.current;
      cleanup();
      if (d?.moved && assignment) {
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        const items = [...(editorValue(assignment, path) as unknown[])],
          item = items.splice(index, 1)[0],
          to = d.state.to > index ? d.state.to - 1 : d.state.to;
        items.splice(to, 0, item);
        if (change(path, items)) {
          setNotice('Item moved');
          select(fieldKey([...path, to]));
          reveal([...path, to]);
          scheduleFocus(() => {
            const prefix = fieldKey([...path, to]);
            [...fields.current]
              .find(([key]) => key === prefix || key.startsWith(`${prefix}.`))?.[1]
              .focus();
          });
        }
      }
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', moving);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', cleanup);
      dragging.current = null;
      setDrag(null);
      dragCleanup.current = null;
    };
    dragCleanup.current = cleanup;
    document.addEventListener('pointermove', moving);
    document.addEventListener('pointerup', end, { once: true });
    document.addEventListener('pointercancel', cleanup, { once: true });
  };
  const scrollPreview = (next: string) => {
    const selector =
      next === 'pronunciation'
        ? '[data-assignment-pronunciation]'
        : `#assignment-section-${({ goal: 1, input: 2, toolkit: 3, output: 5, rationale: 6 } as Record<string, number>)[next] ?? 4}`;
    root.current?.querySelector<HTMLElement>(selector)?.scrollIntoView?.({ block: 'start' });
  };
  const navigate = (next: string) => {
    setRoute(next);
    setFloating(null);
    select(null);
    typing.current = null;
    window.getSelection()?.removeAllRanges();
    if (learnerView) {
      if (next === 'metadata' || next === 'notes') setLearnerView(false);
      else scheduleFocus(() => scrollPreview(next));
    }
  };
  const toggleView = () => {
    const next = !learnerView;
    if (next && problem) return;
    setFloating(null);
    select(null);
    setLearnerView(next);
    scheduleFocus(() => {
      if (next) scrollPreview(route);
      else {
        root.current
          ?.querySelector<HTMLElement>('.assignment-editor-workbook')
          ?.scrollIntoView?.({ block: 'nearest' });
        if (focus.current) fields.current.get(focus.current.field)?.focus(focus.current);
      }
    });
  };
  const fixProblem = () => {
    const match = problem?.match(
      /(?:assignment\.)?((?:metadata|mission|input|toolkit|practice|pronunciation|outputTask|learnerRationale|teacherRationale|teacherFollowUp)[\w.[\]]*)/,
    );
    if (match) {
      const path = match[1]!
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
      reveal(path);
      if (path[0] === 'input' && path[1] === 'source') select('input.source');
      if (path[0] === 'input' && path[1] === 'studyText' && path[2] === 'speakers') {
        const speaker = assignment?.input.studyText.speakers[Number(path[3])];
        if (speaker) select(`speaker.${speaker.id}`);
      }
      scheduleFocus(() => {
        const key = fieldKey(path);
        fields.current.get(key)?.focus();
      });
    } else root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
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
    selection: (selection) => {
      if (!selection) {
        setFloating(null);
        return;
      }
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      setFloating({
        ...selection,
        x: Math.max(bounds.left + 90, Math.min(bounds.right - 100, selection.x)) - bounds.left,
        y: selection.y - bounds.top,
      });
    },
    reveal,
    announce: setNotice,
    drag,
    startDrag,
  };
  const practiceIndex = Number(route.split('.')[1] ?? 0);
  return (
    <Context.Provider value={context}>
      <div
        ref={root}
        className="assignment-editor"
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            event.key.toLowerCase() === 'z' &&
            !readOnly &&
            !learnerView
          ) {
            event.preventDefault();
            event.shiftKey ? redo() : undo();
          }
          if (event.key === 'Escape') {
            setFloating(null);
            select(null);
            dragCleanup.current?.();
          }
          if (
            event.key === 'Tab' &&
            !event.shiftKey &&
            floating &&
            formatButton.current &&
            (event.target as Element).closest('[contenteditable="true"]')
          ) {
            event.preventDefault();
            formatButton.current?.focus();
          }
        }}
      >
        <header
          ref={toolbar}
          className="assignment-editor-toolbar"
          aria-label="Assignment editor tools"
        >
          <div className="assignment-editor-title">
            {learnerView ? (
              <strong>
                <InlineText value={assignment.metadata.title} />
              </strong>
            ) : (
              <TextField path={['metadata', 'title']} label="Assignment title" compact />
            )}
            <span>
              {assignment.metadata.student} · {assignment.metadata.level}
            </span>
          </div>
          <span role="status" aria-live="polite" className={problem ? 'is-unsaved' : ''}>
            {problem && !readOnly ? 'Changes not saved · fix fields' : saveStatus}
          </span>
          {!readOnly && !learnerView && (
            <div className="assignment-editor-history">
              <button
                type="button"
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                onClick={undo}
                disabled={disabled || !history.past.length}
              >
                <Undo2 size={18} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                onClick={redo}
                disabled={disabled || !history.future.length}
              >
                <Redo2 size={18} />
              </button>
            </div>
          )}
          {!readOnly && toolbarActions && (
            <div className="assignment-editor-toolbar-actions">{toolbarActions}</div>
          )}
          <div className="assignment-editor-view-switch">
            <button
              type="button"
              aria-pressed={!learnerView}
              onClick={() => {
                if (learnerView) toggleView();
              }}
            >
              {readOnly ? 'Reference' : 'Edit'}
            </button>
            <button
              type="button"
              aria-label="Learner view"
              aria-pressed={learnerView}
              disabled={!learnerView && Boolean(problem)}
              onClick={() => {
                if (!learnerView) toggleView();
              }}
            >
              Learner preview
            </button>
          </div>
          {onContinue && !readOnly && (
            <button
              type="button"
              aria-label="Confirm and continue to review"
              className="assignment-editor-continue"
              disabled={continueDisabled || disabled}
              onClick={onContinue}
            >
              Continue to review
              <ArrowRight size={15} />
            </button>
          )}
        </header>
        <div className="assignment-editor-layout">
          <nav className="assignment-editor-outline" aria-label="Assignment sections">
            {sections.map(([id, label, Icon]) => (
              <React.Fragment key={id}>
                {(id !== 'pronunciation' || assignment.pronunciation) && (
                  <button
                    type="button"
                    aria-current={
                      route === id || (id === 'practice' && route.startsWith('practice.'))
                        ? 'page'
                        : undefined
                    }
                    onClick={() => navigate(id === 'practice' ? 'practice.0' : id)}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                )}
                {id === 'practice' && (
                  <div className="assignment-editor-parts">
                    {assignment.practice.map((group, i) => (
                      <button
                        type="button"
                        key={i}
                        aria-current={route === `practice.${i}` ? 'page' : undefined}
                        onClick={() => navigate(`practice.${i}`)}
                      >
                        {group.title ? assignmentPlainText(group.title) : `Part ${i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </React.Fragment>
            ))}
            <div className="assignment-editor-outline-secondary">
              {!learnerView && (
                <button
                  type="button"
                  aria-current={route === 'notes' ? 'page' : undefined}
                  onClick={() => navigate('notes')}
                >
                  <NotebookPen size={17} />
                  Teacher notes
                </button>
              )}
              <button
                type="button"
                aria-current={route === 'metadata' ? 'page' : undefined}
                onClick={() => navigate('metadata')}
              >
                <Settings2 size={17} />
                Assignment details
              </button>
            </div>
          </nav>
          <div className="assignment-editor-content">
            {learnerView && !problem ? (
              <LearnerHandout assignment={assignment} presentation={{ preview: true }} />
            ) : (
              <>
                {problem && !readOnly && (
                  <div className="assignment-editor-errors" role="alert">
                    <span>Some edits need attention before they can save.</span>
                    <button type="button" onClick={fixProblem}>
                      Fix fields
                    </button>
                  </div>
                )}
                <div className="assignment-editor-workbook">
                  {route === 'metadata' ? (
                    <Metadata />
                  ) : route === 'notes' ? (
                    <section
                      className="assignment-editor-notes"
                      aria-label="Assignment teaching notes"
                    >
                      <h2>Teacher notes</h2>
                      <p className="assignment-editor-hint">
                        Private assignment notes. Generation guidance stays in step 3.
                      </p>
                      <h3>Teaching focus</h3>
                      <TextField path={['teacherRationale']} label="Teacher rationale" optional />
                      <h3>Next-lesson warm-up</h3>
                      <TextField path={['teacherFollowUp', 'warmUp']} label="Next-lesson warm-up" />
                      <h3>Listen for</h3>
                      <TextField
                        path={['teacherFollowUp', 'correctionFocus']}
                        label="Correction focus"
                      />
                    </section>
                  ) : route === 'goal' ? (
                    <section id="editor-goal">
                      <h2>Your goal</h2>
                      <div className="assignment-editor-hero">
                        <TextField path={['mission', 'goal']} label="Goal" />
                      </div>
                      <TextList
                        path={['mission', 'keyLanguage']}
                        label="Key language"
                        minimum={1}
                      />
                    </section>
                  ) : route === 'input' ? (
                    <InputMaterial />
                  ) : route === 'toolkit' ? (
                    <Toolkit />
                  ) : route.startsWith('practice.') ? (
                    <Practice index={practiceIndex} />
                  ) : route === 'pronunciation' ? (
                    <PronunciationEditor />
                  ) : route === 'output' ? (
                    <OutputEditor />
                  ) : (
                    <section id="editor-rationale">
                      <h2>Why this helps</h2>
                      <div className="assignment-editor-hero">
                        <TextField path={['learnerRationale']} label="Learner rationale" />
                      </div>
                    </section>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {floating && !learnerView && !readOnly && (!floating.multiline || floating.highlighted) && (
          <div
            className="assignment-editor-floating"
            role="toolbar"
            aria-label="Text formatting"
            style={{
              left: floating.x,
              top: floating.y - 10,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button type="button" ref={formatButton} onClick={highlight}>
              <Highlighter size={15} />
              {floating.highlighted ? 'Remove highlight' : 'Highlight'}
            </button>
          </div>
        )}
        {notice && !readOnly && (
          <div className="assignment-editor-notice" role="status">
            <Check size={15} />
            {notice}
            <button type="button" aria-label="Undo last item change" onClick={undo}>
              Undo
            </button>
            <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {drag && (
          <div
            className="assignment-editor-drag-ghost"
            style={{ left: Math.min(window.innerWidth - 250, drag.x + 15), top: drag.y + 12 }}
          >
            <GripVertical size={16} />
            {drag.label}
          </div>
        )}
      </div>
    </Context.Provider>
  );
}

function Metadata() {
  return (
    <section className="assignment-editor-metadata">
      <h2>Assignment details</h2>
      <div className="assignment-editor-metadata-grid">
        <TextField path={['metadata', 'icon']} label="Icon" compact />
        <TextField path={['metadata', 'topic']} label="Topic" compact />
        <TextField path={['metadata', 'level']} label="Level" compact />
        <TextField path={['metadata', 'instructionLanguage']} label="Support language" compact />
      </div>
    </section>
  );
}

function InputMaterial() {
  const e = useEditor();
  const study = e.assignment.input.studyText;
  return (
    <section id="editor-input">
      <h2>Listen and read</h2>
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
      <div className="assignment-editor-speakers">
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
                  options={[
                    'child',
                    'teen',
                    'young',
                    'adult',
                    'middle_aged',
                    'senior',
                    'universal',
                  ]}
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
      </div>
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
      <h2>Grammar & vocabulary</h2>
      {e.assignment.toolkit.grammar.map((grammar, i) => {
        const path = ['toolkit', 'grammar', i];
        return (
          <div className="assignment-editor-group" key={i}>
            <TextField path={[...path, 'name']} label={`Grammar topic ${i + 1}`} compact />
            <TextField path={[...path, 'explanation']} label={`Grammar ${i + 1} explanation`} />
            {grammar.formBlocks.map((_, j) => (
              <div className="assignment-editor-form" key={j}>
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
            {grammar.uses.length > 0 && <h3>In conversation</h3>}
            {grammar.uses.map((_, j) => (
              <div className="assignment-editor-usage" key={j}>
                <TextField
                  path={[...path, 'uses', j, 'label']}
                  label={`Use ${j + 1} label`}
                  compact
                />
                <TextField path={[...path, 'uses', j, 'example']} label={`Use ${j + 1} example`} />
              </div>
            ))}
            {grammar.traps.length > 0 && <h3>Watch out</h3>}
            {grammar.traps.map((_, j) => (
              <div className="assignment-editor-pair assignment-editor-correction" key={j}>
                <div>
                  <span className="assignment-editor-caption">Instead of</span>
                  <TextField
                    path={[...path, 'traps', j, 'original']}
                    label={`Trap ${j + 1} original`}
                  />
                </div>
                <div>
                  <span className="assignment-editor-caption">Say</span>
                  <TextField
                    path={[...path, 'traps', j, 'improved']}
                    label={`Trap ${j + 1} corrected`}
                  />
                  <TextField
                    path={[...path, 'traps', j, 'explanation']}
                    label={`Trap ${j + 1} explanation`}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <h3>Useful vocabulary</h3>
      {e.assignment.toolkit.vocabulary.map((_, i) => (
        <EditorItem
          className="assignment-editor-vocabulary"
          key={i}
          path={['toolkit', 'vocabulary']}
          index={i}
          minimum={1}
          label={`vocabulary ${i + 1}`}
        >
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
        </EditorItem>
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
    <div className="assignment-editor-pronunciation-word">
      <TextField path={[...prefix, 'text']} label={label} domainProblem={domainProblem} />
      <TextField path={[...prefix, 'transcription']} label={`${label} transcription`} optional />
    </div>
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
      <dl className="assignment-editor-pronunciation-brief">
        <div>
          <dt>Target</dt>
          <dd>
            <TextField path={['pronunciation', 'target']} label="Pronunciation target" />
          </dd>
        </div>
        <div>
          <dt>Focus</dt>
          <dd>
            <TextField path={['pronunciation', 'focus']} label="Pronunciation focus" />
          </dd>
        </div>
        <div>
          <dt>What to do</dt>
          <dd>
            <TextField path={['pronunciation', 'action']} label="Pronunciation action" />
          </dd>
        </div>
        <div>
          <dt>Goal</dt>
          <dd>
            <TextField path={['pronunciation', 'deliverable']} label="Pronunciation deliverable" />
          </dd>
        </div>
      </dl>
      <ol className="assignment-editor-pronunciation-items">
        {items.map((_, i) => (
          <EditorItem
            as="li"
            className="assignment-editor-pronunciation-item"
            key={i}
            path={path}
            index={i}
            minimum={1}
            label={`pronunciation item ${i + 1}`}
          >
            <div className="assignment-editor-pronunciation-row">
              <span className="assignment-editor-number">{i + 1}.</span>
              <div className="assignment-editor-pronunciation-material">
                {payload === 'words' ? (
                  word([...path, i], `Word ${i + 1}`)
                ) : payload === 'pairs' ? (
                  <div className="assignment-editor-pronunciation-pair">
                    {word([...path, i, 'left'], `Pair ${i + 1} left`)}
                    <span aria-hidden="true">—</span>
                    {word([...path, i, 'right'], `Pair ${i + 1} right`)}
                  </div>
                ) : payload === 'lines' ? (
                  <div className="assignment-editor-pronunciation-pair">
                    <TextField path={[...path, i, 'careful']} label={`Line ${i + 1} careful`} />
                    <span aria-hidden="true">→</span>
                    <TextField path={[...path, i, 'spoken']} label={`Line ${i + 1} spoken`} />
                  </div>
                ) : (
                  <>
                    {word(
                      [...path, i],
                      `Drill ${i + 1}`,
                      drillProblems[i]?.chunks ?? drillProblems[i]?.stress,
                    )}
                    <div className="assignment-editor-pronunciation-timing">
                      <TextList
                        path={[...path, i, 'chunks']}
                        label={`Drill ${i + 1} chunk`}
                        heading="Chunks"
                        domainProblem={drillProblems[i]?.chunks}
                        minimum={p.mode === 'rhythm_chunking' ? 1 : 0}
                      />
                      <TextList
                        path={[...path, i, 'stressedWords']}
                        label={`Drill ${i + 1} stressed word`}
                        heading="Stressed words"
                        domainProblem={drillProblems[i]?.stress}
                        minimum={p.mode === 'sentence_stress' ? 1 : 0}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </EditorItem>
        ))}
      </ol>
      <AddItem path={path} value={newItem} label="Add pronunciation item" />
      {('shadowSentence' in p || 'naturalSentence' in p) && (
        <div className="assignment-editor-pronunciation-sentence">
          <h3>Practise this sentence</h3>
          {'shadowSentence' in p && (
            <TextField path={['pronunciation', 'shadowSentence']} label="Shadow sentence" />
          )}
          {'naturalSentence' in p && (
            <TextField path={['pronunciation', 'naturalSentence']} label="Natural sentence" />
          )}
        </div>
      )}
      {'contourCue' in p && (
        <div className="assignment-editor-pronunciation-contour">
          <h3>Contour cue</h3>
          <TextField path={['pronunciation', 'contourCue']} label="Contour cue" optional />
        </div>
      )}
      {!e.readOnly && (
        <div className="assignment-editor-pronunciation-footer">
          <button
            className="assignment-editor-add"
            type="button"
            disabled={e.disabled}
            onClick={() => e.change(['pronunciation'], null)}
          >
            Remove pronunciation
          </button>
        </div>
      )}
    </section>
  );
}

function OutputEditor() {
  return (
    <section id="editor-output">
      <h2>Your task</h2>
      <div className="assignment-editor-hero">
        <TextField path={['outputTask', 'task']} label="Main task" />
      </div>
      <TextList path={['outputTask', 'preparation']} label="Preparation" />
      <TextList path={['outputTask', 'requirements']} label="Requirement" />
      <TextField path={['outputTask', 'delivery']} label="Delivery" optional />
      <TextList path={['outputTask', 'selfCheck']} label="Self-check" />
      <TextField path={['outputTask', 'extension']} label="Extension" optional />
      <h3>Sample response</h3>
      <TextField path={['outputTask', 'sampleResponse']} label="Sample response" />
    </section>
  );
}
