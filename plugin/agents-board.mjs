// ALL agents — every agent on this herdr server, tiled in one tab.
// Keys: 1-9 jump to that agent · r refresh · q quit
//       ctrl+d done · ctrl+w working · ctrl+i idle · ctrl+a all (plain d/w/i/a work too, b = blocked)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import { P, fg, bg, RESET, BOLD, fit, cleanLines, termSize } from "./ui.mjs";

const run = promisify(execFile);
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const SELF = process.env.HERDR_PANE_ID || "";
const INTERVAL_MS = 1500;

const STATE = {
  blocked: { icon: "▲", label: "BLOCKED", color: P.pink, rank: 0 },
  working: { icon: "●", label: "WORKING", color: P.yellow, rank: 1 },
  done:    { icon: "✔", label: "DONE",    color: P.green, rank: 2 },
  idle:    { icon: "○", label: "IDLE",    color: P.cyan, rank: 3 },
  unknown: { icon: "·", label: "UNKNOWN", color: P.dim, rank: 4 },
};

const opts = { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };

async function api(args) {
  try { return JSON.parse((await run(HERDR, args, opts)).stdout).result; } catch { return null; }
}
async function tail(paneId, lines) {
  try {
    return (await run(HERDR, ["agent", "read", paneId, "--lines", String(lines), "--source", "recent"], opts)).stdout;
  } catch { return ""; }
}

let agents = [];
let error = "";
let filter = "all"; // all | blocked | working | done | idle

const statusOf = (a) => (a.agent_status in STATE ? a.agent_status : "unknown");
const shown = () => (filter === "all" ? agents : agents.filter((a) => statusOf(a) === filter));
// ctrl+d / ctrl+w / ctrl+i (same byte as tab) / ctrl+a, plus the plain letters
const FILTER_KEYS = { "": "done", d: "done", "": "working", w: "working", "	": "idle", i: "idle", "": "all", a: "all", b: "blocked" };

async function refresh() {
  const [list, ws, tabs] = await Promise.all([api(["agent", "list"]), api(["workspace", "list"]), api(["tab", "list"])]);
  if (!list) { error = "herdr API not reachable"; return; }
  error = "";
  const wsLabel = new Map((ws?.workspaces || []).map((w) => [w.workspace_id, w.label || w.workspace_id]));
  const tabLabel = new Map((tabs?.tabs || []).map((t) => [t.tab_id, t.label || t.tab_id]));
  const items = (list.agents || [])
    .filter((a) => a.pane_id !== SELF)
    .map((a) => ({
      ...a,
      state: STATE[a.agent_status] || STATE.unknown,
      where: `${wsLabel.get(a.workspace_id) || a.workspace_id} / ${tabLabel.get(a.tab_id) || a.tab_id}`,
    }))
    .sort((a, b) => a.state.rank - b.state.rank || a.workspace_id.localeCompare(b.workspace_id));
  const { rows } = termSize();
  await Promise.all(items.map(async (a) => { a.lines = cleanLines(await tail(a.pane_id, rows)); }));
  agents = items;
}

function geometry(n) {
  const { cols, rows } = termSize();
  let ncol = cols >= 150 ? 3 : cols >= 96 ? 2 : 1;
  ncol = Math.max(1, Math.min(ncol, n || 1));
  const nrow = Math.max(1, Math.ceil((n || 1) / ncol));
  const avail = rows - 3;
  const cardH = Math.max(4, Math.floor(avail / nrow));
  const cardW = Math.floor((cols - (ncol - 1)) / ncol);
  return { cols, rows, ncol, nrow, cardH, cardW, body: cardH - 2 };
}

