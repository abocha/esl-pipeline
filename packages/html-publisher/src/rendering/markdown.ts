import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import toc from 'markdown-it-toc-done-right';

import { escapeHtml } from './shared.js';

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type ContainerPlugin = (md: MarkdownItInstance, name: string, options: unknown) => void;

const TASK_LIST_ITEM_MARKER_REGEX = /^\[( |x|X)\]\s+/;

export function createRenderer(): MarkdownItInstance {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
  });
  md.linkify.set({ fuzzyLink: true });

  md.use(anchor);
  md.use(toc, { listType: 'ul', containerClass: 'table-of-contents' });

  const containerPlugin = container as unknown as ContainerPlugin;

  md.use(containerPlugin, 'toggle', {
    validate: (params: string) => params.trim().startsWith('toggle '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^toggle\s+(.*)$/.exec(info);
      const label = match?.[1] ?? 'Details';
      if (tokens[idx]?.nesting === 1) {
        return `<details><summary>${escapeHtml(label)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.use(containerPlugin, 'callout', {
    validate: (params: string) => params.trim().startsWith('callout '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^callout\s+(.*)$/.exec(info);
      const icon = match?.[1] ?? 'Info';
      if (tokens[idx]?.nesting === 1) {
        return `<aside class="callout"><div class="icon">${escapeHtml(icon)}</div><div class="content">`;
      }
      return '</div></aside>';
    },
  });

  md.use(containerPlugin, 'study-text', {
    validate: (params: string) => params.trim().startsWith('study-text'),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^study-text\s*(.*)$/.exec(info);
      const label = match?.[1]?.trim();
      const summaryTitle = label ? `Study Text: ${label}` : 'Study Text';
      if (tokens[idx]?.nesting === 1) {
        return `<details class="study-text"><summary>${escapeHtml(summaryTitle)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.renderer.rules.heading_open = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `${rendered}<span class="heading-text">`;
  };

  md.renderer.rules.heading_close = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `</span>${rendered}`;
  };

  const defaultCodeInlineRule = md.renderer.rules.code_inline;
  const richInlineMarkdown = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: false,
  });
  md.renderer.rules.code_inline = (tokens, idx, renderOptions, env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    if ((token.markup || '').length !== 1) {
      if (defaultCodeInlineRule) {
        return defaultCodeInlineRule(tokens, idx, renderOptions, env, self);
      }
      return `<code>${md.utils.escapeHtml(token.content ?? '')}</code>`;
    }
    const richContent = richInlineMarkdown.renderInline(token.content ?? '');
    return `<code>${richContent}</code>`;
  };

  applyTaskListRule(md);
  applyH4OrderedListContinuationRule(md);

  return md;
}

function applyTaskListRule(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'task_list_checkboxes', (state) => {
    const listStack: number[] = [];
    const listItemStack: { tokenIndex: number; firstInlineSeen: boolean }[] = [];

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (!token) continue;

      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        listStack.push(index);
        continue;
      }
      if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
        listStack.pop();
        continue;
      }
      if (token.type === 'list_item_open') {
        listItemStack.push({ tokenIndex: index, firstInlineSeen: false });
        continue;
      }
      if (token.type === 'list_item_close') {
        listItemStack.pop();
        continue;
      }
      if (token.type !== 'inline') {
        continue;
      }
      if (listStack.length === 0 || listItemStack.length === 0) {
        continue;
      }

      const currentListItemContext = listItemStack.at(-1);
      if (!currentListItemContext || currentListItemContext.firstInlineSeen) {
        continue;
      }
      currentListItemContext.firstInlineSeen = true;

      const currentListIndex = listStack.at(-1);
      const currentListItemIndex = currentListItemContext.tokenIndex;
      if (currentListIndex === undefined || currentListItemIndex === undefined) {
        continue;
      }

      const listToken = state.tokens[currentListIndex];
      const listItemToken = state.tokens[currentListItemIndex];
      const previousToken = state.tokens[index - 1];
      if (!listToken || !listItemToken || typeof listItemToken.level !== 'number') {
        continue;
      }

      const isLeadParagraphInline =
        previousToken?.type === 'paragraph_open' && previousToken.level === listItemToken.level + 1;
      if (!isLeadParagraphInline) {
        continue;
      }

      const marker = TASK_LIST_ITEM_MARKER_REGEX.exec(token.content ?? '');
      if (!marker) {
        continue;
      }

      appendTokenClass(listToken, 'task-list');
      appendTokenClass(listItemToken, 'task-list-item');

      const checked = (marker[1] ?? '').toLowerCase() === 'x';
      token.content = token.content.replace(TASK_LIST_ITEM_MARKER_REGEX, '');

      const children = token.children ? [...token.children] : [];
      const firstChild = children[0];
      if (firstChild?.type === 'text') {
        firstChild.content = firstChild.content.replace(TASK_LIST_ITEM_MARKER_REGEX, '');
        if (firstChild.content.length === 0) {
          children.shift();
        }
      } else if (token.content.length > 0) {
        const textToken = new state.Token('text', '', 0);
        textToken.content = token.content;
        children.unshift(textToken);
      }

      const checkboxToken = new state.Token('html_inline', '', 0);
      checkboxToken.content = `<input type="checkbox" class="task-list-item-checkbox"${checked ? ' checked' : ''}> `;
      token.children = [checkboxToken, ...children];
    }
  });
}

