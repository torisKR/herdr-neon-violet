// Text-mode web browser for a herdr pane. Works over SSH: it renders in the
// terminal, so you can read docs or check a dev server on the remote machine.
// Keys: j/k ↑↓ scroll · space/b page · N⏎ follow link N · u or / new url/search
//       h ← back · r reload · y copy url · o open in system browser · q quit
import { spawn } from "node:child_process";
import { P, fg, bg, RESET, BOLD, ITALIC, UNDERLINE, cw, fit, osc52, termSize } from "./ui.mjs";

const HOME = "https://html.duckduckgo.com/html/";
const UA = "Mozilla/5.0 (herdr-neon-violet text browser)";

const st = { url: "", title: "", lines: [], links: [], scroll: 0, history: [], status: "", input: null, num: "" };

// ---------- HTML → styled lines ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  copy: "©", reg: "®", trade: "™", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", laquo: "«",
  raquo: "»", bull: "•", times: "×", rarr: "→", larr: "←", deg: "°" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "nav", "aside", "ul", "ol",
  "table", "tr", "form", "figure", "figcaption", "dl", "dt", "dd", "details", "summary", "center", "body", "html"]);

function realUrl(href, base) {
  try {
    const u = new URL(decode(href), base);
    if (/duckduckgo\.com$/.test(u.hostname) && u.pathname === "/l/" && u.searchParams.get("uddg")) return u.searchParams.get("uddg");
    return u.href;
  } catch { return null; }
}

function parse(html, base) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim()).replace(/\s+/g, " ");
  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<![^>]*>/g, "")
    .replace(/<(script|style|noscript|svg|template|head|iframe|select)\b[\s\S]*?<\/\1\s*>/gi, "");
  const blocks = [];
  const links = [];
  let cur = null, pre = 0, link = null, bold = 0, ital = 0, code = 0, listDepth = 0;
  const open = (kind) => { if (cur && cur.spans.length) blocks.push(cur); cur = { kind, spans: [] }; };
  const push = (text, style) => { if (!cur) open("p"); cur.spans.push({ text, style }); };
  open("p");
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      let t = decode(m[4]);
      if (!pre) t = t.replace(/\s+/g, " ");
      if (t) push(t, link ? "link" : code ? "code" : bold ? "bold" : ital ? "ital" : "");
      continue;
    }
    const close = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
    if (/^h[1-6]$/.test(tag)) { open(close ? "p" : tag); continue; }
    if (tag === "li") { if (!close) open("li" + Math.min(listDepth, 3)); else open("p"); continue; }
    if (tag === "ul" || tag === "ol") { listDepth += close ? -1 : 1; listDepth = Math.max(0, listDepth); open("p"); continue; }
    if (tag === "pre") { pre += close ? -1 : 1; open(close ? "p" : "pre"); continue; }
    if (tag === "blockquote") { open(close ? "p" : "quote"); continue; }
    if (tag === "br") { push("\n", ""); continue; }
    if (tag === "hr") { open("hr"); open("p"); continue; }
    if (tag === "td" || tag === "th") { if (close) push("  ", ""); continue; }
    if (BLOCK.has(tag)) { open(cur?.kind?.startsWith("li") && !close ? cur.kind : "p"); continue; }
    if (tag === "b" || tag === "strong") { bold += close ? -1 : 1; continue; }
    if (tag === "i" || tag === "em") { ital += close ? -1 : 1; continue; }
    if (tag === "code" || tag === "kbd") { code += close ? -1 : 1; continue; }
    if (tag === "img" && !close) {
      const alt = attrs.match(/alt\s*=\s*"([^"]*)"/i)?.[1];
      if (alt) push(`[${decode(alt)}]`, "dim");
      continue;
    }
    if (tag === "input" && !close && /type\s*=\s*"?submit/i.test(attrs)) continue;
    if (tag === "a") {
      if (!close) {
        const href = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const url = href ? realUrl(href[2] ?? href[3] ?? href[4], base) : null;
        link = url && !/^javascript:/i.test(url) ? url : null;
      } else if (link) {
        links.push(link);
        push(`[${links.length}]`, "num");
        link = null;
      }
    }
  }
  if (cur && cur.spans.length) blocks.push(cur);
  return { title, blocks, links };
}

