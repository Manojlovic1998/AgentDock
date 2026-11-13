// Draws the app icon, build/icon.png: the title-bar logo mark (two squares joined by an elbow
// connector, see `logo` in src/app/core/model/icons.ts) in white on the ember accent.
// electron-builder turns this one 1024px PNG into the .ico and .icns files it needs.
//
//   node scripts/make-icon.mjs
//
// No dependencies: the PNG is encoded by hand with node:zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const UNIT = (SIZE / 24) * 0.72; // pixels per unit of the 24-unit icon grid
const STROKE = 2.4 * UNIT;
const TOP = [0xf5, 0x8c, 0x62];
const BOTTOM = [0xe0, 0x62, 0x3a];

/** Distance from a point to a line segment. */
function toSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Logo geometry in icon-grid units, moved so that grid point (12, 12) is the centre of the image. */
const at = (x, y) => [SIZE / 2 + (x - 12) * UNIT, SIZE / 2 + (y - 12) * UNIT];
const square = (x, y, size) => {
  const p = [at(x, y), at(x + size, y), at(x + size, y + size), at(x, y + size)];
  return p.map((a, i) => [...a, ...p[(i + 1) % 4]]);
};
const SEGMENTS = [...square(5, 4, 5), ...square(14, 15, 5), [...at(10, 6.5), ...at(13, 6.5)], [...at(16.5, 10), ...at(16.5, 15)]];
const [arcX, arcY] = at(13, 10);
const ARC_R = 3.5 * UNIT;

/** Distance from a pixel to the strokes of the logo: the segments and the quarter-circle corner. */
function logoDistance(px, py) {
  let d = Math.min(...SEGMENTS.map(([ax, ay, bx, by]) => toSegment(px, py, ax, ay, bx, by)));
  const dx = px - arcX;
  const dy = py - arcY;
  // The corner is the quarter of the circle that faces up and to the right.
  d = Math.min(d, dx >= 0 && dy <= 0 ? Math.abs(Math.hypot(dx, dy) - ARC_R) : Infinity);
  return d;
}

/** Signed distance to the rounded square the icon sits on; negative inside. */
function plateDistance(px, py) {
  const inset = SIZE * 0.08;
  const half = SIZE / 2 - inset;
  const radius = SIZE * 0.22;
  const qx = Math.abs(px - SIZE / 2) - (half - radius);
  const qy = Math.abs(py - SIZE / 2) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const cover = (d) => Math.max(0, Math.min(1, 0.5 - d)); // one-pixel anti-aliasing

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type: none
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    const plate = cover(plateDistance(px, py));
    const k = (y - SIZE * 0.08) / (SIZE * 0.84);
    const mark = cover(logoDistance(px, py) - STROKE / 2);
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 3; c++) {
      const base = TOP[c] + (BOTTOM[c] - TOP[c]) * Math.max(0, Math.min(1, k));
      raw[o + c] = Math.round(base + (255 - base) * mark);
    }
    raw[o + 3] = Math.round(plate * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // colour type: RGBA

mkdirSync('build', { recursive: true });
writeFileSync(
  'build/icon.png',
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log('wrote build/icon.png');
