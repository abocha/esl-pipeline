import { assignmentInlineParts } from '@esl-pipeline/contracts';

export type TextSelection = { start: number; end: number };
type Part = { text: string; highlighted: boolean };

/** A DOM projection of AssignmentV1 strings, never an HTML document format. */
function parts(root: Node): Part[] {
  const result: Part[] = [];
  const append = (text: string, highlighted: boolean) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.highlighted === highlighted) last.text += text;
    else result.push({ text, highlighted });
  };
  const walk = (node: Node, highlighted = false) => {
    const children = [...node.childNodes];
    children.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        append(child.textContent ?? '', highlighted);
        return;
      }
      if (!(child instanceof Element) || child.hasAttribute('data-caret-placeholder')) return;
      if (child.tagName === 'BR') {
        append('\n', false);
        return;
      }
      const block = child.tagName === 'DIV' || child.tagName === 'P';
      if (block && i > 0 && !result.at(-1)?.text.endsWith('\n')) append('\n', false);
      if (!(block && child.childNodes.length === 1 && child.firstChild?.nodeName === 'BR'))
        walk(child, highlighted || child.tagName === 'MARK');
      if (block && i < children.length - 1 && !result.at(-1)?.text.endsWith('\n'))
        append('\n', false);
    });
  };
  walk(root);
  return result;
}

export function inlineValue(root: Node): string {
  return parts(root)
    .map((part) =>
      part.highlighted
        ? part.text
            .split(/(\r?\n)/)
            .map((text) => (text && !/[`\r\n]/.test(text) ? `\`${text}\`` : text))
            .join('')
        : part.text,
    )
    .join('');
}

/** Inspect the selected contents, including ranges anchored on the field or a mark boundary. */
export function inlineSelectionHighlighted(root: HTMLElement): boolean {
  const selected = textSelection(root);
  if (!selected || selected.start === selected.end) return false;
  let offset = 0;
  return parts(root).every((part) => {
    const start = offset;
    offset += part.text.length;
    return offset <= selected.start || start >= selected.end || part.highlighted;
  });
}

export function caretPlaceholder(root: HTMLElement) {
  root.querySelectorAll('[data-caret-placeholder]').forEach((node) => {
    node.remove();
  });
  if (parts(root).at(-1)?.text.endsWith('\n')) {
    const br = document.createElement('br');
    br.dataset.caretPlaceholder = '';
    br.setAttribute('aria-hidden', 'true');
    root.append(br);
  }
}

export function renderInline(root: HTMLElement, value: string) {
  const fragment = document.createDocumentFragment();
  for (const part of assignmentInlineParts(value)) {
    part.text.split('\n').forEach((line, i) => {
      if (i) fragment.append(document.createElement('br'));
      if (!line) return;
      if (part.highlighted) {
        const mark = document.createElement('mark');
        mark.className = 'linguistic-highlight';
        mark.textContent = line;
        fragment.append(mark);
      } else fragment.append(document.createTextNode(line));
    });
  }
  root.replaceChildren(fragment);
  caretPlaceholder(root);
}

export function textSelection(root: HTMLElement): TextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const offset = (node: Node, end: number) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, end);
    return parts(prefix.cloneContents()).reduce((size, part) => size + part.text.length, 0);
  };
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
}

export function restoreTextSelection(root: HTMLElement, selection: TextSelection) {
  const nodes: Node[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) nodes.push(child);
      else if (child instanceof Element && !child.hasAttribute('data-caret-placeholder')) {
        if (child.tagName === 'BR') nodes.push(child);
        else walk(child);
      }
    }
  };
  walk(root);
  const range = document.createRange();
  const locate = (side: 'start' | 'end', wanted: number) => {
    let seen = 0;
    for (const node of nodes) {
      const isText = node.nodeType === Node.TEXT_NODE;
      const size = isText ? (node.textContent?.length ?? 0) : 1;
      if (wanted <= seen + size) {
        if (isText) {
          if (side === 'start') range.setStart(node, Math.max(0, wanted - seen));
          else range.setEnd(node, Math.max(0, wanted - seen));
        } else if (side === 'start') {
          if (wanted === seen) range.setStartBefore(node);
          else range.setStartAfter(node);
        } else if (wanted === seen) range.setEndBefore(node);
        else range.setEndAfter(node);
        return;
      }
      seen += size;
    }
    const end =
      root.childNodes.length -
      (root.lastElementChild?.hasAttribute('data-caret-placeholder') ? 1 : 0);
    if (side === 'start') range.setStart(root, Math.max(0, end));
    else range.setEnd(root, Math.max(0, end));
  };
  locate('start', selection.start);
  locate('end', selection.end);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

export function insertInlineText(root: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (i) fragment.append(document.createElement('br'));
      if (line) fragment.append(document.createTextNode(line));
    });
  const last = fragment.lastChild;
  if (!last) return;
  range.insertNode(fragment);
  range.setStartAfter(last);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  caretPlaceholder(root);
}

export function formatInlineSelection(root: HTMLElement, remove: boolean): string | null {
  const selected = textSelection(root);
  if (!selected || selected.start === selected.end) return null;
  const source = parts(root);
  const text = source
    .map((part) => part.text)
    .join('')
    .slice(selected.start, selected.end);
  // AssignmentV1 highlighting is deliberately single-line and excludes literal delimiters.
  if (!remove && /[`\r\n]/.test(text)) return null;
  let offset = 0;
  const result: Part[] = [];
  for (const part of source) {
    const cuts = [
      0,
      ...[selected.start, selected.end].map((i) =>
        Math.max(0, Math.min(part.text.length, i - offset)),
      ),
      part.text.length,
    ];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]!;
      const b = cuts[i + 1]!;
      if (b <= a) continue;
      const highlighted =
        offset + a >= selected.start && offset + b <= selected.end ? !remove : part.highlighted;
      const text = part.text.slice(a, b);
      const last = result.at(-1);
      if (last?.highlighted === highlighted) last.text += text;
      else result.push({ text, highlighted });
    }
    offset += part.text.length;
  }
  const value = result.map((part) => (part.highlighted ? `\`${part.text}\`` : part.text)).join('');
  if (value === inlineValue(root)) return null;
  renderInline(root, value);
  root.focus({ preventScroll: true });
  restoreTextSelection(root, selected);
  return value;
}
