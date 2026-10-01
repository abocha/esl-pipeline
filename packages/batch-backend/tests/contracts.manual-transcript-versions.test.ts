import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the current contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('5.1.0');
    expect(DB_CONTRACT_VERSION).toBe('0.32.0');
  });
});
