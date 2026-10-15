/**
 * PNG의 흰 배경을 투명하게 바꾼다. (앞서 life/mom에 썼던 것과 같은 방식)
 *
 * 테두리에서 시작하는 영역 채우기라 인물 안쪽의 흰색(셔츠 등)은 건드리지 않는다.
 * 경계의 안티앨리어싱 픽셀은 밝기에 비례해 깎아 흰 테두리를 없앤다.
 * 원본은 같은 폴더의 _original/ 에 복사해 둔다.
 *
 * 사용: node _strip-bg.mjs <png 경로> [...]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { inflateSync, deflateSync } from 'zlib';
import { dirname, basename, join } from 'path';

const HARD = 244;   // 이 이상 밝으면 확실한 배경
const SOFT = 206;   // 이 이상이면 경계 반투명 처리 대상
const FEATHER_PASSES = 3;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function decode(path) {
  const b = readFileSync(path);
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (b[25] !== 6 || b[24] !== 8) throw new Error(`RGBA 8bit만 지원 (colorType=${b[25]}, depth=${b[24]})`);

  const parts = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(b.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += bb;
      else if (filter === 3) v += Math.floor((a + bb) / 2);
      else if (filter === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - bb); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, px };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encode({ width, height, px }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function stripWhite({ width, height, px }) {
  const stride = width * 4;
  const idx = (x, y) => y * stride + x * 4;
  const bright = (i) => Math.min(px[i], px[i + 1], px[i + 2]);

  const bg = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (bg[p] || bright(idx(x, y)) < HARD) return;
    bg[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const y = stack.pop(); const x = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  let cleared = 0;
  for (let p = 0; p < bg.length; p += 1) if (bg[p]) { px[p * 4 + 3] = 0; cleared += 1; }

  let feathered = 0;
  for (let pass = 0; pass < FEATHER_PASSES; pass += 1) {
    const edge = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = idx(x, y);
        if (px[i + 3] === 0) continue;
        const b = bright(i);
        if (b < SOFT) continue;
        const near =
          (x > 0 && px[idx(x - 1, y) + 3] === 0) ||
          (x < width - 1 && px[idx(x + 1, y) + 3] === 0) ||
          (y > 0 && px[idx(x, y - 1) + 3] === 0) ||
          (y < height - 1 && px[idx(x, y + 1) + 3] === 0);
        if (!near) continue;
        const t = (b - SOFT) / (HARD - SOFT);
        edge.push(i, Math.max(0, Math.round(px[i + 3] * (1 - Math.min(1, t)))));
      }
    }
    if (!edge.length) break;
    for (let k = 0; k < edge.length; k += 2) { px[edge[k] + 3] = edge[k + 1]; feathered += 1; }
  }
  return { cleared, feathered, total: width * height };
}

for (const path of process.argv.slice(2)) {
  if (!existsSync(path)) { console.log(`없음: ${path}`); continue; }
  const img = decode(path);
  const stride = img.width * 4;
  const corners = [
    img.px[2 * stride + 2 * 4 + 3],
    img.px[2 * stride + (img.width - 3) * 4 + 3],
    img.px[(img.height - 3) * stride + 2 * 4 + 3],
    img.px[(img.height - 3) * stride + (img.width - 3) * 4 + 3],
  ];
  if (corners.every((a) => a === 0)) { console.log(`이미 투명: ${path}`); continue; }

  const backupDir = join(dirname(path), '_original');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, basename(path));
  if (!existsSync(backup)) copyFileSync(path, backup);

  const st = stripWhite(img);
  writeFileSync(path, encode(img));
  console.log(
    `✅ ${path}\n   배경 ${st.cleared.toLocaleString()}px 제거 (${((st.cleared / st.total) * 100).toFixed(1)}%), ` +
      `경계 ${st.feathered.toLocaleString()}px 보정 · 백업 ${backup}`
  );
}
