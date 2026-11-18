// nv-graphics: what the conductor checks about pictures itself, without an agent and without
// dependencies. A stage that makes images lists them in a manifest; this reads every file's header
// (and, for ordinary PNGs, its pixels) and says what is missing, the wrong size, transparent where
// it must not be, blank, or a duplicate. It also writes one HTML sheet with every image on it, so a
// reviewer or a person sees the whole set at once.
//
// Manifest (pipeline/<stage>/manifest.json), paths relative to the project folder:
//   {"items":[{"file":"assets/images/cat.png","w":64,"h":64,"alpha":true,"use":"player sprite","owner":"w1"}]}
// w, h and alpha are checked only when given. alpha: true = has transparent pixels, false = fully opaque.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { inflateSync } from "node:zlib";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Size and transparency of a PNG, JPEG, WebP or GIF, read from its bytes. Null when it is none of them.
 *  `alpha`: the format carries transparency. `transparent` / `flat` are known only for PNGs that could be
 *  decoded (8-bit, not interlaced): some pixel is see-through / every pixel is the same color. */
export function imageInfo(buf) {
  if (buf.length >= 26 && buf.subarray(0, 8).equals(PNG)) return png(buf);
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf);
  if (buf.length >= 30 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return webp(buf);
  if (buf.length >= 10 && /^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return { format: "gif", w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), alpha: true };
  return null;
}

function png(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], type = buf[25], interlace = buf[28];
  const data = [];
  let palette = false;
  for (let at = 8; at + 12 <= buf.length;) {
    const size = buf.readUInt32BE(at), name = buf.toString("latin1", at + 4, at + 8);
    if (name === "tRNS") palette = true;
    if (name === "IDAT") data.push(buf.subarray(at + 8, at + 8 + size));
    if (name === "IEND") break;
    at += 12 + size;
  }
  const info = { format: "png", w, h, alpha: type === 4 || type === 6 || palette };
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  // Pixels are read for the common case only; anything else keeps what the header says.
  if (depth !== 8 || interlace !== 0 || !channels || !w || !h || w * h > 40_000_000) return info;
  try {
    const raw = inflateSync(Buffer.concat(data)), stride = w * channels;
    if (raw.length < (stride + 1) * h) return info;
    const out = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const filter = raw[y * (stride + 1)], from = y * (stride + 1) + 1, to = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? out[to + x - channels] : 0, b = y ? out[to + x - stride] : 0, c = x >= channels && y ? out[to + x - stride - channels] : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        out[to + x] = (raw[from + x] + add) & 255;
      }
    }
    let transparent = false, flat = true;
    for (let i = 0; i < out.length; i += channels) {
      if ((channels === 2 || channels === 4) && out[i + channels - 1] < 255) transparent = true;
      if (flat) for (let k = 0; k < channels; k++) if (out[i + k] !== out[k]) { flat = false; break; }
      if (transparent && !flat) break;
    }
    return { ...info, transparent, flat };
  } catch { return info; }
}

