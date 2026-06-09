import { describe, expect, it } from 'vitest';

import {
  buildInviteUrl,
  hashInviteToken,
  normalizeInviteEmail,
  redactInviteForList,
} from '../src/application/alpha-invites.js';

describe('application/alpha-invites', () => {
  it('normalizes invite emails for uniqueness and matching', () => {
    expect(normalizeInviteEmail('  Teacher+Alpha@Example.COM ')).toBe('teacher+alpha@example.com');
  });

  it('hashes invite tokens deterministically without returning the raw token', () => {
    const first = hashInviteToken('invite-token');
    const second = hashInviteToken('invite-token');

    expect(first).toBe(second);
    expect(first).not.toContain('invite-token');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('redacts tokens and token hashes from list output', () => {
    const redacted = redactInviteForList({
      id: 'invite-1',
      email: 'teacher@example.com',
      emailNormalized: 'teacher@example.com',
      tokenHash: 'hash-that-must-not-print',
      status: 'pending',
      expiresAt: new Date('2026-06-23T00:00:00.000Z'),
      invitedByUserId: null,
      acceptedUserId: null,
      createdAt: new Date('2026-06-09T00:00:00.000Z'),
      acceptedAt: null,
      revokedAt: null,
    });

    expect(redacted).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(redacted)).not.toContain('hash-that-must-not-print');
  });

  it('builds fragment invite URLs so raw tokens are not sent to the server', () => {
    expect(buildInviteUrl('https://alpha.example.com', 'raw-token')).toBe(
      'https://alpha.example.com/#invite=raw-token',
    );
  });
});
