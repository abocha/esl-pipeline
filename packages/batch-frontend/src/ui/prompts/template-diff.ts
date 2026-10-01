export interface TemplateDiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** Ordered line diff; bound quadratic work for unusually large operator-authored templates. */
export function diffTemplateContent(before: string, after: string): TemplateDiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const left = a.slice(prefix, a.length - suffix);
  const right = b.slice(prefix, b.length - suffix);
  const middle: TemplateDiffLine[] = [];
  if (left.length * right.length > 1_000_000) {
    middle.push(
      ...left.map((text): TemplateDiffLine => ({ kind: 'removed', text })),
      ...right.map((text): TemplateDiffLine => ({ kind: 'added', text })),
    );
  } else {
    const width = right.length + 1;
    const lengths = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lengths[i * width + j] =
          left[i] === right[j]
            ? 1 + (lengths[(i + 1) * width + j + 1] ?? 0)
            : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        middle.push({ kind: 'same', text: left[i++] ?? '' });
        j++;
      } else if (
        i < left.length &&
        (j === right.length ||
          (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))
      ) {
        middle.push({ kind: 'removed', text: left[i++] ?? '' });
      } else {
        middle.push({ kind: 'added', text: right[j++] ?? '' });
      }
    }
  }
  return [
    ...a.slice(0, prefix).map((text): TemplateDiffLine => ({ kind: 'same', text })),
    ...middle,
    ...a.slice(a.length - suffix).map((text): TemplateDiffLine => ({ kind: 'same', text })),
  ];
}