function jpeg(buf) {
  for (let at = 2; at + 9 < buf.length;) {
    if (buf[at] !== 0xff) { at++; continue; }
    const marker = buf[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { format: "jpeg", h: buf.readUInt16BE(at + 5), w: buf.readUInt16BE(at + 7), alpha: false, transparent: false };
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { at += 2; continue; }
    at += 2 + buf.readUInt16BE(at + 2);
  }
  return null;
}

function webp(buf) {
  const kind = buf.toString("latin1", 12, 16);
  if (kind === "VP8X") return { format: "webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), alpha: Boolean(buf[20] & 0x10) };
  if (kind === "VP8L") { const bits = buf.readUInt32LE(21); return { format: "webp", w: 1 + (bits & 0x3fff), h: 1 + ((bits >>> 14) & 0x3fff), alpha: Boolean((bits >>> 28) & 1) }; }
  if (kind === "VP8 ") return { format: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, alpha: false, transparent: false };
  return null;
}

/** The manifest's items, or the reason it cannot be used. */
export function readManifest(dir, manifest) {
  const file = join(dir, manifest);
  if (!existsSync(file)) return { items: [], error: `${manifest} is missing: list every image there (file, w, h, alpha, use, owner)` };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return { items: [], error: `${manifest} is not valid JSON` }; }
  const items = (Array.isArray(parsed) ? parsed : parsed?.items);
  if (!Array.isArray(items) || !items.length) return { items: [], error: `${manifest} lists no images` };
  return { items: items.filter(i => i && typeof i === "object") };
}

/** Checks every image the manifest lists. Returns what it found and the problems, each with the
 *  file and whose it is, so only that worker makes it again. */
export function verifyManifest(dir, manifest) {
  const { items, error } = readManifest(dir, manifest);
  if (error) return { items: [], issues: [{ file: manifest, owner: null, text: error }] };
  const issues = [], seen = new Map(), out = [];
  for (const item of items) {
    const name = String(item.file ?? ""), owner = item.owner ? String(item.owner) : null;
    const say = text => issues.push({ file: name, owner, text: `${name}: ${text}` });
    const row = { ...item, file: name, owner, ok: false };
    out.push(row);
    if (!name || isAbsolute(name) || name.split(/[\\/]/).includes("..")) { say("the path must be relative to the project folder"); continue; }
    const file = join(dir, name);
    if (!existsSync(file) || !statSync(file).isFile()) { say("the file does not exist"); continue; }
    const buf = readFileSync(file);
    if (!buf.length) { say("the file is empty"); continue; }
    const info = imageInfo(buf);
    if (!info) { say("not a PNG, JPEG, WebP or GIF image"); continue; }
    Object.assign(row, { found: info });
    const before = issues.length;
    if (Number(item.w) > 0 && Number(item.h) > 0 && (info.w !== Number(item.w) || info.h !== Number(item.h))) say(`is ${info.w}x${info.h}, the manifest says ${item.w}x${item.h}`);
    if (item.alpha === false && (info.transparent ?? info.alpha)) say("has transparency, and must be fully opaque");
    if (item.alpha === true && !(info.transparent ?? info.alpha)) say("has no transparent pixels, and needs a transparent background");
    if (info.flat) say("is one flat color (a blank image)");
    const hash = createHash("sha1").update(buf).digest("hex");
    if (seen.has(hash)) say(`is the same picture as ${seen.get(hash)}`); else seen.set(hash, name);
    row.ok = issues.length === before;
  }
  return { items: out, issues };
}

const esc = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One page with every image of the manifest, on a checkerboard so transparency shows. */
export function writeSheet(dir, sheet, title, items, issues) {
  const out = join(dir, sheet), base = dirname(out);
  const cell = i => {
    const src = relative(base, join(dir, i.file)).replaceAll("\\", "/"), bad = issues.filter(x => x.file === i.file);
    return `<figure class="${bad.length ? "bad" : ""}"><div class="pic">${i.found ? `<img src="${esc(encodeURI(src))}" alt="">` : "<span>없음</span>"}</div>` +
      `<figcaption><b>${esc(i.file)}</b><br>${i.found ? `${i.found.w}×${i.found.h}` : ""}${i.owner ? ` · ${esc(i.owner)}` : ""}<br>${esc(i.use ?? "")}` +
      `${bad.map(x => `<br><em>${esc(x.text.replace(`${i.file}: `, ""))}</em>`).join("")}</figcaption></figure>`;
  };
  mkdirSync(base, { recursive: true });
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{margin:24px;font:13px/1.5 system-ui,sans-serif;background:#16151c;color:#e8e6f0}
h1{font-size:16px;margin:0 0 4px} p{margin:0 0 16px;color:#9a97ab}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
figure{margin:0;padding:8px;border:1px solid #33313f;border-radius:8px;background:#1e1d27}
figure.bad{border-color:#e5484d}
.pic{height:160px;display:flex;align-items:center;justify-content:center;border-radius:4px;
background:repeating-conic-gradient(#3a3846 0 25%,#2a2933 0 50%) 0 0/16px 16px}
.pic img{max-width:100%;max-height:100%;image-rendering:pixelated}
figcaption{margin-top:6px;word-break:break-all;color:#b9b6c8} figcaption b{color:#e8e6f0} em{color:#ff8589;font-style:normal}
</style>
<h1>${esc(title)}</h1><p>이미지 ${items.length}개 · 문제 ${issues.length}건</p>
<main>${items.map(cell).join("")}</main>
`);
  return sheet;
}
