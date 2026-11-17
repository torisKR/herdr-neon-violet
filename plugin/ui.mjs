// Shared palette and terminal text helpers for the neon-violet panes.

export const P = {
  bg: [19, 10, 31],        // #130a1f
  bar: [33, 18, 58],       // #21123a
  border: [94, 74, 128],   // #5e4a80
  violet: [195, 60, 240],  // #c33cf0
  pink: [255, 31, 110],    // #ff1f6e
  cyan: [31, 209, 201],    // #1fd1c9
  yellow: [255, 230, 0],   // #ffe600
  green: [57, 230, 162],   // #39e6a2
  text: [236, 228, 255],   // #ece4ff
  dim: [138, 118, 173],    // #8a76ad
};

/** Current terminal size. Asks the tty directly: on Windows `columns` can be stale. */
export function termSize() {
  try {
    const [cols, rows] = process.stdout.getWindowSize();
    if (cols > 0 && rows > 0) return { cols, rows };
  } catch {}
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const ITALIC = "\x1b[3m";
export const UNDERLINE = "\x1b[4m";
export const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
export const bg = (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;

/** Display width of one code point (CJK/Hangul/emoji = 2, combining = 0). */
export function cw(cp) {
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

/** Visible width of a string that may contain ANSI escapes. */
export function width(s) {
  let w = 0;
  for (let i = 0; i < s.length;) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) { i += m[0].length; continue; }
    const cp = s.codePointAt(i);
    w += cw(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return w;
}

/** Truncate (with …) or pad a styled string to exactly `w` columns. */
export function fit(s, w, pad = " ", padStyle = "") {
  if (w <= 0) return "";
  let out = "", used = 0;
  const full = width(s) > w;
  const limit = full ? w - 1 : w;
  for (let i = 0; i < s.length;) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) { out += m[0]; i += m[0].length; continue; }
    const cp = s.codePointAt(i);
    const c = cw(cp);
    if (used + c > limit) break;
    out += String.fromCodePoint(cp);
    used += c;
    i += cp > 0xffff ? 2 : 1;
  }
  if (full) { out += "…"; used += 1; }
  if (used < w) out += padStyle + pad.repeat(w - used);
  return out;
}

/** Plain text lines from terminal output: no escapes, no trailing blanks. */
export function cleanLines(text) {
  const lines = String(text || "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .split(/\r?\n/)
    .map((l) => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\t/g, "  ").replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Write text to the clipboard of whoever is looking at the terminal (OSC 52). */
export function osc52(text) {
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
}
