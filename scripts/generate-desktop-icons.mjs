/**
 * Write PNG icons for electron-builder (works on Linux/Windows CI, no sips).
 * macOS may still run scripts/generate-icons.sh for a higher-quality .icns.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'apps', 'desktop', 'assets');

const BLUE = [0x25, 0x63, 0xeb, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgbaAt) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = rgbaAt(x, y);
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRoundedRect(x, y, size, radius) {
  const xr = Math.min(x, size - 1 - x);
  const yr = Math.min(y, size - 1 - y);
  if (xr >= radius || yr >= radius) return xr >= 0 && yr >= 0;
  return inCircle(x, y, xr < radius ? radius : size - 1 - radius, yr < radius ? radius : size - 1 - radius, radius);
}

function iconPixel(size) {
  const radius = Math.round(size * (12 / 64));
  const cx = (size - 1) / 2;
  const inner = size * (6 / 64);
  return (x, y) => {
    if (!inRoundedRect(x, y, size, radius)) return CLEAR;
    if (inCircle(x, y, cx, cx, inner)) return WHITE;
    return BLUE;
  };
}

export function writeDesktopIcons(dir = assetsDir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'icon.png'), encodePng(512, iconPixel(512)));
  writeFileSync(join(dir, 'trayTemplate.png'), encodePng(32, iconPixel(32)));
  writeFileSync(join(dir, 'trayTemplate@2x.png'), encodePng(64, iconPixel(64)));
  return ['icon.png', 'trayTemplate.png', 'trayTemplate@2x.png'].map((name) => join(dir, name));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const written = writeDesktopIcons();
  console.log(`[desktop-icons] wrote ${written.join(', ')}`);
}
