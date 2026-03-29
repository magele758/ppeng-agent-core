import { createDecipheriv, createHash } from 'node:crypto';

/**
 * Lark / Feishu event body encryption (Encrypt Key from console).
 * AES-256-CBC: key = SHA256(encryptKey string), IV = first 16 bytes of ciphertext buffer.
 */
export function decryptFeishuEncryptPayload(encryptBase64: string, encryptKey: string): string {
  const raw = Buffer.from(encryptBase64, 'base64');
  if (raw.length < 17) {
    throw new Error('Invalid encrypt payload');
  }
  const key = createHash('sha256').update(encryptKey, 'utf8').digest();
  const iv = raw.subarray(0, 16);
  const ciphertext = raw.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8').trim();
}
