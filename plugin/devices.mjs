// Devices — Android devices/emulators (adb) and iOS simulators/devices (macOS)
// on the machine this pane runs on.
// Keys: ↑↓ / j k select · ⏎ boot a stopped emulator/simulator · y copy id · r refresh · q close
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { P, fg, bg, RESET, BOLD, fit, osc52, termSize } from "./ui.mjs";

const run = promisify(execFile);
const WIN = process.platform === "win32";
// NV_DEMO_DIR: read canned tool output from fixture files (README screenshots, parser tests).
const DEMO = process.env.NV_DEMO_DIR || "";
const MAC = process.platform === "darwin" || !!DEMO;
const exe = (n) => (WIN ? n + ".exe" : n);

async function sh(cmd, args, timeout = 5000) {
  if (DEMO) {
    const f = join(DEMO, `${basename(cmd).replace(/\.exe$/, "")} ${args.join(" ")}`.replace(/[^A-Za-z0-9.-]+/g, "_") + ".txt");
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  try { return (await run(cmd, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout; }
  catch { return null; }
}

function sdkRoots() {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    join(homedir(), "Library", "Android", "sdk"), join(homedir(), "Android", "Sdk"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk")];
  return roots.filter(Boolean);
}
function findTool(name, sub, override) {
  if (override) return override;
  for (const r of sdkRoots()) { const p = join(r, sub, exe(name)); if (existsSync(p)) return p; }
  return name; // fall back to PATH
}
const ADB = findTool("adb", "platform-tools", process.env.NV_ADB);
const EMULATOR = findTool("emulator", "emulator", process.env.NV_EMULATOR);

// ---------- collectors ----------
async function android() {
  const out = await sh(ADB, ["devices", "-l"]);
  if (out === null) return { missing: true, rows: [] };
  const rows = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions.*?)(?:\s+(.*))?$/);
    if (!m) continue;
    const props = Object.fromEntries((m[3] || "").split(/\s+/).filter((p) => p.includes(":")).map((p) => p.split(/:(.*)/).slice(0, 2)));
    rows.push({ kind: "android", id: m[1], state: m[2] === "device" ? "online" : m[2], name: (props.model || m[1]).replace(/_/g, " "),
      emulator: m[1].startsWith("emulator-"), detail: "" });
  }
  await Promise.all(rows.filter((r) => r.state === "online").map(async (r) => {
    const [ver, avd] = await Promise.all([
      sh(ADB, ["-s", r.id, "shell", "getprop", "ro.build.version.release"]),
      r.emulator ? sh(ADB, ["-s", r.id, "emu", "avd", "name"]) : null,
    ]);
    if (avd) { r.avd = avd.split(/\r?\n/)[0].trim(); if (r.avd) r.name = r.avd.replace(/_/g, " "); }
    r.detail = `Android ${ver ? ver.trim() : "?"}${r.emulator ? " · emulator" : " · device"}`;
  }));
  return { missing: false, rows };
}

async function avds(running) {
  const out = await sh(EMULATOR, ["-list-avds"]);
  if (out === null) return [];
  const live = new Set(running.map((r) => r.avd).filter(Boolean));
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/\s/.test(l) && !live.has(l))
    .map((name) => ({ kind: "avd", id: name, name: name.replace(/_/g, " "), state: "stopped", detail: "Android emulator · not running" }));
}

async function simulators() {
  if (!MAC) return [];
  const out = await sh("xcrun", ["simctl", "list", "devices", "available", "--json"], 8000);
  if (!out) return [];
  let data; try { data = JSON.parse(out); } catch { return []; }
  const rows = [];
  for (const [runtime, list] of Object.entries(data.devices || {})) {
    const os = runtime.split(".").pop().replace(/^([A-Za-z]+)-/, "$1 ").replace(/-/g, ".");
    for (const d of list) rows.push({ kind: "sim", id: d.udid, name: d.name, state: d.state === "Booted" ? "online" : "stopped", detail: `${os} · simulator` });
  }
  return rows;
}

let physCache = { at: 0, rows: [] };
async function iosDevices() {
  if (!MAC) return [];
  if (Date.now() - physCache.at < 15000) return physCache.rows;
  const out = await sh("xcrun", ["xctrace", "list", "devices"], 10000);
  const rows = [];
  if (out) {
    const section = out.split(/^== /m).find((s) => s.startsWith("Devices =="));
    for (const line of (section || "").split(/\r?\n/).slice(1)) {
      const m = line.trim().match(/^(.*) \(([\d.]+)\) \(([0-9A-Fa-f-]+)\)$/);
      if (m) rows.push({ kind: "ios", id: m[3], name: m[1], state: "online", detail: `iOS ${m[2]} · device` });
    }
  }
  physCache = { at: Date.now(), rows };
  return rows;
}

// ---------- state ----------
const st = { sections: [], flat: [], sel: 0, note: "", adbMissing: false, loading: true };

