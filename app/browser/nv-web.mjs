#!/usr/bin/env node
// nv-web: a real Chrome/Edge window that people use directly and agents drive through the
// DevTools protocol. Each owner (an hc terminal such as t7, or "person") gets its own tab, so
// several agents can work side by side while the person watches them in Herdr's Browser window.
//
//   nv-web open <url> [--owner t7]        open or navigate the owner's tab
//   nv-web snapshot                       numbered list of what can be clicked or typed into
//   nv-web click <n> | click-at <x> <y>   click a snapshot target or a viewport point (CSS px)
//   nv-web type <n> <text> [--submit] [--clear]
//   nv-web insert <text> | key <name>     type into whatever has focus / press Enter, Tab, Escape…
//   nv-web scroll <dy> [--x X --y Y --dx DX]
//   nv-web screenshot <file.png>          the owner's viewport; prints its CSS size
//   nv-web inspect <n> | inspect-at <x> <y>   selector, styles, HTML and source file (React/Vue/Svelte)
//   nv-web console [--errors] | network [--failed]   what the tab logged and requested
//   nv-web css "<rules>" | css --reset    try a style fix live before editing the code
//   nv-web text | eval <js> | back | forward | reload | show | tabs | status | close | stop
//   nv-web view                           live picture + mouse/keys in a Herdr terminal (Kitty graphics)
//
// --owner defaults to $HC_TERMINAL_ID (the calling agent), else "person". --json prints JSON.
// No dependencies: Node 22+ (global fetch and WebSocket).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const ROOT = join(HOME, "browser");
const PROFILE = join(ROOT, "profile");
const STATE = join(ROOT, "state.json");
const LOGS = join(ROOT, "logs");
const WATCHER = join(ROOT, "watcher.pid");

export class UsageError extends Error {}

