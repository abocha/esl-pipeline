function fallbackCopyWithExecCommand(text: string): boolean {
  if (
    typeof document === 'undefined' ||
    typeof document.execCommand !== 'function' ||
    !document.body
  ) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.top = '0';
  textarea.style.left = '0';

  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to fallback path.
    }
  }

  return fallbackCopyWithExecCommand(text);
}