const STYLE = {
  "": fg(P.text), bold: fg(P.text) + BOLD, ital: fg(P.text) + ITALIC, code: fg(P.cyan),
  link: fg(P.cyan) + UNDERLINE, num: fg(P.yellow) + BOLD, dim: fg(P.dim),
};

function layout(blocks, width) {
  const out = [];
  const blank = () => { if (out.length && out[out.length - 1] !== "") out.push(""); };
  for (const b of blocks) {
    const text = b.spans.map((s) => s.text).join("").trim();
    if (b.kind === "hr") { blank(); out.push(fg(P.border) + "─".repeat(Math.min(width, 60))); blank(); continue; }
    if (!text) continue;
    let prefix = "", indent = "", base = "";
    if (/^h[12]$/.test(b.kind)) { blank(); prefix = fg(P.violet) + BOLD + (b.kind === "h1" ? "◆ " : "◇ "); base = fg(P.violet) + BOLD; }
    else if (/^h[3-6]$/.test(b.kind)) { blank(); prefix = fg(P.pink) + BOLD + "▸ "; base = fg(P.pink) + BOLD; }
    else if (b.kind.startsWith("li")) { const d = Number(b.kind.slice(2)) || 1; indent = "  ".repeat(d); prefix = indent.slice(2) + fg(P.pink) + "• "; }
    else if (b.kind === "quote") { prefix = fg(P.border) + "│ "; indent = "  "; base = fg(P.dim) + ITALIC; }
    else if (b.kind === "pre") {
      blank();
      for (const l of b.spans.map((s) => s.text).join("").replace(/^\n+|\n+$/g, "").split("\n"))
        out.push(fg(P.border) + "│ " + fg(P.cyan) + l.replace(/\t/g, "  "));
      blank();
      continue;
    }
    // word wrap with styles
    const words = [];
    for (const s of b.spans) for (const part of s.text.split(/(\s+)/)) if (part) words.push({ t: part, s: base || STYLE[s.style] || "" , st: s.style });
    let line = prefix, used = (prefix.replace(/\x1b\[[0-9;]*m/g, "")).length;
    const flush = () => { out.push(line); line = indent; used = indent.length; };
    for (const w of words) {
      if (w.t.includes("\n")) { flush(); continue; }
      const ww = [...w.t].reduce((n, ch) => n + cw(ch.codePointAt(0)), 0);
      if (/^\s+$/.test(w.t)) { if (used > indent.length && used + 1 <= width) { line += " "; used += 1; } continue; }
      if (used + ww > width && used > indent.length) flush();
      line += (w.st === "link" || w.st === "num" ? (STYLE[w.st]) : w.s) + w.t + RESET;
      used += ww;
    }
    if (used > indent.length) out.push(line);
    if (!b.kind.startsWith("li")) blank();
  }
  return out;
}

// ---------- fetching ----------
function toUrl(input) {
  const s = input.trim();
  if (!s) return HOME;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/.test(s)) return "http://" + s;
  if (/^[^\s]+\.[a-z]{2,}(\/|:|$)/i.test(s)) return "https://" + s;
  return HOME + "?q=" + encodeURIComponent(s);
}

async function load(url, { push = true } = {}) {
  st.status = `${fg(P.yellow)}loading ${url} …`;
  draw();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const type = res.headers.get("content-type") || "";
    const body = await res.text();
    if (push && st.url) st.history.push(st.url);
    st.url = res.url || url;
    if (/html|xml/i.test(type) || /^\s*</.test(body)) {
      const doc = parse(body, st.url);
      st.title = doc.title; st.links = doc.links; st.blocks = doc.blocks;
    } else {
      st.title = st.url; st.links = [];
      st.blocks = [{ kind: "pre", spans: [{ text: body.slice(0, 200000), style: "" }] }];
    }
    st.scroll = 0;
    st.status = res.ok ? "" : `${fg(P.pink)}HTTP ${res.status}`;
  } catch (e) {
    st.status = `${fg(P.pink)}${e.name === "TimeoutError" ? "timed out" : e.message}`;
  }
  relayout();
  draw();
}

function relayout() {
  const width = Math.max(20, Math.min(termSize().cols - 4, 110));
  st.lines = st.blocks ? layout(st.blocks, width) : [];
}