async function refresh() {
  const [a, sims, phys] = await Promise.all([android(), simulators(), iosDevices()]);
  const stopped = await avds(a.rows);
  st.adbMissing = a.missing;
  st.sections = [
    { title: "Android · connected", rows: a.rows },
    { title: "iOS · connected", rows: [...phys, ...sims.filter((s) => s.state === "online")] },
    { title: "Android emulators · not running", rows: stopped },
    { title: "iOS simulators · not running", rows: sims.filter((s) => s.state !== "online") },
  ].filter((s) => s.rows.length);
  st.flat = st.sections.flatMap((s) => s.rows);
  st.sel = Math.max(0, Math.min(st.sel, st.flat.length - 1));
  st.loading = false;
}

const ICON = {
  online: () => `${fg(P.green)}●`, stopped: () => `${fg(P.dim)}○`,
  unauthorized: () => `${fg(P.pink)}▲`, offline: () => `${fg(P.pink)}▲`,
};

function draw() {
  const { cols, rows } = termSize();
  const B = bg(P.bg);
  const lines = [];
  const online = st.flat.filter((r) => r.state === "online").length;
  lines.push(` ${fg(P.violet)}${BOLD}◆ Devices${RESET}${B}  ${fg(P.dim)}${st.loading ? "scanning…" : `${online} connected · ${st.flat.length - online} not connected`}`);
  lines.push("");
  const body = [];
  let i = 0;
  for (const s of st.sections) {
    body.push({ text: ` ${fg(P.pink)}${BOLD}${s.title}${RESET}${B}` });
    for (const r of s.rows) {
      const sel = i === st.sel;
      const mark = sel ? `${fg(P.yellow)}${BOLD}›${RESET}` : " ";
      const row = `${mark}${sel ? bg(P.bar) : B} ${(ICON[r.state] || ICON.offline)()} ${fg(P.text)}${sel ? BOLD : ""}${fit(r.name, 30)}${RESET}${sel ? bg(P.bar) : B} ` +
        `${fg(P.cyan)}${fit(r.id, 38)} ${fg(r.state === "online" || r.state === "stopped" ? P.dim : P.pink)}${r.state === "online" || r.state === "stopped" ? r.detail : r.state}`;
      body.push({ text: " " + row, index: i, sel });
      i++;
    }
    body.push({ text: "" });
  }
  if (!st.loading && !st.flat.length) body.push({ text: ` ${fg(P.dim)}No devices found.` });
  if (st.adbMissing) body.push({ text: ` ${fg(P.yellow)}adb not found${fg(P.dim)} — install Android platform-tools or set ANDROID_HOME.` });
  const view = rows - 4;
  const selLine = body.findIndex((b) => b.sel);
  const top = selLine >= view ? selLine - view + 2 : 0;
  for (const b of body.slice(top, top + view)) lines.push(b.sel ? fit(b.text, cols, " ", bg(P.bar)) : b.text);
  while (lines.length < rows - 1) lines.push("");
  lines.length = rows - 1;
  lines.push(st.note ? ` ${st.note}` : `${fg(P.dim)} ↑↓ select   enter boot emulator/simulator   y copy id   r refresh   q close`);
  process.stdout.write("\x1b[H" + lines.map((l) => B + "\x1b[2K" + fit(l, cols, " ", B) + RESET).join("\r\n"));
}

async function boot(r) {
  if (!r) return;
  if (r.kind === "avd") {
    try { spawn(EMULATOR, ["-avd", r.id], { detached: true, stdio: "ignore", windowsHide: true }).unref(); st.note = `${fg(P.green)}booting ${r.name}…`; }
    catch { st.note = `${fg(P.pink)}could not start the emulator`; }
  } else if (r.kind === "sim" && r.state !== "online") {
    st.note = `${fg(P.green)}booting ${r.name}…`; draw();
    await sh("xcrun", ["simctl", "boot", r.id], 30000);
    spawn("open", ["-a", "Simulator"], { detached: true, stdio: "ignore" }).unref();
  } else st.note = `${fg(P.dim)}${r.name} is already running`;
}

let busy = false;
async function tick() { if (busy) return; busy = true; try { await refresh(); draw(); } finally { busy = false; } }
function quit() { process.stdout.write(RESET + "\x1b[?25h\x1b[?1049l"); process.exit(0); }

process.stdout.write("\x1b[?1049h\x1b[?25l" + bg(P.bg) + "\x1b[2J");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (k) => {
  st.note = "";
  if (k === "q" || k === "\x03" || k === "\x1b") return quit();
  if (k === "j" || k === "\x1b[B") st.sel = Math.min(st.flat.length - 1, st.sel + 1);
  else if (k === "k" || k === "\x1b[A") st.sel = Math.max(0, st.sel - 1);
  else if (k === "r") return tick();
  else if (k === "y" && st.flat[st.sel]) { osc52(st.flat[st.sel].id); st.note = `${fg(P.green)}copied ${st.flat[st.sel].id}`; }
  else if (k === "\r" || k === "\n") { await boot(st.flat[st.sel]); setTimeout(tick, 4000); }
  draw();
});
process.stdout.on("resize", draw);
process.on("SIGTERM", quit);

draw();
tick();
setInterval(tick, 3000);
