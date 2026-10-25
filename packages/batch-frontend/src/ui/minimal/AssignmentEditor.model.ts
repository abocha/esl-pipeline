import {
  assignmentPlainText,
  type FreshAssignmentV1,
  FreshAssignmentV1Schema,
} from '@esl-pipeline/contracts';

export type EditorPath = readonly (string | number)[];
export const fieldKey = (path: EditorPath) => path.join('.');

/** Same AssignmentV1 object locally, including temporarily incomplete text; never a second format. */
export function readEditorAssignment(text: string): FreshAssignmentV1 | null {
  try {
    const value: unknown = JSON.parse(text);
    const checked = FreshAssignmentV1Schema.safeParse(value);
    if (checked.success) return checked.data;
    // These are the only string-format constraints in the current shape. Keep their invalid
    // buffers visible too. All other schema/structure errors stay outside the current editor.
    if (
      checked.error.issues.length &&
      checked.error.issues.every((issue) => {
        const path = issue.path.join('.');
        return (
          (path === 'metadata.icon' || path === 'metadata.instructionLanguage') &&
          typeof editorValue(value, issue.path as EditorPath) === 'string'
        );
      })
    )
      return value as FreshAssignmentV1;
  } catch {
    /* Missing or unsupported content is displayed by the owning workflow. */
  }
  return null;
}

export function editorValue(value: unknown, path: EditorPath): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node && typeof node === 'object'
        ? (node as Record<string | number, unknown>)[key]
        : undefined,
    value,
  );
}

export function editAssignment(
  assignment: FreshAssignmentV1,
  path: EditorPath,
  value: unknown,
): FreshAssignmentV1 {
  const copy = structuredClone(assignment);
  const parent = editorValue(copy, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]!] = value;
  return copy;
}

export function textProblem(value: string, path: EditorPath, optional: boolean): string | null {
  if (!value.trim()) return optional ? null : 'Enter text. This change has not saved.';
  if (
    fieldKey(path) === 'metadata.instructionLanguage' &&
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
  )
    return 'Use a language tag, for example en, ru or pt-BR.';
  if (fieldKey(path) === 'metadata.icon') {
    const checked = FreshAssignmentV1Schema.shape.metadata.shape.icon.safeParse(value);
    if (
      !checked.success ||
      [...value].length > 32 ||
      !/^(?:\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u.test(
        value,
      )
    )
      return 'Use one emoji.';
  }
  return null;
}

/** Highlight is the existing single-line paired-backtick convention, never HTML/Markdown. */
export function highlightSelection(value: string, start: number, end: number, remove = false) {
  if (start === end) return null;
  const selected = value.slice(start, end);
  if (remove) {
    if (value[start - 1] === '`' && value[end] === '`')
      return {
        value: value.slice(0, start - 1) + selected + value.slice(end + 1),
        start: start - 1,
        end: end - 1,
      };
    const plain = assignmentPlainText(selected);
    if (plain === selected) return null;
    return {
      value: value.slice(0, start) + plain + value.slice(end),
      start,
      end: start + plain.length,
    };
  }
  if (/[`\r\n]/.test(selected)) return null;
  if (value[start - 1] === '`' && value[end] === '`') return null;
  return {
    value: `${value.slice(0, start)}\`${selected}\`${value.slice(end)}`,
    start: start + 1,
    end: end + 1,
  };
}
