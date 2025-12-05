// packages/batch-backend/src/infrastructure/encryption-service.ts
// Simple AES-256-GCM encryption service for sensitive data at rest.
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT = 'esl-pipeline-settings-v1'; // Static salt for key derivation

/**
 * Encryption service configuration
 */
export interface EncryptionConfig {
  /** Secret used to derive the encryption key (typically JWT_SECRET) */
  secret: string;
}

/**
 * Encryption service for sensitive data at rest
 */
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: EncryptionConfig) {
    // Derive a 256-bit key from the secret using PBKDF2
    this.key = pbkdf2Sync(config.secret, SALT, 100_000, KEY_LENGTH, 'sha256');
  }

  /**
   * Encrypt a plaintext value.
   * Returns a base64-encoded string containing: IV + ciphertext + authTag
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Combine: IV (12 bytes) + ciphertext + authTag (16 bytes)
    const combined = Buffer.concat([iv, encrypted, authTag]);
    return combined.toString('base64');
  }

  /**
   * Decrypt a base64-encoded encrypted value.
   * Expects format: IV + ciphertext + authTag (as produced by encrypt)
   */
  decrypt(encryptedBase64: string): string {
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract components
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }
}

// Singleton instance
let encryptionServiceInstance: EncryptionService | null = null;

/**
 * Create or retrieve the encryption service singleton.
 * If no config provided, uses JWT_SECRET from environment.
 */
export function getEncryptionService(config?: EncryptionConfig): EncryptionService {
  if (encryptionServiceInstance) {
    return encryptionServiceInstance;
  }

  const secret = config?.secret || process.env.JWT_SECRET || 'default-secret-change-in-production';
  encryptionServiceInstance = new EncryptionService({ secret });
  return encryptionServiceInstance;
}

/**
 * Reset the encryption service singleton (for testing)
 */
export function resetEncryptionService(): void {
  encryptionServiceInstance = null;
}