function card(a, idx, w, h) {
  const b = fg(P.border), s = a.state;
  const num = idx < 9 ? `${idx + 1}` : " ";
  const head = ` ${fg(P.yellow)}${BOLD}${num}${RESET}${bg(P.bg)} ${fg(s.color)}${s.icon}${RESET}${bg(P.bg)} ${fg(P.violet)}${BOLD}${a.agent || "agent"}${RESET}${bg(P.bg)}${fg(P.dim)} · ${a.where} `;
  const out = [b + "╭─" + fit(head, w - 4, "─", b) + b + "─╮"];
  const lines = (a.lines || []).slice(-(h - 2));
  while (lines.length < h - 2) lines.push("");
  for (const l of lines) out.push(b + "│" + RESET + bg(P.bg) + fg(P.text) + " " + fit(l, w - 4) + " " + b + "│");
  const foot = ` ${fg(s.color)}${BOLD}${s.label}${RESET}${bg(P.bg)}${fg(P.dim)} · ${a.cwd ? basename(a.cwd.replace(/[\\/]+$/, "")) : a.pane_id} `;
  out.push(b + "╰─" + fit(foot, w - 4, "─", b) + b + "─╯");
  return out;
}

function render() {
  const list = shown();
  const g = geometry(list.length);
  const counts = Object.fromEntries(Object.keys(STATE).map((k) => [k, 0]));
  for (const a of agents) counts[a.agent_status in STATE ? a.agent_status : "unknown"]++;
  const tab = (k, text, color) => (filter === k
    ? `${bg(color)}${fg(P.bg)}${BOLD} ${text} ${RESET}${bg(P.bg)}`
    : `${fg(color)} ${text} ${RESET}${bg(P.bg)}`);
  const summary = [tab("all", `all ${agents.length}`, P.violet)]
    .concat(["blocked", "working", "done", "idle"].map((k) => tab(k, `${STATE[k].icon} ${counts[k]} ${STATE[k].label.toLowerCase()}`, STATE[k].color)))
    .join(" ");
  const lines = [];
  lines.push(` ${fg(P.violet)}${BOLD}◆ ALL agents${RESET}${bg(P.bg)}  ${summary}`);
  if (error) lines.push(` ${fg(P.pink)}${error}`);
  else if (!agents.length) lines.push(` ${fg(P.dim)}No agents yet. Start claude / codex / gemini in any pane and it shows up here.`);
  else if (!list.length) lines.push(` ${fg(P.dim)}No ${filter} agents right now. Press ctrl+a to show all.`);
  else {
    for (let r = 0; r < g.nrow; r++) {
      const row = list.slice(r * g.ncol, r * g.ncol + g.ncol).map((a, i) => card(a, r * g.ncol + i, g.cardW, g.cardH));
      for (let y = 0; y < g.cardH; y++) lines.push(row.map((c) => c[y]).join(bg(P.bg) + " "));
    }
  }
  while (lines.length < g.rows - 1) lines.push("");
  lines.length = g.rows - 1;
  const help = `${fg(P.dim)} 1-9 jump  ctrl+d done  ctrl+w working  ctrl+i idle  ctrl+a all  b blocked  q close  ${fg(P.border)}${new Date().toTimeString().slice(0, 8)}`;
  lines.push(help);
  // fit(): a line wider than the pane would wrap and push the header off the top
  process.stdout.write("\x1b[H" + lines.map((l) => bg(P.bg) + "\x1b[2K" + fit(l, g.cols, " ", bg(P.bg)) + RESET).join("\r\n"));
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try { await refresh(); render(); } finally { busy = false; }
}

function quit() {
  process.stdout.write(RESET + "\x1b[?25h\x1b[?1049l");
  process.exit(0);
}

process.stdout.write("\x1b[?1049h\x1b[?25l" + bg(P.bg) + "\x1b[2J");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (k) => {
  if (k === "q" || k === "\x03") return quit();
  if (k === "r") return tick();
  if (FILTER_KEYS[k]) { filter = FILTER_KEYS[k]; return render(); }
  if (/^[1-9]$/.test(k)) {
    const a = shown()[Number(k) - 1];
    if (a) await api(["agent", "focus", a.pane_id]);
  }
});
process.stdout.on("resize", () => render());
process.on("SIGINT", quit);
process.on("SIGTERM", quit);

tick();
setInterval(tick, INTERVAL_MS);
