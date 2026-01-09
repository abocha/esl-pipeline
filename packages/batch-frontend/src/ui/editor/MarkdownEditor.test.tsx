import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('codemirror', () => ({
  basicSetup: [],
}));

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => [],
}));

const codemirrorMocks = vi.hoisted(() => {
  class MockDoc {
    text: string;

    constructor(text: string) {
      this.text = text;
    }

    toString() {
      return this.text;
    }

    get lines() {
      return this.text.split(/\r?\n/).length;
    }

    lineAt(pos: number) {
      const lines = this.text.split(/\r?\n/);
      let cursor = 0;
      for (const line of lines) {
        const start = cursor;
        const end = cursor + line.length;
        if (pos >= start && pos <= end) {
          return { from: start, to: end, text: line };
        }
        cursor = end + 1;
      }
      const last = lines.at(-1) ?? '';
      const from = Math.max(0, this.text.length - last.length);
      return { from, to: this.text.length, text: last };
    }

    line(number: number) {
      const lines = this.text.split(/\r?\n/);
      const index = Math.min(Math.max(number - 1, 0), lines.length - 1);
      const before = lines.slice(0, index).join('\n');
      const from = before.length > 0 ? before.length + 1 : 0;
      const text = lines[index] ?? '';
      const to = from + text.length;
      return { from, to, text };
    }

    replace(from: number, to: number, insert: string) {
      this.text = this.text.slice(0, from) + insert + this.text.slice(to);
    }
  }

  class MockEditorState {
    doc: MockDoc;
    extensions: unknown[];
    selection: { main: { from: number; to: number } };

    constructor(opts: { doc: string; extensions: unknown[] }) {
      this.doc = new MockDoc(opts.doc);
      this.extensions = opts.extensions;
      this.selection = { main: { from: 0, to: 0 } };
    }

    static create(opts: { doc: string; extensions: unknown[] }) {
      return new MockEditorState(opts);
    }

    sliceDoc(from: number, to: number) {
      return this.doc.toString().slice(from, to);
    }
  }

  class MockEditorView {
    state: MockEditorState;
    parent: HTMLElement;
    scrollDOM: HTMLElement;
    private listener?: (update: { docChanged: boolean; state: MockEditorState }) => void;

    static updateListener = {
      of: (fn: (update: { docChanged: boolean; state: MockEditorState }) => void) => ({
        __listener: fn,
      }),
    };
    static lineWrapping = {};
    static editable = {
      of: () => ({}),
    };

    constructor({ state, parent }: { state: MockEditorState; parent: HTMLElement }) {
      this.state = state;
      this.parent = parent;
      this.scrollDOM = document.createElement('div');
      const listener = state.extensions.find(
        (ext) => typeof ext === 'object' && ext !== null && '__listener' in ext,
      ) as { __listener?: (update: { docChanged: boolean; state: MockEditorState }) => void } | undefined;
      this.listener = listener?.__listener;
    }

    dispatch({
      changes,
      selection,
    }: {
      changes?: { from: number; to: number; insert: string };
      selection?: { anchor: number; head?: number };
    }) {
      if (changes) {
        this.state.doc.replace(changes.from, changes.to, changes.insert);
      }
      if (selection) {
        const anchor = selection.anchor;
        const head = selection.head ?? selection.anchor;
        this.state.selection = { main: { from: anchor, to: head } };
      }
      this.listener?.({ docChanged: Boolean(changes), state: this.state });
    }

    focus() {}
    destroy() {}
  }

  return { MockEditorState, MockEditorView };
});

vi.mock('@codemirror/state', () => ({
  EditorState: codemirrorMocks.MockEditorState,
}));

vi.mock('@codemirror/view', () => ({
  EditorView: codemirrorMocks.MockEditorView,
}));

import { MarkdownEditor } from './MarkdownEditor';

describe('MarkdownEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('applies bold formatting from toolbar', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="Hello" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(onChange).toHaveBeenCalled();
    const latest = onChange.mock.calls.at(-1)?.[0] as string;
    expect(latest).toContain('**');
  });

  it('inserts heading marker from toolbar', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="Hello" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));

    const latest = onChange.mock.calls.at(-1)?.[0] as string;
    expect(latest.startsWith('# ')).toBe(true);
  });
});