// ---------- screen ----------
function draw() {
  const { cols, rows } = termSize();
  if (cols !== st.cols) { st.cols = cols; relayout(); }
  const view = rows - 3;
  st.scroll = Math.max(0, Math.min(st.scroll, Math.max(0, st.lines.length - view)));
  const out = [];
  const bar = bg(P.bar);
  out.push(bar + fit(` ${fg(P.violet)}${BOLD}◆${RESET}${bar} ${fg(P.text)}${st.title || "browser"}`, cols, " ", bar));
  out.push(bar + fit(` ${fg(P.cyan)}${st.url || ""}`, cols, " ", bar));
  for (let i = 0; i < view; i++) out.push(bg(P.bg) + fit("  " + (st.lines[st.scroll + i] ?? ""), cols, " ", bg(P.bg)));
  let foot;
  if (st.input !== null) foot = ` ${fg(P.yellow)}${BOLD}url / search ›${RESET}${bar} ${fg(P.text)}${st.input}█`;
  else if (st.num) foot = ` ${fg(P.yellow)}${BOLD}link ${st.num}${RESET}${bar}${fg(P.dim)}  enter open · esc cancel`;
  else if (st.status) foot = " " + st.status;
  else {
    const pct = st.lines.length ? Math.min(100, Math.round(((st.scroll + view) / st.lines.length) * 100)) : 100;
    foot = ` ${fg(P.dim)}j/k scroll · 12+enter link · u url · h back · y copy · q quit ${fg(P.border)}${pct}%`;
  }
  out.push(bar + fit(foot, cols, " ", bar));
  process.stdout.write("\x1b[H" + out.map((l) => l + RESET).join("\r\n"));
}

function openExternal(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); st.status = `${fg(P.green)}opened in the system browser of this machine`; }
  catch { st.status = `${fg(P.pink)}could not open a system browser`; }
}

function quit() { process.stdout.write(RESET + "\x1b[?25h\x1b[?1049l"); process.exit(0); }

function key(k) {
  const view = termSize().rows - 3;
  if (st.input !== null) {
    if (k === "\r" || k === "\n") { const v = st.input; st.input = null; load(toUrl(v)); return; }
    if (k === "\x1b") st.input = null;
    else if (k === "\x7f" || k === "\b") st.input = [...st.input].slice(0, -1).join("");
    else if (!k.startsWith("\x1b") && !/[\x00-\x1f]/.test(k)) st.input += k;
    return draw();
  }
  if (/^[0-9]$/.test(k)) { st.num += k; return draw(); }
  if (st.num && (k === "\r" || k === "\n")) {
    const target = st.links[Number(st.num) - 1]; st.num = "";
    if (target) return load(target);
    st.status = `${fg(P.pink)}no such link`; return draw();
  }
  if (st.num && (k === "\x1b" || k === "\x7f")) { st.num = ""; return draw(); }
  st.status = "";
  switch (k) {
    case "q": case "\x03": return quit();
    case "j": case "\x1b[B": st.scroll += 1; break;
    case "k": case "\x1b[A": st.scroll -= 1; break;
    case " ": case "\x1b[6~": case "f": st.scroll += view - 1; break;
    case "b": case "\x1b[5~": st.scroll -= view - 1; break;
    case "g": st.scroll = 0; break;
    case "G": st.scroll = st.lines.length; break;
    case "u": case "/": st.input = ""; break;
    case "r": return load(st.url, { push: false });
    case "h": case "\x1b[D": case "\x7f": { const prev = st.history.pop(); if (prev) return load(prev, { push: false }); break; }
    case "y": osc52(st.url); st.status = `${fg(P.green)}url copied to your clipboard`; break;
    case "o": openExternal(st.url); break;
  }
  draw();
}

process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  // split pasted bursts into keys but keep escape sequences together
  const parts = d.match(/\x1b\[[0-9;]*[~A-Za-z]|\x1b|[\s\S]/gu) || [];
  for (const p of parts) key(p);
});
process.stdout.on("resize", () => { relayout(); draw(); });
process.on("SIGTERM", quit);

const start = process.env.NV_URL || process.argv[2];
if (start) load(toUrl(start));
else { st.input = ""; st.title = "browser"; st.status = ""; draw(); }
