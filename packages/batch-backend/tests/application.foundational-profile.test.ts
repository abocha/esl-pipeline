import { describe, expect, it } from 'vitest';

import { deriveFoundationalProfileFromMarkdown } from '../src/application/foundational-profile.js';

describe('application/foundational-profile', () => {
  it('routes unrecognized legacy sections into teacher notes during markdown derivation', () => {
    const derived = deriveFoundationalProfileFromMarkdown(`
# Foundational Profile
**Current Level:** B1

## Goals & Motivation
- Lead project updates more confidently.

## Tactical Follow-ups
- Review phrasal verbs from the April 10 lesson.

## Teacher Notes
Keep homework practical and short.
`);

    expect(derived).toEqual(
      expect.objectContaining({
        overallLevel: 'B1',
        primaryGoals: ['Lead project updates more confidently.'],
      }),
    );
    expect(derived?.teacherNotes).toContain('Tactical Follow-ups');
    expect(derived?.teacherNotes).toContain('Review phrasal verbs from the April 10 lesson.');
    expect(derived?.teacherNotes).toContain('Keep homework practical and short.');
  });
});
