import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  readOnly = false,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const suppressChangeRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || suppressChangeRef.current) return;
      const nextValue = update.state.doc.toString();
      onChange(nextValue);
    });

    const state = EditorState.create({
      doc: value,
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

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [onChange, readOnly]);

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

  return (
    <div className="markdown-editor">
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
