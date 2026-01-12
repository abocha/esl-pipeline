import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onViewReady?: (view: EditorView | null) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  readOnly = false,
  onViewReady,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const suppressChangeRef = useRef(false);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onViewReadyRef = useRef(onViewReady);

  useEffect(() => {
    initialValueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onViewReadyRef.current = onViewReady;
  }, [onViewReady]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || suppressChangeRef.current) return;
      const nextValue = update.state.doc.toString();
      onChangeRef.current(nextValue);
    });

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        updateListener,
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });

    onViewReadyRef.current?.(viewRef.current);

    return () => {
      onViewReadyRef.current?.(null);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    suppressChangeRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    suppressChangeRef.current = false;
  }, [value]);

  const applyWrap = (prefix: string, suffix: string = prefix) => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const insert = `${prefix}${selected}${suffix}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + prefix.length,
        head: from + prefix.length + selected.length,
      },
    });
    view.focus();
  };

  const applyHeading = () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const hasHeading = line.text.startsWith('# ');
    const changes = hasHeading
      ? { from: line.from, to: line.from + 2, insert: '' }
      : { from: line.from, to: line.from, insert: '# ' };
    const shift = hasHeading ? -2 : 2;
    view.dispatch({
      changes,
      selection: {
        anchor: Math.max(line.from, from + shift),
      },
    });
    view.focus();
  };

  const applyLink = () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || 'link';
    const insert = `[${selected}](url)`;
    const urlStart = from + selected.length + 2;
    const urlEnd = urlStart + 3;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: urlStart,
        head: urlEnd,
      },
    });
    view.focus();
  };

  const applyInlineCode = () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || 'code';
    const insert = `\`${selected}\``;
    const codeStart = from + 1;
    const codeEnd = codeStart + selected.length;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: codeStart,
        head: codeEnd,
      },
    });
    view.focus();
  };

  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar">
        <button type="button" onClick={() => applyWrap('**')} disabled={readOnly}>
          Bold
        </button>
        <button type="button" onClick={() => applyWrap('*')} disabled={readOnly}>
          Italic
        </button>
        <button type="button" onClick={applyHeading} disabled={readOnly}>
          Heading
        </button>
        <button type="button" onClick={applyLink} disabled={readOnly}>
          Link
        </button>
        <button type="button" onClick={applyInlineCode} disabled={readOnly}>
          Code
        </button>
      </div>
      <div ref={hostRef} className="markdown-editor-host" />
      <style>{`
        .markdown-editor {
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          min-height: 320px;
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }

        .markdown-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-secondary);
        }

        .markdown-toolbar button {
          border: 1px solid var(--border-light);
          background: var(--bg-primary);
          color: var(--text-secondary);
          border-radius: var(--radius-full);
          padding: var(--space-1) var(--space-3);
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
          cursor: pointer;
        }

        .markdown-toolbar button:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: var(--border-medium);
        }

        .markdown-toolbar button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .markdown-editor .cm-editor {
          height: 100%;
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          color: var(--text-primary);
        }

        .markdown-editor .cm-scroller {
          font-family: var(--font-mono);
        }

        .markdown-editor .cm-content {
          padding: var(--space-3);
          line-height: var(--leading-relaxed);
        }

        .markdown-editor .cm-gutters {
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-light);
          color: var(--text-tertiary);
        }

        .markdown-editor .cm-activeLine {
          background: rgba(99, 102, 241, 0.08);
        }

        .markdown-editor .cm-selectionBackground {
          background: rgba(99, 102, 241, 0.2);
        }
      `}</style>
    </div>
  );
};
