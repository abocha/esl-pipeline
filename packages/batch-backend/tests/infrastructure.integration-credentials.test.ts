import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { IntegrationCredentials } from '../src/infrastructure/integration-credentials.js';

describe('dedicated integration credential envelope', () => {
  const oldKey = randomBytes(32).toString('base64'),
    newKey = randomBytes(32).toString('base64');
  it('authenticates grant ownership and detects tampering without exposing credentials', () => {
    const service = new IntegrationCredentials('old', { old: oldKey });
    const encrypted = service.encrypt('secret-refresh-sentinel', 'grant:A:user:A:subject:A');
    expect(encrypted).not.toContain('secret-refresh-sentinel');
    expect(service.decrypt(encrypted, 'grant:A:user:A:subject:A')).toBe('secret-refresh-sentinel');
    expect(() => service.decrypt(encrypted, 'grant:B:user:A:subject:A')).toThrow(
      'Integration credential could not be decrypted',
    );
    const pieces = encrypted.split('.');
    pieces[3] = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(() => service.decrypt(pieces.join('.'), 'grant:A:user:A:subject:A')).toThrow(
      'Integration credential could not be decrypted',
    );
  });
  it('reads retained rotation keys and encrypts with the explicit active key', () => {
    const before = new IntegrationCredentials('old', { old: oldKey }).encrypt('refresh', 'owner');
    const rotated = new IntegrationCredentials('new', { old: oldKey, new: newKey });
    expect(rotated.decrypt(before, 'owner')).toBe('refresh');
    expect(rotated.encrypt('refresh', 'owner')).toMatch(/^v1\.new\./);
    expect(() => new IntegrationCredentials('missing', { old: oldKey })).toThrow(
      'Active integration credential key is missing',
    );
    expect(() => new IntegrationCredentials('old', { old: 'JWT_SECRET' })).toThrow(
      'Invalid integration credential key configuration',
    );
    expect(() =>
      new IntegrationCredentials('new', { new: newKey }).decrypt(before, 'owner'),
    ).toThrow('Integration credential could not be decrypted');
  });
});
