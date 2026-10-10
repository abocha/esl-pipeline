export function extractStudentOnlyTranscript(transcript: string): string {
  const lines = transcript.split(/\r?\n/);
  const studentLines: string[] = [];
  let inStudentBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inStudentBlock && studentLines.at(-1) !== '') {
        studentLines.push('');
      }
      continue;
    }

    const timelineMatch = /^\[Student [^\]]+\]\s*(.*)$/i.exec(trimmed);
    if (timelineMatch) {
      const text = timelineMatch[1]?.trim() ?? '';
      if (text) studentLines.push(text);
      inStudentBlock = false;
      continue;
    }

    const stackHeaderMatch = /^(Teacher|Student|Speaker\s+\d+):\s*(.*)$/i.exec(trimmed);
    if (stackHeaderMatch) {
      const speaker = (stackHeaderMatch[1] ?? '').toLowerCase();
      const text = (stackHeaderMatch[2] ?? '').trim();
      if (speaker === 'student') {
        inStudentBlock = true;
        if (text) studentLines.push(text);
      } else {
        inStudentBlock = false;
      }
      continue;
    }

    if (inStudentBlock) {
      studentLines.push(trimmed);
    }
  }

  return studentLines
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}
