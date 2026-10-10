import { describe, expect, it } from 'vitest';

import { extractStudentOnlyTranscript } from '../src/application/student-lesson-history.js';

describe('student-lesson-history helpers', () => {
  it('extracts student-only lines from timeline and stack transcript formats', () => {
    const transcript = `
[Teacher 00:00.000-00:01.000] Hello there
[Student 00:01.100-00:02.000] I am agree with this
Student: I very like this topic
Teacher: Great
`.trim();

    const studentOnly = extractStudentOnlyTranscript(transcript);
    expect(studentOnly).toContain('I am agree with this');
    expect(studentOnly).toContain('I very like this topic');
    expect(studentOnly).not.toContain('Hello there');
  });

  it('keeps multiline student turns from stack-mode transcripts', () => {
    const transcript = `
Teacher:
Hello there

Student:
I agree with this point.
Because I saw the same in class yesterday.

Teacher:
Great explanation.
`.trim();

    const studentOnly = extractStudentOnlyTranscript(transcript);
    expect(studentOnly).toContain('I agree with this point.');
    expect(studentOnly).toContain('Because I saw the same in class yesterday.');
    expect(studentOnly).not.toContain('Hello there');
    expect(studentOnly).not.toContain('Great explanation.');
  });
});
