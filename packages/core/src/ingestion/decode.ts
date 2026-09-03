import { decodeTextBytes } from './encoding-policy.js';
import type { ClassifiedAttachment, DecodedAttachment } from './types.js';

export function decode(c: ClassifiedAttachment, gbkFallback = true): DecodedAttachment {
  if (c.kind === 'rawtext' && c.fetched.buffer) {
    const { text, encoding } = decodeTextBytes(c.fetched.buffer, gbkFallback);
    return { ...c, decodedText: text, encoding };
  }
  return { ...c };
}
