import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedImageMime, extensionForMime } from '../dist/image-assets.js';

describe('isAllowedImageMime', () => {
  describe('valid image types', () => {
    it('accepts image/png', () => {
      assert.strictEqual(isAllowedImageMime('image/png'), true);
    });

    it('accepts image/jpeg', () => {
      assert.strictEqual(isAllowedImageMime('image/jpeg'), true);
    });

    it('accepts image/webp', () => {
      assert.strictEqual(isAllowedImageMime('image/webp'), true);
    });

    it('accepts image/gif', () => {
      assert.strictEqual(isAllowedImageMime('image/gif'), true);
    });
  });

  describe('case insensitivity', () => {
    it('accepts Image/PNG (mixed case)', () => {
      assert.strictEqual(isAllowedImageMime('Image/PNG'), true);
    });

    it('accepts IMAGE/JPEG (uppercase)', () => {
      assert.strictEqual(isAllowedImageMime('IMAGE/JPEG'), true);
    });

    it('accepts image/WebP (mixed case subtype)', () => {
      assert.strictEqual(isAllowedImageMime('image/WebP'), true);
    });

    it('accepts IMAGE/GIF (uppercase)', () => {
      assert.strictEqual(isAllowedImageMime('IMAGE/GIF'), true);
    });
  });

  describe('with charset suffix', () => {
    it('accepts image/png with charset=utf-8', () => {
      assert.strictEqual(isAllowedImageMime('image/png; charset=utf-8'), true);
    });

    it('accepts image/jpeg with charset=utf-8', () => {
      assert.strictEqual(isAllowedImageMime('image/jpeg; charset=utf-8'), true);
    });

    it('accepts image/webp with charset=utf-8', () => {
      assert.strictEqual(isAllowedImageMime('image/webp; charset=utf-8'), true);
    });

    it('accepts image/gif with charset=utf-8', () => {
      assert.strictEqual(isAllowedImageMime('image/gif; charset=utf-8'), true);
    });

    it('accepts with other charset values', () => {
      assert.strictEqual(isAllowedImageMime('image/png; charset=iso-8859-1'), true);
    });
  });

  describe('invalid image types', () => {
    it('rejects image/svg+xml', () => {
      assert.strictEqual(isAllowedImageMime('image/svg+xml'), false);
    });

    it('rejects image/tiff', () => {
      assert.strictEqual(isAllowedImageMime('image/tiff'), false);
    });

    it('rejects application/pdf', () => {
      assert.strictEqual(isAllowedImageMime('application/pdf'), false);
    });

    it('rejects text/plain', () => {
      assert.strictEqual(isAllowedImageMime('text/plain'), false);
    });

    it('rejects empty string', () => {
      assert.strictEqual(isAllowedImageMime(''), false);
    });
  });

  describe('security: injection attempts', () => {
    it('rejects CRLF injection attempt', () => {
      assert.strictEqual(isAllowedImageMime('image/png\nContent-Type: text/html'), false);
    });

    it('rejects carriage return injection', () => {
      assert.strictEqual(isAllowedImageMime('image/png\r\nContent-Type: text/html'), false);
    });

    it('trailing whitespace is trimmed and accepted', () => {
      // trim() strips trailing newline, so 'image/png\n' → 'image/png' → valid
      assert.strictEqual(isAllowedImageMime('image/png\n'), true);
    });
  });
});

describe('extensionForMime', () => {
  describe('valid image types', () => {
    it('returns "png" for image/png', () => {
      assert.strictEqual(extensionForMime('image/png'), 'png');
    });

    it('returns "jpg" for image/jpeg', () => {
      assert.strictEqual(extensionForMime('image/jpeg'), 'jpg');
    });

    it('returns "webp" for image/webp', () => {
      assert.strictEqual(extensionForMime('image/webp'), 'webp');
    });

    it('returns "gif" for image/gif', () => {
      assert.strictEqual(extensionForMime('image/gif'), 'gif');
    });
  });

  describe('case insensitivity', () => {
    it('returns "png" for Image/PNG', () => {
      assert.strictEqual(extensionForMime('Image/PNG'), 'png');
    });

    it('returns "jpg" for IMAGE/JPEG', () => {
      assert.strictEqual(extensionForMime('IMAGE/JPEG'), 'jpg');
    });

    it('returns "webp" for image/WebP', () => {
      assert.strictEqual(extensionForMime('image/WebP'), 'webp');
    });

    it('returns "gif" for IMAGE/GIF', () => {
      assert.strictEqual(extensionForMime('IMAGE/GIF'), 'gif');
    });
  });

  describe('with charset suffix', () => {
    it('returns "png" for image/png; charset=utf-8', () => {
      assert.strictEqual(extensionForMime('image/png; charset=utf-8'), 'png');
    });

    it('returns "jpg" for image/jpeg; charset=utf-8', () => {
      assert.strictEqual(extensionForMime('image/jpeg; charset=utf-8'), 'jpg');
    });

    it('returns "webp" for image/webp; charset=iso-8859-1', () => {
      assert.strictEqual(extensionForMime('image/webp; charset=iso-8859-1'), 'webp');
    });

    it('returns "gif" for image/gif; boundary=something', () => {
      assert.strictEqual(extensionForMime('image/gif; boundary=something'), 'gif');
    });
  });

  describe('unknown types', () => {
    it('returns "bin" for image/svg+xml', () => {
      assert.strictEqual(extensionForMime('image/svg+xml'), 'bin');
    });

    it('returns "bin" for image/tiff', () => {
      assert.strictEqual(extensionForMime('image/tiff'), 'bin');
    });

    it('returns "bin" for application/pdf', () => {
      assert.strictEqual(extensionForMime('application/pdf'), 'bin');
    });

    it('returns "bin" for text/plain', () => {
      assert.strictEqual(extensionForMime('text/plain'), 'bin');
    });

    it('returns "bin" for empty string', () => {
      assert.strictEqual(extensionForMime(''), 'bin');
    });

    it('returns "bin" for unrecognized mime', () => {
      assert.strictEqual(extensionForMime('image/bmp'), 'bin');
    });
  });
});
