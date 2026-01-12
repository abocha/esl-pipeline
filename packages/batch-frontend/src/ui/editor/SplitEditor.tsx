import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';

import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';

type EditorLayout = 'split' | 'editor' | 'preview';

interface SplitEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export interface SplitEditorHandle {
  jumpToLine: (lineNumber: number) => void;
}

const LAYOUT_LABELS: Record<EditorLayout, string> = {
  split: 'Split',
  editor: 'Editor',
  preview: 'Preview',
};

export const SplitEditor = forwardRef<SplitEditorHandle, SplitEditorProps>(({ value, onChange }, ref) => {
  const [layout, setLayout] = useState<EditorLayout>('split');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef<null | 'editor' | 'preview'>(null);

  useImperativeHandle(ref, () => ({
    jumpToLine: (lineNumber: number) => {
      const view = editorViewRef.current;
      if (!view) return;
      const maxLine = view.state.doc.lines;
      const target = Math.min(Math.max(lineNumber, 1), maxLine);
      const line = view.state.doc.line(target);
      if (layout === 'preview') {
        setLayout('editor');
      }
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
      view.focus();
    },
  }), [layout]);

  useEffect(() => {
    const view = editorViewRef.current;
    const preview = previewRef.current;
    if (!view || !preview) return;
    if (layout !== 'split') return;

    const editorScroll = view.scrollDOM;
    const syncScroll = (source: HTMLElement, target: HTMLElement, tag: 'editor' | 'preview') => {
      if (syncingRef.current && syncingRef.current !== tag) return;
      syncingRef.current = tag;
      const sourceMax = source.scrollHeight - source.clientHeight;
      const targetMax = target.scrollHeight - target.clientHeight;
      const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;
      target.scrollTop = ratio * targetMax;
      globalThis.requestAnimationFrame(() => {
        if (syncingRef.current === tag) {
          syncingRef.current = null;
        }
      });
    };

    const onEditorScroll = () => syncScroll(editorScroll, preview, 'editor');
    const onPreviewScroll = () => syncScroll(preview, editorScroll, 'preview');

    editorScroll.addEventListener('scroll', onEditorScroll);
    preview.addEventListener('scroll', onPreviewScroll);

    return () => {
      editorScroll.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
    };
  }, [layout]);

  return (
    <section className="split-editor">
      <header className="split-editor-header">
        <div>
          <span className="eyebrow">Draft</span>
          <h3>Markdown editor</h3>
        </div>
        <div className="split-editor-toggle">
          {(Object.keys(LAYOUT_LABELS) as EditorLayout[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn-ghost btn-small ${layout === mode ? 'active' : ''}`}
              onClick={() => setLayout(mode)}
            >
              {LAYOUT_LABELS[mode]}
            </button>
          ))}
        </div>
      </header>

      <div data-testid="split-panels" className={`split-editor-panels ${layout}`}>
        <div className="split-editor-panel editor-panel">
          <MarkdownEditor
            value={value}
            onChange={onChange}
            onViewReady={(view) => {
              editorViewRef.current = view;
            }}
          />
        </div>
        <div className="split-editor-panel preview-panel">
          <div className="preview-shell" ref={previewRef}>
            <MarkdownPreview value={value} />
          </div>
        </div>
      </div>

      <style>{`
        .split-editor {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .split-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .split-editor-header h3 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .split-editor .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .split-editor-toggle {
          display: flex;
          gap: var(--space-2);
        }

        .split-editor-toggle .btn-ghost.active {
          background: var(--bg-primary);
          border: 1px solid var(--border-medium);
          box-shadow: var(--shadow-sm);
        }

        .split-editor-panels {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-4);
          align-items: stretch;
        }

        .split-editor-panels.editor,
        .split-editor-panels.preview {
          grid-template-columns: 1fr;
        }

        .split-editor-panels.editor .preview-panel,
        .split-editor-panels.preview .editor-panel {
          display: none;
        }

        .preview-shell {
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          padding: var(--space-3);
          min-height: 320px;
          overflow: auto;
        }

        .markdown-preview {
          font-size: var(--text-sm);
          line-height: var(--leading-relaxed);
          color: var(--text-primary);
        }

        .markdown-preview h1,
        .markdown-preview h2,
        .markdown-preview h3,
        .markdown-preview h4 {
          margin: var(--space-3) 0 var(--space-2);
          font-family: var(--font-display);
          color: var(--text-primary);
        }

        .markdown-preview p {
          margin: 0 0 var(--space-3);
        }

        .markdown-preview ul,
        .markdown-preview ol {
          margin: 0 0 var(--space-3) var(--space-4);
        }

        .markdown-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 0 0 var(--space-3);
        }

        .markdown-preview th,
        .markdown-preview td {
          border: 1px solid var(--border-light);
          padding: var(--space-2);
          text-align: left;
          vertical-align: top;
        }

        .markdown-preview thead th {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          font-weight: 600;
        }

        .markdown-preview blockquote {
          border-left: 3px solid var(--border-focus);
          padding-left: var(--space-3);
          color: var(--text-secondary);
          margin: 0 0 var(--space-3);
        }

        .markdown-preview code {
          background: var(--bg-tertiary);
          padding: 0 var(--space-1);
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
        }

        .markdown-preview pre {
          background: var(--bg-tertiary);
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          overflow: auto;
        }

        .markdown-preview pre code {
          background: transparent;
          padding: 0;
        }

        .split-editor .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .split-editor .error-text {
          color: var(--color-error-500);
          font-size: var(--text-sm);
        }

        @media (max-width: 900px) {
          .split-editor-panels {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
});

SplitEditor.displayName = 'SplitEditor';