export function parseArgs(argv, env = process.env) {
  const flags = { json: false, submit: false, clear: false, errors: false, failed: false, reset: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const bool = { "--json": "json", "--submit": "submit", "--clear": "clear", "--errors": "errors", "--failed": "failed", "--reset": "reset" }[a];
    if (bool) flags[bool] = true;
    else if (["--owner", "--x", "--y", "--dx", "--limit"].includes(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags[a.slice(2)] = argv[++i];
    } else rest.push(a);
  }
  const owner = flags.owner || env.HC_TERMINAL_ID || "person";
  if (!/^[A-Za-z0-9._/-]{1,64}$/.test(owner)) throw new UsageError(`bad owner: ${owner}`);
  return { command: rest[0] ?? "help", args: rest.slice(1), owner, flags };
}

/** A URL to open: bare hosts get https (http for localhost), and anything else is a search. */
export function normalizeUrl(input) {
  const text = String(input ?? "").trim();
  if (!text) return "about:blank";
  if (/^(about|chrome|edge|file|data|view-source):/i.test(text) || /^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

const KEYS = {
  enter: ["Enter", "Enter", 13, "\r"], tab: ["Tab", "Tab", 9], escape: ["Escape", "Escape", 27], esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8], delete: ["Delete", "Delete", 46], space: [" ", "Space", 32, " "],
  up: ["ArrowUp", "ArrowUp", 38], down: ["ArrowDown", "ArrowDown", 40], left: ["ArrowLeft", "ArrowLeft", 37], right: ["ArrowRight", "ArrowRight", 39],
  pageup: ["PageUp", "PageUp", 33], pagedown: ["PageDown", "PageDown", 34], home: ["Home", "Home", 36], end: ["End", "End", 35],
};
/** DevTools key events for a key name (enter, tab, arrows…; "arrowdown" spellings too). */
export function keyEvents(name) {
  const k = KEYS[String(name).toLowerCase().replace(/^arrow/, "")];
  if (!k) throw new UsageError(`unknown key: ${name} (${Object.keys(KEYS).join(", ")})`);
  const [key, code, windowsVirtualKeyCode, text] = k;
  const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  return [{ type: "keyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) }, { type: "keyUp", ...base }];
}

// Runs in the page: numbers visible controls (data-nv-ref) and describes them.
export const SNAPSHOT_JS = `(() => {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[contenteditable=""],[contenteditable=true],[onclick]';
  for (const e of document.querySelectorAll('[data-nv-ref]')) e.removeAttribute('data-nv-ref');
  const out = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || st.visibility === 'hidden' || st.display === 'none') continue;
    el.setAttribute('data-nv-ref', String(++n));
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'input' ? 'input:' + (el.type || 'text') : tag);
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.push({ ref: n, role, name, href: el.href || undefined, visible: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth });
    if (n >= 400) break;
  }
  const text = document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 4000) : '';
  return { url: location.href, title: document.title, elements: out, text };
})()`;

export function formatSnapshot(s) {
  const lines = [`${s.title || "(untitled)"} — ${s.url}`, ""];
  for (const e of s.elements) lines.push(`[${e.ref}] ${e.role}${e.name ? ` "${e.name}"` : ""}${e.href ? ` → ${e.href}` : ""}${e.visible ? "" : " (off-screen)"}`);
  if (!s.elements.length) lines.push("(nothing clickable)");
  if (s.text) lines.push("", "--- text ---", s.text);
  return lines.join("\n");
}

// Runs in the page as (x, y, ref): what an element is, how it looks and which source file made
// it (React, Vue and Svelte dev builds). A snapshot ref wins over the point. It outlines the
// element so screenshots show what was picked.
export const INSPECT_JS = `((x, y, ref) => {
  const el = ref != null ? document.querySelector('[data-nv-ref="' + ref + '"]') : document.elementFromPoint(x, y);
  if (!el) return null;
  const path = e => { const parts = [];
    while (e && e.nodeType === 1 && parts.length < 6) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + CSS.escape(e.id)); break; }
      s += [...e.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      const p = e.parentElement;
      if (p) { const same = [...p.children].filter(c => c.tagName === e.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(e) + 1) + ')'; }
      parts.unshift(s); e = p;
    }
    return parts.join(' > '); };
  let source = null;
  for (let e = el; e && !source; e = e.parentElement) {
    const fk = Object.keys(e).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fk) {
      let found = null;
      for (let f = e[fk]; f && !found; f = f.return) if (f._debugSource) found = { file: f._debugSource.fileName, line: f._debugSource.lineNumber };
      for (let f = e[fk]; f; f = f.return) { const t = f.type; const n = t && typeof t !== 'string' && (t.displayName || t.name); if (n) { found = { ...(found || {}), component: n }; break; } }
      if (found) source = { framework: 'react', ...found };
    }
    if (!source && e.__vueParentComponent) { const t = e.__vueParentComponent.type || {}; source = { framework: 'vue', file: t.__file, component: t.name || t.__name }; }
    if (!source && e.__svelte_meta) { const l = e.__svelte_meta.loc || {}; source = { framework: 'svelte', file: l.file, line: l.line }; }
    if (!source && e.dataset && (e.dataset.testid || e.dataset.component)) source = { hint: e.dataset.testid || e.dataset.component };
  }
  const cs = getComputedStyle(el), r = el.getBoundingClientRect(), styles = {};
  for (const k of ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'border', 'border-radius', 'z-index', 'opacity', 'overflow']) styles[k] = cs.getPropertyValue(k);
  let mark = document.getElementById('nv-inspect-mark');
  if (!mark) { mark = document.createElement('div'); mark.id = 'nv-inspect-mark'; document.documentElement.appendChild(mark); }
  mark.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #c33cf0;background:rgba(195,60,240,.12);left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
  return { url: location.href, selector: path(el), tag: el.tagName.toLowerCase(), id: el.id || undefined, classes: [...el.classList],
    text: (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 300), html: el.outerHTML.slice(0, 2000),
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, styles, source };
})`;

export function sourceText(source) {
  if (!source) return "";
  const where = source.file ? `${source.file}${source.line ? `:${source.line}` : ""}` : "";
  return [source.component, where, source.hint].filter(Boolean).join(" @ ");
}

export function formatInspect(i) {
  if (!i) return "(no element there)";
  const lines = [i.selector, `<${i.tag}> ${i.box.width}×${i.box.height} at ${i.box.x},${i.box.y}${i.text ? ` — "${i.text.slice(0, 120)}"` : ""}`];
  if (i.source) lines.push(`source: ${sourceText(i.source)}${i.source.framework ? ` (${i.source.framework})` : ""}`);
  lines.push("styles: " + Object.entries(i.styles).filter(([, v]) => v && !["none", "normal", "auto"].includes(v)).map(([k, v]) => `${k}: ${v}`).join("; "));
  lines.push("", i.html);
  return lines.join("\n");
}

/** One tab's log entries (newest last), filtered. */
export function selectLogs(lines, kind, { errors = false, failed = false, limit = 50 } = {}) {
  const out = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (kind === "console" && !["console", "error", "log"].includes(e.kind)) continue;
    if (kind === "network" && e.kind !== "network") continue;
    if (errors && !(e.kind === "error" || e.level === "error" || e.level === "assert")) continue;
    if (failed && !(e.failed || e.status >= 400)) continue;
    out.push(e);
  }
  return out.slice(-limit);
}

export function formatLog(e) {
  const at = e.t ? e.t.slice(11, 19) : "";
  if (e.kind === "network") return `${at} ${e.failed ? "FAILED" : e.status} ${e.method ?? ""} ${e.url}${e.error ? ` (${e.error})` : ""}`;
  return `${at} ${e.kind === "error" ? "ERROR" : (e.level ?? "log").toUpperCase()} ${e.text}${e.url ? `  (${e.url}${e.line != null ? `:${e.line}` : ""})` : ""}`;
}

// ---------------------------------------------------------------- state and the browser process

function readState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { owners: {} }; }
}
function writeState(state) {
  mkdirSync(ROOT, { recursive: true });
  const tmp = `${STATE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE);
}

export function browserCandidates(platform = process.platform, env = process.env) {
  if (env.NV_BROWSER) return [env.NV_BROWSER];
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    return [
      ...roots.map(r => join(r, "Google", "Chrome", "Application", "chrome.exe")),
      ...roots.map(r => join(r, "Microsoft", "Edge", "Application", "msedge.exe")),
    ];
  }
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/snap/bin/chromium"];
}

async function version(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error(`DevTools answered ${r.status}`);
  return r.json();
}

/** The DevTools port of our browser, starting it when it isn't running. */
async function ensureBrowser({ start = true } = {}) {
  const state = readState();
  if (state.port) {
    try { await version(state.port); startWatcher(); return state; } catch { /* gone: start again */ }
  }
  if (!start) return null;
  const exe = browserCandidates().find(p => existsSync(p));
  if (!exe) throw new Error("Chrome or Edge was not found. Install Google Chrome, or set NV_BROWSER to a Chromium browser.");
  mkdirSync(PROFILE, { recursive: true });
  const portFile = join(PROFILE, "DevToolsActivePort");
  try { writeFileSync(portFile, ""); } catch { /* the browser rewrites it */ }
  const child = spawn(exe, [
    `--user-data-dir=${PROFILE}`, "--remote-debugging-port=0",
    "--no-first-run", "--no-default-browser-check",
    // Windows behind Herdr still count as shown: pages keep running and take input.
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion",
    "--new-window", "about:blank",
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 150));
    const port = Number((existsSync(portFile) ? readFileSync(portFile, "utf8") : "").split(/\r?\n/)[0]);
    if (port > 0) {
      try {
        await version(port);
        const next = { port, exe, pid: child.pid, owners: {} };
        writeState(next);
        startWatcher();
        return next;
      } catch { /* not ready yet */ }
    }
  }
  throw new Error(`${exe} did not open its DevTools port`);
}

// ---------------------------------------------------------------- the watcher: console, errors, requests

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Keeps one background watcher that records every tab's console, errors and requests. */
function startWatcher() {
  const pid = Number(existsSync(WATCHER) ? readFileSync(WATCHER, "utf8") : 0);
  if (pid > 0 && alive(pid)) return;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "__watch"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(WATCHER, String(child.pid));
}

const MAX_LINES = 1500, KEEP_LINES = 1000;
function record(targetId, entry, counts) {
  if (!/^[A-Za-z0-9]+$/.test(targetId)) return;
  mkdirSync(LOGS, { recursive: true });
  const file = join(LOGS, `${targetId}.jsonl`);
  appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  counts[targetId] = (counts[targetId] ?? 0) + 1;
  if (counts[targetId] > MAX_LINES) {
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").slice(-KEEP_LINES);
    writeFileSync(file, lines.join("\n") + "\n");
    counts[targetId] = lines.length;
  }
}

const valueText = a => a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.unserializableValue ?? a.description ?? a.type;

async function watch() {
  const state = readState();
  if (!state.port) return;
  const v = await version(state.port);
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const sessions = new Map(), requests = new Map(), counts = {}, attached = new Set();
  const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, ...(sessionId ? { sessionId } : {}) }));
  const attach = info => {
    if (info?.type !== "page" || attached.has(info.targetId)) return;
    attached.add(info.targetId);
    send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    const p = m.params ?? {};
    if (m.method === "Target.targetCreated") return attach(p.targetInfo);
    if (m.method === "Target.attachedToTarget") {
      sessions.set(p.sessionId, p.targetInfo.targetId);
      for (const domain of ["Runtime.enable", "Network.enable", "Log.enable", "Page.enable"]) send(domain, {}, p.sessionId);
      return;
    }
    if (m.method === "Target.detachedFromTarget") { attached.delete(sessions.get(p.sessionId)); return void sessions.delete(p.sessionId); }
    if (m.method === "Target.targetDestroyed") return void attached.delete(p.targetId);
    const target = m.sessionId && sessions.get(m.sessionId);
    if (!target) return;
    const frame = p.stackTrace?.callFrames?.[0] ?? p.exceptionDetails?.stackTrace?.callFrames?.[0];
    switch (m.method) {
      case "Runtime.consoleAPICalled":
        return record(target, { kind: "console", level: p.type === "warning" ? "warn" : p.type, text: (p.args ?? []).map(valueText).join(" ").slice(0, 2000), url: frame?.url, line: frame?.lineNumber != null ? frame.lineNumber + 1 : undefined }, counts);
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails ?? {};
        return record(target, { kind: "error", text: String(d.exception?.description ?? d.text ?? "error").slice(0, 2000), url: d.url ?? frame?.url, line: d.lineNumber != null ? d.lineNumber + 1 : undefined }, counts);
      }
      case "Log.entryAdded": {
        const e = p.entry ?? {};
        return record(target, { kind: "log", level: e.level, text: String(e.text ?? "").slice(0, 2000), url: e.url, source: e.source }, counts);
      }
      case "Page.frameNavigated":
        if (!p.frame?.parentId) record(target, { kind: "navigate", url: p.frame?.url }, counts);
        return;
      case "Network.requestWillBeSent":
        if (!/^(data|blob|chrome-extension):/.test(p.request?.url ?? "")) requests.set(p.requestId, { method: p.request.method, url: p.request.url, type: p.type });
        return;
      case "Network.responseReceived": {
        const r = requests.get(p.requestId);
        if (r) r.status = p.response?.status;
        return;
      }
      case "Network.loadingFinished": case "Network.loadingFailed": {
        const r = requests.get(p.requestId);
        if (!r) return;
        requests.delete(p.requestId);
        if (m.method === "Network.loadingFailed" && p.canceled) return;
        return record(target, { kind: "network", ...r, ...(m.method === "Network.loadingFailed" ? { failed: true, error: p.errorText } : {}) }, counts);
      }
    }
  };
  await new Promise(ok => {
    ws.onclose = ok;
    send("Target.setDiscoverTargets", { discover: true });
    fetch(`http://127.0.0.1:${state.port}/json/list`).then(r => r.json()).then(list => list.forEach(t => attach({ type: t.type, targetId: t.id }))).catch(() => {});
  });
}