function applyH4OrderedListContinuationRule(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'continue_ordered_lists_across_h4', (state) => {
    let lastOrderedListNextStart: number | null = null;
    let sawContinuationH4 = false;
    const orderedListStack: {
      level: number;
      start: number;
      itemCount: number;
      managed: boolean;
    }[] = [];

    const resetContinuation = () => {
      lastOrderedListNextStart = null;
      sawContinuationH4 = false;
    };

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (!token) continue;

      if (token.type === 'ordered_list_open') {
        const explicitStart = parseStartAttr(token);
        const shouldContinue =
          token.level === 0 &&
          explicitStart === 1 &&
          lastOrderedListNextStart !== null &&
          sawContinuationH4;
        const start =
          shouldContinue && lastOrderedListNextStart !== null
            ? lastOrderedListNextStart
            : explicitStart;
        if (shouldContinue) {
          token.attrSet('start', String(start));
        }
        orderedListStack.push({
          level: token.level,
          start,
          itemCount: 0,
          managed: token.level === 0,
        });
        if (token.level === 0) {
          sawContinuationH4 = false;
        }
        continue;
      }

      if (token.type === 'ordered_list_close') {
        const context = orderedListStack.pop();
        if (context?.managed) {
          lastOrderedListNextStart = context.start + context.itemCount;
          sawContinuationH4 = false;
        }
        continue;
      }

      if (token.type === 'list_item_open') {
        const currentList = orderedListStack.at(-1);
        if (currentList && token.level === currentList.level + 1) {
          currentList.itemCount += 1;
        }
        continue;
      }

      if (orderedListStack.length > 0) {
        continue;
      }

      if (token.level !== 0) {
        continue;
      }

      if (token.type === 'heading_open') {
        if (token.tag === 'h4' && lastOrderedListNextStart !== null) {
          sawContinuationH4 = true;
        } else if (/^h[1-3]$/.test(token.tag)) {
          resetContinuation();
        } else if (!/^h4$/.test(token.tag)) {
          resetContinuation();
        }
        continue;
      }

      if (
        token.type === 'heading_close' ||
        token.type === 'inline' ||
        token.type === 'paragraph_open' ||
        token.type === 'paragraph_close'
      ) {
        continue;
      }

      if (token.type === 'ordered_list_open') {
        continue;
      }

      resetContinuation();
    }
  });
}

function parseStartAttr(token: { attrGet: (name: string) => string | number | null }): number {
  const raw = token.attrGet('start');
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function appendTokenClass(
  token: {
    attrGet: (name: string) => string | number | null;
    attrSet: (name: string, value: string) => void;
  },
  className: string,
): void {
  const current = token.attrGet('class');
  if (!current) {
    token.attrSet('class', className);
    return;
  }

  const classes = new Set(String(current).split(/\s+/).filter(Boolean));
  classes.add(className);
  token.attrSet('class', [...classes].join(' '));
}
