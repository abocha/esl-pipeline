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

  it('maps legacy snapshot-style profiles into structured sections instead of collapsing them into teacher notes', () => {
    const derived = deriveFoundationalProfileFromMarkdown(`
# Anastasia K: Foundational Student Profile

## **Student Snapshot**
*   **Assessed Level:** B1+ (Strong Intermediate)
*   **Professional Context:** Medical Representative in the Pharmaceutical sector.
*   **Key Interests:** Media criticism, knitting, and AI technology.

## **Pedagogical Strategy: "The Analyst"**
Avoid imaginative roleplay.
1. Use critique-heavy tasks.
2. Keep homework linear.

## **Linguistic Foundational Truths**

### **Core Strengths**
*   Reading fluency.
*   Analytical logic.

### **Recurring Fossilized Errors (L1 Russian Interference)**
*   Omits third-person singular -s.
*   Uses will in time clauses.

## **Durable Themes & Interests**
*   Film analysis.
*   Knitting.
`);

    expect(derived?.overallLevel).toBe('B1+ (Strong Intermediate)');
    expect(derived?.communicationContexts).toEqual(
      expect.arrayContaining(['Medical Representative in the Pharmaceutical sector.']),
    );
    expect(derived?.interestsAndUsefulThemes).toEqual(
      expect.arrayContaining(['Media criticism', 'knitting', 'Film analysis.', 'Knitting.']),
    );
    expect(derived?.interestsAndUsefulThemes.some((item) => item.includes('AI technology'))).toBe(
      true,
    );
    expect(derived?.stableStrengths).toEqual(
      expect.arrayContaining(['Reading fluency.', 'Analytical logic.']),
    );
    expect(derived?.persistentChallenges).toEqual(
      expect.arrayContaining(['Omits third-person singular -s.', 'Uses will in time clauses.']),
    );
    expect(derived?.studyPreferences).toEqual(
      expect.arrayContaining([
        'Avoid imaginative roleplay.',
        'Use critique-heavy tasks.',
        'Keep homework linear.',
      ]),
    );
  });
});