function readLogs(targetId) {
  const file = join(LOGS, `${targetId}.jsonl`);
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean) : [];
}

// ---------------------------------------------------------------- tabs and DevTools sessions

async function targets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  return (await r.json()).filter(t => t.type === "page");
}

/** The owner's tab, made (and remembered) when it has none. */
async function ownerTarget(owner, { create = true, url = "about:blank" } = {}) {
  const state = await ensureBrowser({ start: create });
  if (!state) return null;
  const pages = await targets(state.port);
  let target = pages.find(t => t.id === state.owners?.[owner]);
  if (!target && owner === "person" && pages.length) {
    // The window's first blank tab becomes the person's.
    const claimed = new Set(Object.values(state.owners ?? {}));
    target = pages.find(t => !claimed.has(t.id) && t.url === "about:blank");
  }
  if (!target && create) {
    // Each owner gets its own window, so its tab is the shown one there: Chrome drops input
    // (and throttles pages) in background tabs, and agents work side by side.
    const v = await version(state.port);
    const b = await session({ webSocketDebuggerUrl: v.webSocketDebuggerUrl });
    try {
      const made = await b.send("Target.createTarget", { url, newWindow: true, background: true });
      for (let i = 0; i < 20 && !target; i++) {
        target = (await targets(state.port)).find(t => t.id === made.targetId);
        if (!target) await new Promise(r => setTimeout(r, 100));
      }
    } finally { b.close(); }
  }
  if (target && state.owners?.[owner] !== target.id) {
    const fresh = readState();
    fresh.owners = { ...(fresh.owners ?? {}), [owner]: target.id };
    writeState(fresh);
  }
  return target ? { ...target, port: state.port } : null;
}

