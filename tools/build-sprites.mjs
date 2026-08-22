/* Builds art/sprites/units.png from Eldiran's CC0 sprite sheet.
 *
 * Run with: node tools/build-sprites.mjs
 *
 * Kept as a script rather than a one-off because it is the record of what was
 * taken from where: the upstream URL, which frame of which row became which
 * unit, and the two transformations applied. Re-running it reproduces the
 * shipped file byte for byte.
 *
 * Three things it has to do:
 *   1. The upstream sheet is 12 columns x 21 rows of 32px cells. Columns 0-3
 *      face the viewer; column 1 is the clean standing frame, which is the only
 *      one a card portrait wants.
 *   2. The background is CHROMA-KEYED magenta, not transparent — #FF00FF at
 *      full alpha. Shipped as-is, every card would wear a magenta block.
 *   3. Only 19 of the 20 usable rows are needed, one per unit, so the output is
 *      a compact horizontal strip in roster order and nothing else travels.
 *
 * PNG encode/decode is done by hand against node:zlib. That is more code than
 * pulling a library in, but this project has no build step and no node_modules,
 * and adding both for one image would be the larger cost.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const SRC = 'RPGCharacterSprites32x32.png';   // expected in the working directory
const OUT = 'art/sprites/units.png';
const CELL = 32;
const IDLE_COL = 1;

/* Source row for each unit, in the order js/cards.js lists them. Row 0 of the
   sheet is a blank template, so a sheet row is its contact-sheet index + 1. */
const PICKS = [
  { id: 'sov-ash',     row: 10, why: 'caped sword lord' },
  { id: 'sov-ivory',   row: 4,  why: 'pale plate and visor — Ivorywatch' },
  { id: 'sov-storm',   row: 13, why: 'gold-trimmed coat, a commander who casts' },
  { id: 'vanguard',    row: 15, why: 'plain soldier, chevron tunic' },
  { id: 'duelist',     row: 14, why: 'masked and light on its feet' },
  { id: 'warden',      row: 1,  why: 'steel plate, immovable' },
  { id: 'reaver',      row: 2,  why: 'rough tunic brawler' },
  { id: 'hewer',       row: 11, why: 'heaviest plate on the sheet' },
  { id: 'lancer',      row: 19, why: 'mounted-knight livery' },
  { id: 'pikeguard',   row: 16, why: 'steel helm, braced' },
  { id: 'bannerguard', row: 3,  why: 'sash and colours' },
  { id: 'marksman',    row: 9,  why: 'wide-brimmed ranger' },
  { id: 'shade',       row: 8,  why: 'hooded and masked' },
  { id: 'skyguard',    row: 17, why: 'ornate flier' },
  { id: 'drakerider',  row: 18, why: 'plumed dragoon' },
  { id: 'emberwright', row: 20, why: 'red and gold — fire' },
  { id: 'galecaller',  row: 5,  why: 'hooded caster' },
  { id: 'frostbinder', row: 12, why: 'pale blue robe — frost' },
  { id: 'mender',      row: 6,  why: 'white and gold vestments' },
];

// ── PNG ────────────────────────────────────────────────────────────────────

function decode(buf) {
  let pos = 8, idat = [], meta = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      meta = { w: data.readUInt32BE(0), h: data.readUInt32BE(4),
               depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (meta.depth !== 8 || meta.color !== 6 || meta.interlace !== 0) {
    throw new Error('expected 8-bit RGBA, non-interlaced');
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { w, h } = meta, ch = 4, stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0, prev = Buffer.alloc(stride);

  // Undo the per-scanline filters. All five, because the encoder picks per row.
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, px: out };
}

function encode(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                    // filter: none
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32
      ? zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]))
      : crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── Build ──────────────────────────────────────────────────────────────────

const src = decode(readFileSync(SRC));
const n = PICKS.length;
const outW = n * CELL, outH = CELL;
const out = Buffer.alloc(outW * outH * 4);      // zero-filled = transparent

let keyed = 0;
PICKS.forEach((pick, idx) => {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const si = ((pick.row * CELL + y) * src.w + (IDLE_COL * CELL + x)) * 4;
      const di = (y * outW + idx * CELL + x) * 4;
      const r = src.px[si], g = src.px[si + 1], b = src.px[si + 2];
      if (r === 255 && g === 0 && b === 255) { keyed++; continue; }  // leave clear
      out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = src.px[si + 3];
    }
  }
});

mkdirSync('art/sprites', { recursive: true });
const png = encode(outW, outH, out);
writeFileSync(OUT, png);

console.log(`${OUT}  ${outW}x${outH}  ${png.length} bytes`);
console.log(`${n} portraits, ${keyed} magenta pixels made transparent`);
PICKS.forEach((p, i) => console.log(`  ${String(i).padStart(2)}  ${p.id.padEnd(12)} row ${String(p.row).padStart(2)}  ${p.why}`));
