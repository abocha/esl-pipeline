import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { assignmentPlainText } from '@esl-pipeline/contracts';

import {
  caretPlaceholder,
  formatInlineSelection,
  inlineSelectionHighlighted,
  inlineValue,
  insertInlineText,
  renderInline,
  restoreTextSelection,
  type TextSelection,
  textSelection,
} from './AssignmentEditor.inline';

export interface EditorTextHandle {
  element: HTMLDivElement;
  focus: (selection?: TextSelection) => void;
  format: (remove: boolean) => boolean;
}
export interface EditorSelection extends TextSelection {
  field: string;
  x: number;
  y: number;
  highlighted: boolean;
  multiline: boolean;
}
interface Props {
  field: string;
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  problem?: string | null;
  placeholder?: string;
  onChange: (value: string, typing: boolean) => void;
  onSelection: (selection: EditorSelection | null) => void;
  onRemember: (selection: TextSelection) => void;
  onEndTyping: () => void;
}

export const EditorTextField = forwardRef<EditorTextHandle, Props>(function EditorTextField(
  {
    field,
    id,
    label,
    value,
    disabled,
    problem,
    placeholder,
    onChange,
    onSelection,
    onRemember,
    onEndTyping,
  },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const remember = () => {
    const node = root.current;
    if (!node) return;
    const selected = textSelection(node);
    if (!selected) return;
    onRemember(selected);
    if (disabled || selected.start === selected.end) {
      onSelection(null);
      return;
    }
    const selection = window.getSelection();
    const range = selection?.getRangeAt(0);
    const rect = range?.getBoundingClientRect?.() ?? node.getBoundingClientRect();
    onSelection({
      ...selected,
      field,
      x: rect.left + rect.width / 2,
      y: rect.top,
      highlighted: inlineSelectionHighlighted(node),
      multiline: /[\r\n]/.test(
        assignmentPlainText(inlineValue(node)).slice(selected.start, selected.end),
      ),
    });
  };
  const emit = (typing = true) => {
    if (!root.current || disabled) return;
    caretPlaceholder(root.current);
    remember();
    onChange(inlineValue(root.current), typing);
  };
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || composing.current || inlineValue(node) === value) return;
    const selection = document.activeElement === node ? textSelection(node) : null;
    renderInline(node, value);
    if (selection) restoreTextSelection(node, selection);
  }, [value]);
  useEffect(() => {
    const handler = () => {
      if (document.activeElement === root.current) remember();
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  });
  useImperativeHandle(ref, () => ({
    element: root.current!,
    focus(selection) {
      root.current?.focus({ preventScroll: true });
      if (root.current && selection) restoreTextSelection(root.current, selection);
    },
    format(remove) {
      if (!root.current || disabled) return false;
      const next = formatInlineSelection(root.current, remove);
      if (next === null) return false;
      remember();
      onChange(next, false);
      return true;
    },
  }));
  return (
    <div
      ref={root}
      id={id}
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      aria-invalid={Boolean(problem)}
      aria-describedby={problem ? `${id}-error` : undefined}
      data-editor-field={field}
      data-placeholder={placeholder}
      className="assignment-editor-text"
      contentEditable={!disabled}
      suppressContentEditableWarning
      tabIndex={disabled ? -1 : 0}
      onFocus={remember}
      onMouseUp={remember}
      onKeyUp={remember}
      onBlur={(event) => {
        onEndTyping();
        if (
          !(event.relatedTarget instanceof Element) ||
          !event.relatedTarget.closest('.assignment-editor-floating')
        )
          onSelection(null);
      }}
      onCompositionStart={() => {
        composing.current = true;
        onEndTyping();
      }}
      onCompositionEnd={() => {
        composing.current = false;
        emit(false);
        onEndTyping();
      }}
      onInput={() => {
        if (!composing.current) emit();
      }}
      onBeforeInput={(event) => {
        if (
          !composing.current &&
          ['insertParagraph', 'insertLineBreak'].includes(
            (event.nativeEvent as InputEvent).inputType,
          )
        ) {
          event.preventDefault();
          if (root.current) insertInlineText(root.current, '\n');
          emit();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        if (root.current) insertInlineText(root.current, event.clipboardData.getData('text/plain'));
        emit();
      }}
      onDrop={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) {
          event.preventDefault();
          if (root.current) insertInlineText(root.current, '\n');
          emit();
        }
        if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase()))
          event.preventDefault();
        if (event.key === 'Escape') {
          onSelection(null);
          window.getSelection()?.removeAllRanges();
          root.current?.blur();
        }
      }}
    />
  );
});