/** One DevTools session on a tab: send(method, params) → result. */
async function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("could not reach the tab")); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    const w = m.id && waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    clearTimeout(w.timer);
    m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const n = ++id;
    const timer = setTimeout(() => { if (waiting.delete(n)) fail(new Error(`${method} timed out`)); }, 20000);
    waiting.set(n, { ok, fail, timer });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { send, close: () => ws.close() };
}

async function evaluate(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function settle(s) {
  for (let i = 0; i < 50; i++) {
    const state = await evaluate(s, "document.readyState").catch(() => "loading");
    if (state === "complete" || state === "interactive") return;
    await new Promise(r => setTimeout(r, 100));
  }
}

async function clickAt(s, x, y, clickCount = 1) {
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount });
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount });
}

async function refCenter(s, ref) {
  if (!/^\d+$/.test(String(ref))) throw new UsageError(`target must be a snapshot number, got ${ref}`);
  const c = await evaluate(s, `(() => { const el = document.querySelector('[data-nv-ref="${ref}"]'); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!c) throw new Error(`no target [${ref}]: take a fresh snapshot`);
  return c;
}

async function viewport(s) {
  const m = await s.send("Page.getLayoutMetrics");
  const v = m.cssVisualViewport ?? m.cssLayoutViewport ?? m.layoutViewport;
  return { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
}

// ---------------------------------------------------------------- the live view (a terminal program)
// `nv-web view` runs in a Herdr terminal: it draws the owner's tab with Kitty graphics and sends
// the terminal's mouse, wheel and keys to the page. The Browser window's panels steer it through a
// small control file (view-set / view-get): which tab to show, and Inspect mode.

const VIEWS = join(ROOT, "view");
const viewFile = (id, kind = "ctl") => join(VIEWS, `${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}.${kind}.json`);
function readJson(file, fallback) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

const ESC = "\x1b", ST = "\x1b\\";
const SEQ_KEYS = { "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[H": "home", "[F": "end", "OA": "up", "OB": "down", "OC": "right", "OD": "left", "OH": "home", "OF": "end",
  "[1~": "home", "[4~": "end", "[3~": "delete", "[5~": "pageup", "[6~": "pagedown", "[Z": "tab" };

/** Splits terminal input into events: mouse (SGR), keys, text, and replies to our queries. */
export function parseTerminalInput(text) {
  const events = [];
  let i = 0, plain = "";
  const flush = () => { if (plain) { events.push({ type: "text", text: plain }); plain = ""; } };
  while (i < text.length) {
    const c = text[i];
    if (c === ESC) {
      flush();
      const rest = text.slice(i + 1);
      let m;
      if ((m = /^\[<(\d+);(-?\d+);(-?\d+)([Mm])/.exec(rest))) {
        events.push({ type: "mouse", button: Number(m[1]), x: Number(m[2]), y: Number(m[3]), release: m[4] === "m" });
        i += 1 + m[0].length; continue;
      }
      if ((m = /^\[4;(\d+);(\d+)t/.exec(rest))) { events.push({ type: "pixels", height: Number(m[1]), width: Number(m[2]) }); i += 1 + m[0].length; continue; }
      if ((m = /^\[\?(\d+);(\d)\$y/.exec(rest))) { events.push({ type: "mode", mode: Number(m[1]), value: Number(m[2]) }); i += 1 + m[0].length; continue; }
      if ((m = /^(\[[0-9;]*[~A-Z]|O[A-Z])/.exec(rest))) {
        const key = SEQ_KEYS[m[1].replace(/^\[1;\d/, "[")] ?? SEQ_KEYS[m[1]];
        if (key) events.push({ type: "key", key });
        i += 1 + m[0].length; continue;
      }
      events.push({ type: "key", key: "escape" });
      i += 1; continue;
    }
    if (c === "\r" || c === "\n") { flush(); events.push({ type: "key", key: "enter" }); }
    else if (c === "\x7f" || c === "\b") { flush(); events.push({ type: "key", key: "backspace" }); }
    else if (c === "\t") { flush(); events.push({ type: "key", key: "tab" }); }
    else if (c < " ") flush();   // other control keys stay with Herdr, not the page
    else plain += c;
    i += 1;
  }
  flush();
  return events;
}

/** Where the page picture goes: whole cells below the status row, keeping the page's shape. */
export function fitView(page, term) {
  const cellW = term.width / term.cols, cellH = term.height / term.rows;
  const availW = term.cols * cellW, availH = (term.rows - 1) * cellH;
  const scale = Math.min(availW / page.width, availH / page.height);
  const cols = Math.max(1, Math.min(term.cols, Math.round((page.width * scale) / cellW)));
  const rows = Math.max(1, Math.min(term.rows - 1, Math.round((page.height * scale) / cellH)));
  return { cols, rows, cellW, cellH, sx: (cols * cellW) / page.width, sy: (rows * cellH) / page.height };
}

/** A terminal mouse position (pixels when the terminal reports them, else 1-based cells) in page CSS px. */
export function toPage(event, place, pixels) {
  const px = pixels ? event.x : (event.x - 0.5) * place.cellW;
  const py = pixels ? event.y : (event.y - 0.5) * place.cellH;
  return { x: Math.round(px / place.sx), y: Math.round((py - place.cellH) / place.sy) };
}

function kitty(png, place) {
  const data = png.toString("base64");
  let out = `${ESC}[2;1H`;
  for (let i = 0; i < data.length; i += 4096) {
    const more = i + 4096 < data.length ? 1 : 0;
    const head = i === 0 ? `a=T,f=100,i=7,p=1,q=2,C=1,c=${place.cols},r=${place.rows},m=${more}` : `m=${more}`;
    out += `${ESC}_G${head};${data.slice(i, i + 4096)}${ST}`;
  }
  return out;
}

async function view(firstOwner) {
  const id = process.env.HC_TERMINAL_ID || `p${process.pid}`;
  const out = process.stdout, input = process.stdin;
  const term = { cols: out.columns || 120, rows: out.rows || 40, width: 0, height: 0 };
  let pixels = false, cur = null, place = null, lastKey = "", pressAt = 0, clicks = 0, down = false, busy = false;
  const ctl = () => ({ owner: firstOwner, mode: "use", ...readJson(viewFile(id), {}) });
  writeJson(viewFile(id), { owner: firstOwner, mode: "use" });
  const status = text => out.write(`${ESC}[1;1H${ESC}[2K${ESC}[7m ${text.slice(0, Math.max(0, term.cols - 2)).padEnd(Math.max(0, term.cols - 2))} ${ESC}[0m`);
  const cleanup = () => { out.write(`${ESC}_Ga=d,d=I,i=7,q=2${ST}${ESC}[?1016l${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l${ESC}[?25h`); };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));
  if (input.isTTY) input.setRawMode(true);
  input.setEncoding("utf8");
  out.write(`${ESC}[?25l${ESC}[2J${ESC}[?1000h${ESC}[?1002h${ESC}[?1006h${ESC}[?1016h${ESC}[14t${ESC}[?1016$p`);
  out.on("resize", () => { term.cols = out.columns; term.rows = out.rows; out.write(`${ESC}[2J${ESC}[14t`); lastKey = ""; });

  /** A DevTools session on the owner's tab, kept open between frames. */
  const attach = async owner => {
    if (cur && cur.owner === owner && !cur.closed) return cur;
    try { cur?.s.close(); } catch { /* already gone */ }
    const target = await ownerTarget(owner);
    const s = await session(target);
    cur = { owner, s, target, closed: false };
    return cur;
  };
  const act = async fn => {
    try { const c = await attach(ctl().owner); await fn(c.s); } catch (error) { if (cur) cur.closed = true; status(`! ${error.message ?? error}`); }
  };

  input.on("data", text => {
    for (const e of parseTerminalInput(text)) {
      if (e.type === "pixels") { term.width = e.width; term.height = e.height; lastKey = ""; continue; }
      if (e.type === "mode") { if (e.mode === 1016) pixels = e.value === 1 || e.value === 3; continue; }
      if (!place) continue;
      if (e.type === "mouse") {
        const p = toPage(e, place, pixels);
        const wheel = e.button & 64, motion = e.button & 32, button = e.button & 3;
        if (wheel) { act(s => s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: 0, deltaY: (e.button & 1) ? 120 : -120 })); continue; }
        if (button !== 0 && !motion) continue;
        if (motion) { if (down) act(s => s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, buttons: 1 })); continue; }
        if (p.y < 0) continue;
        if (ctl().mode === "inspect") {
          if (e.release) continue;
          act(async s => {
            const found = await evaluate(s, `${INSPECT_JS}(${p.x}, ${p.y}, null)`);
            const shot = join(ROOT, "picks", `${Date.now()}.png`);
            mkdirSync(dirname(shot), { recursive: true });
            writeFileSync(shot, Buffer.from((await s.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
            writeJson(viewFile(id, "picked"), { at: Date.now(), owner: ctl().owner, point: p, shot, element: found });
            writeJson(viewFile(id), { ...ctl(), mode: "use" });
          });
          continue;
        }
        if (!e.release) {
          const now = Date.now();
          clicks = now - pressAt < 400 ? clicks + 1 : 1;
          pressAt = now; down = true;
          act(async s => { await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: clicks }); });
        } else {
          down = false;
          act(s => s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: clicks }));
        }
      } else if (e.type === "key") {
        act(async s => { for (const k of keyEvents(e.key)) await s.send("Input.dispatchKeyEvent", k); });
      } else if (e.type === "text") {
        act(s => s.send("Input.insertText", { text: e.text }));
      }
    }
  });

  for (;;) {
    if (!busy) {
      busy = true;
      try {
        const { owner, mode } = ctl();
        const c = await attach(owner);
        if (!term.width) { term.width = term.cols * 9; term.height = term.rows * 18; }
        const page = await viewport(c.s);
        const info = await evaluate(c.s, "({ url: location.href, title: document.title })");
        place = fitView(page, term);
        const shot = await c.s.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: page.width, height: page.height, scale: Math.min(1, place.sx) } });
        const png = Buffer.from(shot.data, "base64");
        const key = `${place.cols}x${place.rows}:${shot.data.length}:${shot.data.slice(-64)}`;
        if (key !== lastKey) { out.write(kitty(png, place)); lastKey = key; }
        status(`${mode === "inspect" ? "◎ INSPECT — click the element to send · " : ""}${owner === "person" ? "me" : owner} · ${info.title || "(untitled)"} — ${info.url}`);
      } catch (error) {
        if (cur) cur.closed = true;
        status(`! ${error.message ?? error} (retrying)`);
      }
      busy = false;
    }
    await new Promise(r => setTimeout(r, 350));
  }
}

// ---------------------------------------------------------------- commands

async function withTab(owner, fn, options) {
  const target = await ownerTarget(owner, options);
  if (!target) throw new Error(`no browser tab for ${owner}`);
  const s = await session(target);
  try { return await fn(s, target); } finally { s.close(); }
}

export async function run({ command, args, owner, flags }) {
  const need = (n, what) => { if (args.length < n) throw new UsageError(`${command} needs ${what}`); };
  const numbers = list => {
    const out = list.map(Number);
    if (!out.every(Number.isFinite)) throw new UsageError(`${command} needs numbers`);
    return out;
  };
  switch (command) {
    case "open": {
      const url = normalizeUrl(args.join(" "));
      return withTab(owner, async (s) => {
        await s.send("Page.enable");
        await s.send("Page.navigate", { url });
        await settle(s);
        return { owner, url: await evaluate(s, "location.href"), title: await evaluate(s, "document.title") };
      });
    }
    case "snapshot": return withTab(owner, async s => evaluate(s, SNAPSHOT_JS));
    case "text": return withTab(owner, async s => ({ text: await evaluate(s, "document.body ? document.body.innerText : ''") }));
    case "eval": need(1, "JavaScript"); return withTab(owner, async s => ({ value: await evaluate(s, args.join(" ")) }));
    case "click": need(1, "a snapshot number"); return withTab(owner, async s => { const c = await refCenter(s, args[0]); await clickAt(s, c.x, c.y); return { clicked: Number(args[0]), ...c }; });
    case "click-at": {
      need(2, "x and y");
      const [x, y] = numbers(args.slice(0, 2));
      return withTab(owner, async s => { await clickAt(s, x, y, Number(args[2]) || 1); return { x, y }; });
    }
    case "type": {
      need(2, "a snapshot number and text");
      return withTab(owner, async s => {
        const c = await refCenter(s, args[0]);
        await clickAt(s, c.x, c.y);
        if (flags.clear) await evaluate(s, `(() => { const el = document.querySelector('[data-nv-ref="${args[0]}"]'); if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
        await s.send("Input.insertText", { text: args.slice(1).join(" ") });
        if (flags.submit) for (const e of keyEvents("enter")) await s.send("Input.dispatchKeyEvent", e);
        return { typed: Number(args[0]), submitted: flags.submit };
      });
    }
    case "insert": need(1, "text"); return withTab(owner, async s => { await s.send("Input.insertText", { text: args.join(" ") }); return { inserted: true }; });
    case "key": need(1, "a key name"); return withTab(owner, async s => { for (const e of keyEvents(args[0])) await s.send("Input.dispatchKeyEvent", e); return { key: args[0] }; });
    case "scroll": {
      need(1, "a distance (positive: down)");
      const [dy] = numbers([args[0]]);
      return withTab(owner, async s => {
        const v = await viewport(s);
        const x = Number(flags.x ?? v.width / 2), y = Number(flags.y ?? v.height / 2);
        await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: Number(flags.dx ?? 0), deltaY: dy });
        return { scrolled: dy };
      });
    }
    case "screenshot": {
      need(1, "a file path");
      return withTab(owner, async (s, target) => {
        const shot = await s.send("Page.captureScreenshot", { format: "png" });
        mkdirSync(dirname(args[0]), { recursive: true });
        const tmp = `${args[0]}.${process.pid}.tmp`;
        writeFileSync(tmp, Buffer.from(shot.data, "base64"));
        renameSync(tmp, args[0]);
        const page = await evaluate(s, "({ url: location.href, title: document.title })");
        return { path: args[0], ...(await viewport(s)), ...page, id: target.id };
      });
    }
    case "inspect": case "inspect-at": {
      const point = command === "inspect-at";
      need(point ? 2 : 1, point ? "x and y" : "a snapshot number");
      if (!point && !/^\d+$/.test(args[0])) throw new UsageError(`target must be a snapshot number, got ${args[0]}`);
      const [x, y] = point ? numbers(args.slice(0, 2)) : [0, 0];
      return withTab(owner, async s => {
        const found = await evaluate(s, `${INSPECT_JS}(${x}, ${y}, ${point ? "null" : Number(args[0])})`);
        if (!found) throw new Error(point ? `nothing at ${x},${y}` : `no target [${args[0]}]: take a fresh snapshot`);
        return found;
      });
    }
    case "css": {
      if (!flags.reset) need(1, "CSS rules, or --reset");
      const rules = JSON.stringify(args.join(" "));
      return withTab(owner, async s => {
        await evaluate(s, flags.reset
          ? "document.getElementById('nv-live-css')?.remove(); document.getElementById('nv-inspect-mark')?.remove()"
          : `(() => { let st = document.getElementById('nv-live-css'); if (!st) { st = document.createElement('style'); st.id = 'nv-live-css'; document.head.appendChild(st); } st.textContent += '\\n' + ${rules}; })()`);
        return { css: flags.reset ? "reset" : "applied" };
      });
    }
    case "console": case "network": {
      const t = await ownerTarget(owner, { create: false });
      if (!t) return { entries: [] };
      return { entries: selectLogs(readLogs(t.id), command, { errors: flags.errors, failed: flags.failed, limit: Number(flags.limit) || 50 }) };
    }
    case "__watch": await watch(); return { watched: true };
    case "view": await view(owner); return {};
    case "view-set": {
      need(1, "the view's terminal id");
      const file = viewFile(args[0]);
      const next = { owner: "person", mode: "use", ...readJson(file, {}) };
      if (flags.owner) next.owner = owner;
      if (args[1] === "inspect" || args[1] === "use") next.mode = args[1];
      writeJson(file, next);
      return next;
    }
    case "view-get": {
      need(1, "the view's terminal id");
      return { ctl: readJson(viewFile(args[0]), null), picked: readJson(viewFile(args[0], "picked"), null) };
    }
    case "back": case "forward":
      return withTab(owner, async s => { await evaluate(s, `history.${command}()`); await settle(s); return { [command]: true }; });
    case "reload":
      return withTab(owner, async s => { await s.send("Page.reload"); await settle(s); return { reload: true }; });
    case "show": {
      const t = await ownerTarget(owner);
      await fetch(`http://127.0.0.1:${t.port}/json/activate/${t.id}`, { signal: AbortSignal.timeout(3000) });
      return { shown: t.id };
    }
    case "tabs": case "status": {
      const state = await ensureBrowser({ start: false });
      if (!state) return { running: false, tabs: [] };
      const pages = await targets(state.port);
      const byId = Object.fromEntries(Object.entries(state.owners ?? {}).map(([o, id]) => [id, o]));
      return { running: true, port: state.port, browser: state.exe, tabs: pages.map(p => ({ owner: byId[p.id] ?? null, id: p.id, url: p.url, title: p.title })) };
    }
    case "close": {
      const t = await ownerTarget(owner, { create: false });
      if (t) await fetch(`http://127.0.0.1:${t.port}/json/close/${t.id}`, { signal: AbortSignal.timeout(3000) });
      const fresh = readState();
      if (fresh.owners) { delete fresh.owners[owner]; writeState(fresh); }
      return { closed: Boolean(t) };
    }
    case "stop": {
      const state = await ensureBrowser({ start: false });
      if (!state) return { stopped: false };
      const v = await version(state.port);
      const s = await session({ webSocketDebuggerUrl: v.webSocketDebuggerUrl });
      await s.send("Browser.close").catch(() => {});
      s.close();
      writeState({ owners: {} });
      return { stopped: true };
    }
    case "help": case "--help": case "-h":
      return { help: readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).map(l => l.replace(/^\/\/ ?/, "")).join("\n") };
    default: throw new UsageError(`unknown command: ${command} (nv-web help)`);
  }
}

function print(command, result, json) {
  if (json) return console.log(JSON.stringify(result));
  if (result.help) return console.log(result.help);
  if (command === "snapshot") return console.log(formatSnapshot(result));
  if (command === "text") return console.log(result.text);
  if (command === "inspect" || command === "inspect-at") return console.log(formatInspect(result));
  if (command === "console" || command === "network") return console.log(result.entries.length ? result.entries.map(formatLog).join("\n") : `(no ${command} entries)`);
  if (command === "eval") return console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2));
  if (command === "tabs" || command === "status") {
    if (!result.running) return console.log("browser not running");
    for (const t of result.tabs) console.log(`${(t.owner ?? "-").padEnd(10)} ${t.title || "(untitled)"} — ${t.url}`);
    return;
  }
  console.log(Object.entries(result).map(([k, v]) => `${k}: ${v}`).join("  "));
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (invoked) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    const result = await run(parsed);
    if (parsed.command !== "__watch" && parsed.command !== "view") print(parsed.command, result, parsed.flags.json);
    process.exit(0);
  } catch (error) {
    const msg = String(error?.message ?? error);
    if (parsed?.flags.json) console.error(JSON.stringify({ error: msg }));
    else console.error(`nv-web: ${msg}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
