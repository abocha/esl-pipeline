import { describe, expect, it } from 'vitest';

import { cleanSpeechText, parseSpeaker } from '../src/index.js';

describe('cleanSpeechText', () => {
  it('strips markdown while preserving punctuation', () => {
    const input = '- **Hello** _there_... [link](https://example.com)!';
    expect(cleanSpeechText(input)).toBe('Hello there... link!');
  });

  it('removes list prefixes and inline code', () => {
    const input = '1) Use `code` and ~~strikethrough~~.';
    expect(cleanSpeechText(input)).toBe('Use code and strikethrough.');
  });

  it('keeps sentence punctuation intact', () => {
    const input = 'Wait... what?!';
    expect(cleanSpeechText(input)).toBe('Wait... what?!');
  });
});

describe('parseSpeaker', () => {
  it('parses speaker labels when colon appears early', () => {
    expect(parseSpeaker('Teacher: Hello')).toEqual({ speaker: 'Teacher', text: 'Hello' });
  });

  it('treats lines with a leading colon as plain text', () => {
    expect(parseSpeaker(': Hello')).toEqual({ text: ': Hello' });
  });

  it('ignores colons that appear far into the line', () => {
    const line = 'This line is deliberately long before colon: should ignore';
    expect(parseSpeaker(line)).toEqual({ text: line });
  });

  it('preserves trailing colons inside the text', () => {
    expect(parseSpeaker('Teacher: says: hi')).toEqual({ speaker: 'Teacher', text: 'says: hi' });
  });
});
