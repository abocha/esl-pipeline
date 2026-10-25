import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Dedicated provider keyring. Existing settings/JWT encryption is deliberately separate. */
export class IntegrationCredentials {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly activeKeyId: string,
    keys: Record<string, string>,
  ) {
    for (const [id, encoded] of Object.entries(keys)) {
      const key = Buffer.from(encoded, 'base64');
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        key.length !== 32 ||
        key.toString('base64') !== encoded
      ) {
        throw new Error('Invalid integration credential key configuration');
      }
      this.keys.set(id, key);
    }
    if (!this.keys.has(activeKeyId))
      throw new Error('Active integration credential key is missing');
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(`integration:v1:${this.activeKeyId}:${context}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      this.activeKeyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, context: string): string {
    try {
      const [version, keyId, iv, tag, ciphertext, extra] = envelope.split('.');
      const key = keyId ? this.keys.get(keyId) : undefined;
      if (version !== 'v1' || !key || !iv || !tag || !ciphertext || extra !== undefined)
        throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(`integration:v1:${keyId}:${context}`));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Integration credential could not be decrypted');
    }
  }
}
