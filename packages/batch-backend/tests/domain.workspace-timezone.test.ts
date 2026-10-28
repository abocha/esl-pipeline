import { describe, expect, it } from 'vitest';

import {
  normalizeWorkspaceTimezone,
  postgresWorkspaceTimezone,
} from '../src/domain/workspace-timezone.js';

describe('workspace tutor timezone spellings', () => {
  it('keeps fixed-offset signs and distinct regions while unifying equivalent aliases', () => {
    expect(normalizeWorkspaceTimezone('UTC+7')).toBe('Etc/GMT-7');
    expect(normalizeWorkspaceTimezone('GMT-05:00')).toBe('Etc/GMT+5');
    expect(normalizeWorkspaceTimezone('GMT')).toBe('UTC');
    expect(normalizeWorkspaceTimezone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(normalizeWorkspaceTimezone('Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh');
    expect(normalizeWorkspaceTimezone('Europe/Moscow')).not.toBe(
      normalizeWorkspaceTimezone('Europe/Istanbul'),
    );
    expect(postgresWorkspaceTimezone(normalizeWorkspaceTimezone('+05:45'))).toBe('UTC-05:45');
    expect(postgresWorkspaceTimezone(normalizeWorkspaceTimezone('-03:30'))).toBe('UTC+03:30');
    expect(() => normalizeWorkspaceTimezone('UTC+15')).toThrow();
    expect(() => normalizeWorkspaceTimezone('Invalid/Zone')).toThrow();
  });
});
