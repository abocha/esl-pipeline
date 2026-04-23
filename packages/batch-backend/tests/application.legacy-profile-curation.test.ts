import { describe, expect, it } from 'vitest';

import { getCuratedLegacyFoundationalProfile } from '../src/application/legacy-profile-curation.js';

describe('application/legacy-profile-curation', () => {
  it('returns curated canonical content for known live profiles', () => {
    const dasha = getCuratedLegacyFoundationalProfile('dasha.md');
    expect(dasha).toEqual(
      expect.objectContaining({
        overallLevel: 'A2',
        primaryGoals: [
          'Transition photography into her main professional pursuit and source of income.',
        ],
        communicationContexts: expect.arrayContaining([
          'Co-founder and manager of a coffee shop in Saint Petersburg serving international customers.',
        ]),
      }),
    );
  });

  it('returns null for profiles outside the one-off curated set', () => {
    expect(getCuratedLegacyFoundationalProfile('profiles/students/alex.md')).toBeNull();
  });
});
