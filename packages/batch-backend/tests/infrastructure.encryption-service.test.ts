// packages/batch-backend/tests/infrastructure.encryption-service.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EncryptionService,
  getEncryptionService,
  resetEncryptionService,
} from '../src/infrastructure/encryption-service.js';

describe('infrastructure/encryption-service', () => {
  beforeEach(() => {
    resetEncryptionService();
  });

  afterEach(() => {
    resetEncryptionService();
  });

  describe('EncryptionService', () => {
    it('encrypts and decrypts a simple string', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = 'sk_test_1234567890';

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts to different ciphertexts for same plaintext (due to random IV)', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = 'secret_notion_token_abc123';

      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt to the same value
      expect(service.decrypt(encrypted1)).toBe(plaintext);
      expect(service.decrypt(encrypted2)).toBe(plaintext);
    });

    it('handles empty string', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = '';

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('handles unicode characters', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = '🔐 Secret key with émojis и кириллица';

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('handles long strings', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = 'a'.repeat(10_000);

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('throws error for tampered ciphertext', () => {
      const service = new EncryptionService({ secret: 'test-secret-key' });
      const plaintext = 'secret_key';
      const encrypted = service.encrypt(plaintext);

      // Tamper with the ciphertext
      const tamperedBuffer = Buffer.from(encrypted, 'base64');
      tamperedBuffer[0]! ^= 0xff; // Flip bits in first byte
      const tampered = tamperedBuffer.toString('base64');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('uses different keys for different secrets', () => {
      const service1 = new EncryptionService({ secret: 'secret-one' });
      const service2 = new EncryptionService({ secret: 'secret-two' });
      const plaintext = 'my-api-key';

      const encrypted = service1.encrypt(plaintext);

      // Service with different secret cannot decrypt
      expect(() => service2.decrypt(encrypted)).toThrow();
    });
  });

  describe('getEncryptionService', () => {
    it('returns singleton instance', () => {
      const service1 = getEncryptionService({ secret: 'test' });
      const service2 = getEncryptionService({ secret: 'different' }); // Config ignored for existing instance

      expect(service1).toBe(service2);
    });

    it('uses JWT_SECRET from environment when no config provided', () => {
      const originalEnv = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'env-jwt-secret';

      try {
        const service = getEncryptionService();
        const encrypted = service.encrypt('test');

        // Create a new service with the same secret to verify
        const verifyService = new EncryptionService({ secret: 'env-jwt-secret' });
        expect(verifyService.decrypt(encrypted)).toBe('test');
      } finally {
        process.env.JWT_SECRET = originalEnv;
        resetEncryptionService();
      }
    });
  });
});
