import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the current contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('10.0.0');
    expect(DB_CONTRACT_VERSION).toBe('4.0.0');
  });
});
