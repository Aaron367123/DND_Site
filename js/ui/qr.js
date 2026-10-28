// ============================================================
// QR — a QR code for the player link, drawn here
// ============================================================
// So a phone at the table can scan its way in instead of typing a URL. A
// small encoder of our own (byte mode, versions 1–10, error correction M,
// or L when the text is long) rather than a library from a CDN: the page
// works offline, and this is all it needs to do. Follows ISO/IEC 18004;
// the structure mirrors Project Nayuki's reference encoder.
//
// sktQrMatrix(text) → rows of booleans (true = dark), or null if too long.
// sktQrSvg(text, px) → an <svg> string with the quiet zone around it.

const _QR_EC = {
  // version: [ec codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
  M: [null, [10,1,16], [16,1,28], [26,1,44], [18,2,32], [24,2,43], [16,4,27], [18,4,31], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44]],
  L: [null, [7,1,19], [10,1,34], [15,1,55], [20,1,80], [26,1,108], [18,2,68], [20,2,78], [24,2,97], [30,2,116], [18,2,68,2,69]],
};
const _QR_FMT = { L: 1, M: 0 };
const _QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function _qrMul(x, y){
  let z = 0;
  for (let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function _qrDivisor(n){
  const r = new Array(n).fill(0); r[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++){
    for (let j = 0; j < n; j++){ r[j] = _qrMul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; }
    root = _qrMul(root, 0x02);
  }
  return r;
}
// The error correction codewords for one block of data.
function _qrEcc(data, n){
  const div = _qrDivisor(n), r = new Array(n).fill(0);
  data.forEach(b => {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((d, i) => { r[i] ^= _qrMul(d, f); });
  });
  return r;
}

// Data codewords, blocks and interleaving, for a level and version that fit.
function _qrCodewords(bytes){
  for (const lvl of ['M', 'L']){
    for (let v = 1; v <= 10; v++){
      const t = _QR_EC[lvl][v], cap = t[1] * t[2] + (t[3] || 0) * (t[4] || 0);
      const cc = v < 10 ? 8 : 16;
      if (4 + cc + bytes.length * 8 > cap * 8) continue;
      const bits = [];
      const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
      put(4, 4); put(bytes.length, cc); bytes.forEach(b => put(b, 8));
      put(0, Math.min(4, cap * 8 - bits.length));
      while (bits.length % 8) bits.push(0);
      const data = [];
      for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
      for (let p = 0; data.length < cap; p++) data.push(p % 2 ? 0x11 : 0xEC);
      const blocks = [];
      let k = 0;
      for (let g = 0; g < 2; g++){
        const n = t[1 + g * 2] || 0, len = t[2 + g * 2] || 0;
        for (let b = 0; b < n; b++){ const d = data.slice(k, k + len); k += len; blocks.push({ d, e: _qrEcc(d, t[0]) }); }
      }
      const out = [], maxD = Math.max(...blocks.map(b => b.d.length));
      for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
      for (let i = 0; i < t[0]; i++) blocks.forEach(b => out.push(b.e[i]));
      return { v, lvl, words: out };
    }
  }
  return null;
}

function sktQrMatrix(text){
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const cw = _qrCodewords(bytes); if (!cw) return null;
  const { v, lvl, words } = cw, size = v * 4 + 17;
  const mod = [...Array(size)].map(() => new Array(size).fill(false));
  const fn = [...Array(size)].map(() => new Array(size).fill(false));
  const setF = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  // Timing, finders, alignment.
  for (let i = 0; i < size; i++){ setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++){
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
    }
  });
  const al = _QR_ALIGN[v], na = al.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++){
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const data = (_QR_FMT[lvl] << 3) | mask;
    let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((data << 10) | r) ^ 0x5412, bit = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (v >= 7){
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const bits = (v << 12) | r;
    for (let i = 0; i < 18; i++){ const b = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, b); setF(c, a, b); }
  }
  // The data, in the zigzag, two columns at a time from the right.
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2){
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++){
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && n < words.length * 8){ mod[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
    }
  }
  // Each mask in turn; keep the one that scores best.
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];
  const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++){
    apply(m); drawFormat(m);
    const s = _qrPenalty(mod);
    if (s < bestScore){ bestScore = s; best = m; }
    apply(m);   // undo (XOR)
  }
  apply(best); drawFormat(best);
  return mod;
}
// The standard's four penalty rules: runs, 2×2 blocks, finder look-alikes, balance.
function _qrPenalty(m){
  const size = m.length; let s = 0, dark = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= size; i++){
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    const pat = [1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 7 <= size; i++){
      if (!pat.every((p, k) => get(i + k) === !!p)) continue;
      const before = [1, 2, 3, 4].every(k => i - k < 0 || !get(i - k)), after = [7, 8, 9, 10].every(k => i + k >= size || !get(i + k));
      if (before || after) s += 40;
    }
  };
  for (let y = 0; y < size; y++) line(i => m[y][i]);
  for (let x = 0; x < size; x++) line(i => m[i][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++){
    const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3;
  }
  m.forEach(r => r.forEach(c => { if (c) dark++; }));
  s += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return s;
}
function sktQrSvg(text, px){
  const m = sktQrMatrix(text); if (!m) return '';
  const q = 4, n = m.length + q * 2;
  let d = '';
  m.forEach((r, y) => r.forEach((c, x) => { if (c) d += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z'; }));
  return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + (px || 240) + '" height="' + (px || 240) + '" shape-rendering="crispEdges" role="img" aria-label="QR code">'
    + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
