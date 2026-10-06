/** Only nonempty, single-line paired backticks are presentation syntax, never Markdown. */
export function assignmentInlineParts(value: string): { text: string; highlighted: boolean }[] {
  return value
    .split(/((?<!`)`[^`\r\n]+`(?!`))/g)
    .map((part, i) => ({
      text: i % 2 === 1 ? part.slice(1, -1) : part,
      highlighted: i % 2 === 1,
    }))
    .filter((part) => part.text.length > 0);
}

/** Derived speech/drill projection only; stored strings and machine fields stay exact. */
export function assignmentPlainText(value: string): string {
  return assignmentInlineParts(value)
    .map((part) => part.text)
    .join('');
}
