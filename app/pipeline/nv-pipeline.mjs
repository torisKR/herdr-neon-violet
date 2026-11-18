#!/usr/bin/env node
// nv-pipeline: takes an app idea from research to the Play Store, one stage at a time, without a
// person. This script is the conductor and spends no tokens: each stage is a fresh agent in its own
// hc terminal that reads pipeline/<stage>/TASK.md, writes pipeline/<stage>/result.json and is then
// ended. Stages hand over through files only, so no conversation grows across the whole run.
//
//   nv-pipeline new "<name>" --idea "<seed>" [--ref <store link|repo|image>]… [--kind app|game|auto] [--mode auto|promote|review] [--dir <path>]
//   nv-pipeline run <id> [--until <stage>]     advance until done, a gate, or a failure
//   nv-pipeline pick <id> <option>             choose an idea or a design at a gate
//   nv-pipeline approve <id>                   allow the production release
//   nv-pipeline mode <id> auto|promote|review  auto: no person · promote: ask before production · review: ask at every choice
//   nv-pipeline say <id> <text>                a note from the person to the agent working now
//   nv-pipeline retry <id> [stage] | stop <id> | remove <id>
//   nv-pipeline key set <service-account.json> | key status
//   nv-pipeline status [id] [--json] | stages
//
// Home: ~/.config/herdr-app/pipeline (apps.json, settings.json, secrets/play-key.json, preview/).
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each stage is one teammate. `role` is who the board shows doing it.
export const STAGES = [
  { id: "research", role: "Researcher", ko: "리서처", minutes: 25, gate: "pick", about: "trending apps and games in Korea and the US → three scored ideas" },
  { id: "brief", role: "Planner", ko: "기획자", minutes: 20, about: "one-page brief for the chosen idea, engine choice, scope, kill criteria" },
  { id: "design", role: "Designer", ko: "디자이너", minutes: 40, gate: "pick", about: "three visual directions with a mock image each" },
  { id: "assets", role: "Artist", ko: "아티스트", minutes: 90, about: "sprites, icons and UI art in the chosen direction" },
  { id: "build", role: "Developer", ko: "개발자", minutes: 240, about: "implement the brief's scope, nothing more" },
  { id: "test", role: "Tester", ko: "QA", minutes: 60, about: "install on a device with adb, walk the core flow, catch crashes and ANRs" },
  { id: "store", role: "Marketer", ko: "마케터", minutes: 60, about: "icon, feature graphic, screenshots, listing text, privacy policy on Notion" },
  { id: "internal", role: "Release manager", ko: "릴리스 매니저", minutes: 45, needsKey: true, about: "signed bundle to the Play internal track with fastlane" },
  { id: "release", role: "Publisher", ko: "퍼블리셔", minutes: 20, needsKey: true, gate: "approve", about: "promote the tested build to production" },
];
export const MODES = ["auto", "promote", "review"];
const stageOf = id => STAGES.find(s => s.id === id);

export class UsageError extends Error {}

/** Everything that touches the machine, so tests can replace it. */
export function realSystem(env = process.env) {
  const home = env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
  return {
    home: join(home, "pipeline"),
    here: dirname(fileURLToPath(import.meta.url)),
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    hc(args) {
      const r = spawnSync("hc", args, { encoding: "utf8", windowsHide: true, timeout: 90000 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
    },
    self: env.HC_TERMINAL_ID || null,
    platform: process.platform,
    has(bin) { return spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore", windowsHide: true }).status === 0; },
  };
}

// ---------------------------------------------------------------- files and locks

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
// Ids name folders and terminals, so they are plain ASCII (Android tooling dislikes other paths); the display name keeps its script.
export const slug = name => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";

/** hc names are at most 32 characters: a prefix of the id, a short hash of the whole id, and the stage. */
export function terminalName(id, stage) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `pl-${id.slice(0, 14)}-${h.toString(36).slice(-4).padStart(4, "0")}-${stage}`;
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** Runs fn while holding a lock file. Every read-modify-write of shared files goes through one, so
 *  the conductor, the board's commands and a second conductor never overwrite each other. */
function locked(file, fn) {
  mkdirSync(dirname(file), { recursive: true });
  const until = Date.now() + 15000;
  for (;;) {
    try { closeSync(openSync(file, "wx")); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - statSync(file).mtimeMs > 20000) { unlinkSync(file); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`${file} stays locked (remove it if nothing is running)`);
      sleepSync(15);
    }
  }
  try { return fn(); } finally { try { unlinkSync(file); } catch { /* already gone */ } }
}

// How each model's CLI is started so it works without a person. {prompt} is where the task goes.
// claude and grok decide per action in their "auto" mode; codex needs no approval but may only
// write inside the project (its own image tool still works). agy can only run unattended by
// skipping its permission prompts, which is the person’s call: it is listed without that flag and
// not cast by default (see docs/PIPELINE.md to turn it on).
export const AGENTS = {
  claude: ["claude", "--permission-mode", "auto", "{prompt}"],
  grok: ["grok", "--permission-mode", "auto", "{prompt}"],
  codex: ["codex", "--no-daemon", "-a", "never", "-s", "workspace-write", "{prompt}"],
  agy: ["agy", "-i", "{prompt}"],
};
// Who does what: live trends → grok; planning, code and releases (skills, Notion) → claude;
// pictures → codex (it generates images itself). A model that is not installed, or whose try
// failed, is replaced by `fallback`. Any stage can be recast in settings.json.
export const CAST = { research: "grok", brief: "claude", design: "codex", assets: "codex", build: "claude", test: "claude", store: "claude", internal: "claude", release: "claude" };

function settings(sys) {
  const saved = readJson(join(sys.home, "settings.json"), {});
  return { root: join(homedir(), "projects"), retries: 1, fallback: "claude", ...saved, agents: { ...AGENTS, ...(saved.agents ?? {}) }, cast: { ...CAST, ...(saved.cast ?? {}) } };
}

/** The model for a stage and its command line: the cast, unless it is missing or already failed once. */
export function agentFor(sys, stageId, tries = 1) {
  const set = settings(sys);
  if (Array.isArray(set.agent)) return { name: "custom", argv: prompt => [...set.agent, prompt] };   // one command for every stage
  const usable = name => Array.isArray(set.agents[name]) && sys.has(set.agents[name][0]);
  const wanted = set.cast[stageId] ?? set.fallback;
  const name = tries === 1 && usable(wanted) ? wanted : usable(set.fallback) ? set.fallback : wanted;
  const template = set.agents[name] ?? AGENTS.claude;
  return { name, argv: prompt => template.includes("{prompt}") ? template.map(a => a === "{prompt}" ? prompt : a) : [...template, prompt] };
}

const registryFile = sys => join(sys.home, "apps.json");
const registry = sys => readJson(registryFile(sys), []);
const keyFile = sys => join(sys.home, "secrets", "play-key.json");
const stateFile = dir => join(dir, "pipeline", "state.json");
const feedFile = dir => join(dir, "pipeline", "feed.jsonl");

function appOf(sys, id) {
  const app = registry(sys).find(a => a.id === id);
  if (!app) throw new UsageError(`no pipeline named ${id} (nv-pipeline status)`);
  return app;
}
function load(app) {
  const state = readJson(stateFile(app.dir), null);
  if (!state) throw new Error(`${stateFile(app.dir)} is missing or unreadable`);
  return state;
}
/** The only way state is written: read what is on disk now, change it, write it, all under the lock.
 *  Nobody keeps a copy across a stage, so a mode change or a stop made meanwhile is never lost. */
function change(app, fn, event) {
  return locked(join(app.dir, "pipeline", "state.lock"), () => {
    const state = load(app);
    fn(state);
    if (event) state.log = [...(state.log ?? []), { at: new Date().toISOString(), text: event }].slice(-60);
    state.updatedAt = new Date().toISOString();
    writeJson(stateFile(app.dir), state);
    return state;
  });
}

/** One line of the team's feed: who said or handed what to whom. Agents append notes to the same file. */
function feed(app, entry) {
  mkdirSync(dirname(feedFile(app.dir)), { recursive: true });
  appendFileSync(feedFile(app.dir), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

// ---------------------------------------------------------------- the Play service account key

/** Checks a Play service-account key file and returns who it is for. */
export function readKey(file) {
  let key;
  try { key = JSON.parse(readFileSync(file, "utf8")); } catch { throw new UsageError(`${file} is not a JSON file`); }
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new UsageError("this is not a Google service account key (it needs type: service_account, client_email and private_key). Create one in Google Cloud > IAM > Service accounts > Keys, then invite its email in Play Console > Users and permissions.");
  }
  return { email: key.client_email, project: key.project_id ?? null };
}
/** Stores the key so that it is never readable by others, not even for a moment: the folder is
 *  owner-only before anything is written, and the file is created owner-only. */
function setKey(sys, file) {
  const info = readKey(file);
  const posix = sys.platform !== "win32", dir = dirname(keyFile(sys));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (posix) chmodSync(dir, 0o700);
  const tmp = join(dir, `.play-key.${process.pid}.tmp`);
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, "wx", 0o600);
  try { writeSync(fd, readFileSync(file)); } finally { closeSync(fd); }
  if (posix) chmodSync(tmp, 0o600);
  renameSync(tmp, keyFile(sys));
  return info;
}
const keyStatus = sys => existsSync(keyFile(sys)) ? { present: true, ...readKey(keyFile(sys)), path: keyFile(sys) } : { present: false };

// ---------------------------------------------------------------- tasks for the stage agents

/** Fills {{name}} style placeholders; unknown ones stay visible so a broken template is noticed. */
export function render(template, values) {
  return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (whole, path) => {
    const v = path.split(".").reduce((o, k) => (o == null ? o : o[k]), values);
    return v == null ? whole : typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

function task(sys, app, state, stage) {
  const stagesDir = existsSync(join(sys.home, "stages")) ? join(sys.home, "stages") : join(sys.here, "stages");
  const body = readFileSync(join(stagesDir, `${stage.id}.md`), "utf8");
  const rules = readFileSync(join(stagesDir, "_rules.md"), "utf8");
  const chosen = id => (state.options?.[id] ?? []).find(o => o.id === state.choice?.[id]) ?? null;
  const next = STAGES[STAGES.indexOf(stage) + 1];
  return render(`${body}\n\n${rules}`, {
    name: state.name, id: state.id, idea: state.idea || "(none: propose from what is trending)", kind: state.kind, engine: state.engine ?? "(decided in the brief stage)",
    dir: app.dir, stage: stage.id, role: stage.role, next: next ? `${next.role} (${next.id})` : "nobody: this is the last stage", minutes: stage.minutes,
    key: keyFile(sys), package: state.package ?? "(set in the brief stage)",
    idea_choice: chosen("research") ?? "(none)", design_choice: chosen("design") ?? "(none)",
    refs: refsText(state.refs),
  });
}

/** What the person pointed at as a reference: a store page, a repository, a web page, or a picture
 *  (copied into the project so every stage can open it). */
export function reference(value, dir, index) {
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) {
    const kind = /play\.google\.com\/store\/apps/i.test(text) ? "play" : /apps\.apple\.com/i.test(text) ? "appstore" : /github\.com\//i.test(text) ? "repo" : "web";
    return { kind, url: text };
  }
  const file = resolve(text.replace(/^~(?=$|[\\/])/, homedir()));
  if (/\.(png|jpe?g|webp|gif)$/i.test(file) && existsSync(file)) {
    const rel = `pipeline/refs/${index + 1}${extname(file).toLowerCase()}`;
    mkdirSync(join(dir, "pipeline", "refs"), { recursive: true });
    copyFileSync(file, join(dir, rel));
    return { kind: "image", file: rel };
  }
  return { kind: "note", text };
}

function refsText(refs) {
  if (!refs?.length) return "(none given)";
  const label = { play: "Google Play page", appstore: "App Store page", repo: "repository (check its license)", web: "web page", image: "picture in the project", note: "note" };
  return "\n" + refs.map(r => `  - ${label[r.kind]}: ${r.url ?? r.file ?? r.text}`).join("\n");
}

// ---------------------------------------------------------------- running one stage

const READY_MS = 4000, POLL_MS = 5000;

// herdr-core on macOS and Linux does not have the person's PATH (node, claude, flutter live in
// their shell profile). Programs therefore start through their login shell: $SHELL when it is a
// POSIX-style shell, else zsh on macOS (its default; it reads ~/.zprofile), bash, then sh.
const LOGIN = 's="${SHELL:-}"; case "$s" in */zsh|*/bash|*/sh|*/dash|*/ksh) [ -x "$s" ] || s= ;; *) s= ;; esac; ' +
  'if [ -z "$s" ]; then if [ "$(uname)" = Darwin ] && [ -x /bin/zsh ]; then s=/bin/zsh; elif [ -x /bin/bash ]; then s=/bin/bash; else s=/bin/sh; fi; fi; ' +
  'exec "$s" -lc \'exec "$@"\' sh "$@"';
/** A command as hc should start it: unchanged on Windows, through the login shell elsewhere. */
export function viaShell(argv, platform = process.platform) {
  return platform === "win32" ? argv : ["/bin/sh", "-c", LOGIN, "sh", ...argv];
}

const readJsonText = text => { try { return JSON.parse(text); } catch { return null; } };
const lastLines = (sys, terminal) => sys.hc(["read", terminal, "--lines", "0"]).stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-3).join(" / ").slice(0, 300);
const isLive = (sys, terminal) => readJsonText(sys.hc(["get", terminal, "--json"]).stdout)?.state === "live";
const endTerminal = (sys, terminal) => { sys.hc(["kill", terminal]); sys.hc(["rm", terminal]); };

/** Starts the stage's agent (or takes over one that was waiting for the person), waits for its
 *  result file, and ends its terminal unless it still needs the person. */
async function runStage(sys, app, state, stage, adopt) {
  const dir = join(app.dir, "pipeline", stage.id);
  mkdirSync(dir, { recursive: true });
  const resultFile = join(dir, "result.json");
  let terminal = adopt;
  if (!terminal) {
    rmSync(resultFile, { force: true });
    writeFileSync(join(dir, "TASK.md"), task(sys, app, state, stage));
    const prompt = `You are the ${stage.role} ("${stage.id}" stage) of an unattended app pipeline for "${state.name}". Read pipeline/${stage.id}/TASK.md and do exactly what it says, nothing from other stages. Finish by writing pipeline/${stage.id}/result.json.`;
    const name = terminalName(state.id, stage.id);
    endTerminal(sys, name);   // a leftover from an interrupted run
    const agent = agentFor(sys, stage.id, state.stages[stage.id].tries ?? 1);
    const started = sys.hc(["run", "--bg", "--json", "--no-notify", "--outlive-parent", "--name", name, "--cwd", app.dir, "--", ...viaShell(agent.argv(prompt), sys.platform)]);
    if (started.code !== 0) return { status: "failed", summary: `could not start the agent: ${(started.stderr || started.stdout).trim()}` };
    terminal = readJsonText(started.stdout)?.address ?? name;
    change(app, s => { s.stages[stage.id].terminal = terminal; s.stages[stage.id].agent = agent.name; });
  }
  const begun = sys.now(), deadline = begun + stage.minutes * 60000;
  let trusted = false, result = null;
  try {
    if (!adopt) await sys.sleep(READY_MS);
    for (;;) {
      // A stop comes first: a stopped pipeline takes no result and starts nothing.
      if (load(app).stopRequested) { result = { status: "stopped", summary: "stopped by the person" }; break; }
      const info = readJsonText(sys.hc(["get", terminal, "--json"]).stdout) ?? {};
      if (!trusted && !adopt && sys.now() - begun < 60000) {
        // A new folder asks "do you trust this folder?" before the agent starts.
        const screen = sys.hc(["read", terminal, "--lines", "0"]).stdout;
        if (/trust (this|the files in this) folder/i.test(screen)) { sys.hc(["keys", terminal, "enter"]); trusted = true; }
      }
      const written = existsSync(resultFile) ? readJson(resultFile, null) : null;
      if (written && info.status !== "working") { result = written; break; }
      if (info.state === "finished" || info.exit_code != null) {
        result = written ?? { status: "failed", summary: `the agent exited${info.exit_code != null ? ` with code ${info.exit_code}` : ""} without a result: ${lastLines(sys, terminal)}` };
        break;
      }
      if (info.status === "blocked") { result = { status: "blocked", summary: `the agent is waiting for a person: ${lastLines(sys, terminal)}` }; break; }
      if (sys.now() > deadline) { result = { status: "failed", summary: `no result after ${stage.minutes} minutes (the stage's budget)` }; break; }
      await sys.sleep(POLL_MS);
    }
  } finally {
    // A blocked agent stays so the person can answer it; everything else is ended to free memory.
    if (result?.status !== "blocked") {
      endTerminal(sys, terminal);
      change(app, s => { s.stages[stage.id].terminal = null; });
    }
  }
  return normalize(result);
}

/** A result file as the conductor understands it; anything malformed counts as a failure. */
export function normalize(result) {
  if (!result || typeof result !== "object") return { status: "failed", summary: "result.json is not an object" };
  const status = ["done", "failed", "blocked", "stopped"].includes(result.status) ? result.status : "failed";
  const out = { ...result, status, summary: String(result.summary ?? "").slice(0, 2000) };
  if (Array.isArray(result.options)) {
    out.options = result.options.filter(o => o && o.id && o.title).slice(0, 6).map(o => ({
      id: String(o.id), title: String(o.title), desc: String(o.desc ?? "").slice(0, 600), score: Number.isFinite(Number(o.score)) && o.score != null ? Number(o.score) : null,
      image: o.image ? String(o.image) : null, recommended: Boolean(o.recommended),
    }));
  }
  return out;
}

/** The option an unattended run takes: the recommended one, else the best score, else the first. */
export function autoPick(options) {
  if (!options?.length) return null;
  return (options.find(o => o.recommended) ?? [...options].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]).id;
}

/** Copies option images where the board can show them (mods load images from the app home only). */
function preview(sys, app, state, stage, options) {
  const dir = join(sys.home, "preview", state.id);
  return options.map(o => {
    if (!o.image) return o;
    const from = isAbsolute(o.image) ? o.image : join(app.dir, o.image);
    if (!existsSync(from)) return { ...o, image: null };
    mkdirSync(dir, { recursive: true });
    const name = `${stage.id}-${o.id.replace(/[^A-Za-z0-9_-]/g, "_")}-${Math.round(statSync(from).mtimeMs)}${extname(from) || ".png"}`;
    copyFileSync(from, join(dir, name));
    return { ...o, preview: `pipeline/preview/${state.id}/${name}` };
  });
}

// ---------------------------------------------------------------- the conductor

/** One conductor per project: a lock file that names the process holding it. */
function takeRunLock(app, id) {
  const file = join(app.dir, "pipeline", "run.lock");
  for (let i = 0; i < 3; i++) {
    try {
      const fd = openSync(file, "wx");
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
      return () => { try { unlinkSync(file); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const holder = Number(readJson(file, 0));
      if (holder > 0 && alive(holder)) throw new UsageError(`${id} is already running (process ${holder})`);
      try { unlinkSync(file); } catch { /* someone else cleaned it */ }
    }
  }
  throw new UsageError(`${id} is already running`);
}

/** Advances a pipeline until it is done, needs a person, fails, or reaches `until`. */
export async function advance(sys, id, { until = null } = {}) {
  const app = appOf(sys, id);
  load(app);
  const release = takeRunLock(app, id);
  const gate = g => {
    change(app, s => { s.status = "waiting"; s.gate = g; s.stage = g.stage; }, `${g.stage}: waiting for the person (${g.kind})`);
    feed(app, { from: g.stage, to: "person", kind: "ask", code: `ask.${g.kind}`, text: { pick: "Please choose one.", approve: "Ready for production. Approve?", key: "I need the Play service account key.", blocked: "I'm stuck and need you." }[g.kind] });
  };
  try {
    change(app, s => { s.runner = sys.self; s.status = "running"; s.gate = null; s.stopRequested = false; }, "running");
    for (;;) {
      // Decide from what is on disk now: the mode, an approval or a stop may have changed since the last stage.
      const state = load(app);
      if (state.stopRequested) { change(app, s => { s.status = "stopped"; }, "stopped"); break; }
      const stage = STAGES.find(s => state.stages[s.id].status !== "done");
      if (!stage) {
        change(app, s => { s.status = "done"; s.stage = null; }, "pipeline done");
        feed(app, { from: "release", kind: "done", code: "done", text: "Pipeline finished." });
        break;
      }
      const record = state.stages[stage.id];
      const next = STAGES[STAGES.indexOf(stage) + 1];
      if (record.status === "waiting" && stage.gate === "pick") {
        if (state.mode === "review") { gate({ kind: "pick", stage: stage.id }); break; }
        // The mode no longer asks: take the options that are already there.
        const options = state.options?.[stage.id] ?? [], chosen = options.find(o => o.id === autoPick(options));
        change(app, s => { s.choice = { ...(s.choice ?? {}), [stage.id]: chosen.id }; s.stages[stage.id].status = "done"; s.gate = null; }, `${stage.id}: chose ${chosen.id} (unattended)`);
        feed(app, { from: stage.id, kind: "choice", code: "pick.auto", arg: chosen.title, text: `Chose "${chosen.title}" (unattended).` });
        feed(app, { from: stage.id, to: next?.id ?? null, kind: "handoff", text: record.summary ?? "" });
        continue;
      }
      if (stage.needsKey && !existsSync(keyFile(sys))) { gate({ kind: "key", stage: stage.id }); break; }
      if (stage.gate === "approve" && state.mode !== "auto" && !state.approved?.[stage.id]) { gate({ kind: "approve", stage: stage.id }); break; }
      // An agent that was waiting for the person and is still there is taken over, not started again.
      const adopt = record.status === "blocked" && record.terminal && isLive(sys, record.terminal) ? record.terminal : null;
      const started = change(app, s => {
        const r = s.stages[stage.id];
        s.stage = stage.id; s.status = "running"; s.gate = null;
        r.status = "running"; r.endedAt = null; r.error = null;
        if (!adopt) { r.tries = (r.tries ?? 0) + 1; r.startedAt = new Date().toISOString(); }
      }, `${stage.id}: ${adopt ? "continuing" : "started"} (try ${(record.tries ?? 0) + (adopt ? 0 : 1)})`);
      const tries = started.stages[stage.id].tries;
      if (!adopt) feed(app, { from: stage.id, kind: "start", code: tries > 1 ? "start.again" : "start", text: `${stage.role} started${tries > 1 ? ` (try ${tries})` : ""}.` });
      const result = await runStage(sys, app, started, stage, adopt);
      const ended = new Date().toISOString();
      if (result.status === "stopped" || load(app).stopRequested) {
        change(app, s => { s.stages[stage.id].status = "pending"; s.status = "stopped"; }, `${stage.id}: stopped`);
        break;
      }
      if (result.status === "blocked") {
        change(app, s => { Object.assign(s.stages[stage.id], { status: "blocked", error: result.summary, summary: result.summary, endedAt: ended }); });
        gate({ kind: "blocked", stage: stage.id });
        break;
      }
      if (result.status !== "done") {
        feed(app, { from: stage.id, kind: "fail", text: result.summary });
        const again = tries <= settings(sys).retries;
        change(app, s => {
          Object.assign(s.stages[stage.id], { status: again ? "pending" : "failed", error: result.summary, summary: result.summary, endedAt: ended });
          if (!again) s.status = "failed";
        }, `${stage.id}: failed${again ? ", trying again" : ""} (${result.summary})`);
        if (again) continue;
        break;
      }
      const options = stage.gate === "pick" ? preview(sys, app, state, stage, result.options ?? []) : null;
      if (options && !options.length) {
        change(app, s => { Object.assign(s.stages[stage.id], { status: "failed", error: "the stage offered no options", endedAt: ended }); s.status = "failed"; }, `${stage.id}: failed (no options)`);
        break;
      }
      // Whether to ask is decided by the mode as it is now, not as it was when the stage began.
      const ask = Boolean(options) && load(app).mode === "review";
      const picked = options && !ask ? options.find(o => o.id === autoPick(options)) : null;
      change(app, s => {
        Object.assign(s.stages[stage.id], { status: ask ? "waiting" : "done", summary: result.summary, endedAt: ended });
        for (const field of ["engine", "package", "title"]) if (typeof result[field] === "string" && result[field]) s[field] = result[field];
        if (options) s.options = { ...(s.options ?? {}), [stage.id]: options };
        if (picked) s.choice = { ...(s.choice ?? {}), [stage.id]: picked.id };
      }, `${stage.id}: ${ask ? "options ready" : "done"}`);
      if (ask) { gate({ kind: "pick", stage: stage.id }); break; }
      if (picked) feed(app, { from: stage.id, kind: "choice", code: "pick.auto", arg: picked.title, text: `Chose "${picked.title}" (unattended).` });
      feed(app, { from: stage.id, to: next?.id ?? null, kind: "handoff", text: result.summary });
      if (until === stage.id) { change(app, s => { s.status = "paused"; }, `paused after ${stage.id}`); break; }
    }
  } finally {
    release();
  }
  return change(app, s => { s.runner = null; });
}

// ---------------------------------------------------------------- commands

function create(sys, name, flags) {
  if (!name) throw new UsageError('new needs a name: nv-pipeline new "Cat Cafe" --idea "..."');
  const kind = flags.kind ?? "auto", mode = flags.mode ?? "promote";
  if (!["app", "game", "auto"].includes(kind)) throw new UsageError("--kind is app, game or auto");
  if (!MODES.includes(mode)) throw new UsageError(`--mode is one of ${MODES.join(", ")}`);
  // Choosing the id and adding it to the list is one step, so two apps made at once both stay listed.
  return locked(join(sys.home, "apps.lock"), () => {
    const apps = registry(sys);
    let id = slug(name);
    for (let n = 2; apps.some(a => a.id === id); n++) id = `${slug(name)}-${n}`;
    const dir = resolve(flags.dir ? flags.dir.replace(/^~(?=$|[\\/])/, homedir()) : join(settings(sys).root, id));
    if (existsSync(stateFile(dir))) throw new UsageError(`${dir} already has a pipeline`);
    const state = {
      id, name, idea: flags.idea ?? "", refs: (flags.ref ?? []).map((r, i) => reference(r, dir, i)), kind, mode, engine: null, status: "idle", stage: STAGES[0].id, gate: null,
      stages: Object.fromEntries(STAGES.map(s => [s.id, { status: "pending", tries: 0 }])), options: {}, choice: {}, approved: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), log: [{ at: new Date().toISOString(), text: "created" }],
    };
    writeJson(stateFile(dir), state);
    feed({ dir }, { from: "person", to: "research", kind: "note", text: flags.idea ? `Idea: ${flags.idea}` : "Find something worth building." });
    writeJson(registryFile(sys), [...apps, { id, name, dir }]);
    return state;
  });
}

function pick(sys, id, option) {
  const app = appOf(sys, id);
  let chosen;
  const state = change(app, s => {
    const stage = s.gate?.kind === "pick" ? s.gate.stage : STAGES.find(x => x.gate === "pick" && s.stages[x.id].status === "waiting")?.id;
    if (!stage) throw new UsageError(`${id} is not waiting for a choice`);
    const options = s.options?.[stage] ?? [];
    chosen = options.find(o => o.id === option);
    if (!chosen) throw new UsageError(`choose one of: ${options.map(o => o.id).join(", ")}`);
    s.choice = { ...(s.choice ?? {}), [stage]: option };
    s.stages[stage].status = "done";
    s.gate = null; s.status = "idle";
    chosen = { ...chosen, stage, summary: s.stages[stage].summary ?? "" };
  }, `the person chose ${option}`);
  feed(app, { from: "person", to: chosen.stage, kind: "choice", code: "pick.person", arg: chosen.title, text: `Go with "${chosen.title}".` });
  feed(app, { from: chosen.stage, to: STAGES[STAGES.findIndex(x => x.id === chosen.stage) + 1]?.id ?? null, kind: "handoff", text: chosen.summary });
  return state;
}

function approve(sys, id) {
  const app = appOf(sys, id);
  let stage;
  const state = change(app, s => {
    stage = s.gate?.stage ?? "release";
    s.approved = { ...(s.approved ?? {}), [stage]: true };
    if (s.gate?.kind === "approve") { s.gate = null; s.status = "idle"; }
  }, "approved by the person");
  feed(app, { from: "person", to: stage, kind: "choice", code: "approve", text: "Approved. Ship it." });
  return state;
}

function setMode(sys, id, mode) {
  if (!MODES.includes(mode)) throw new UsageError(`mode is one of ${MODES.join(", ")}`);
  return change(appOf(sys, id), s => { s.mode = mode; }, `mode: ${mode}`);
}

/** A note from the person: shown in the feed and typed to the agent working now, if any. */
function say(sys, id, text) {
  if (!text) throw new UsageError("say needs the message");
  const app = appOf(sys, id), state = load(app);
  const stage = stageOf(state.stage);
  const terminal = stage && state.stages[stage.id].terminal;
  feed(app, { from: "person", to: stage?.id ?? null, kind: "note", text });
  if (!terminal) return { delivered: false, note: "nobody is working now: the note is in the feed for the next stage" };
  const r = sys.hc(["send", terminal, `Note from the person (follow it within your stage): ${text}`]);
  return { delivered: r.code === 0, to: terminal, ...(r.code === 0 ? {} : { error: (r.stderr || r.stdout).trim() }) };
}

function retry(sys, id, stageId) {
  const app = appOf(sys, id);
  return change(app, s => {
    const stage = stageId ? stageOf(stageId) : STAGES.find(x => ["failed", "blocked"].includes(s.stages[x.id].status)) ?? stageOf(s.stage);
    if (!stage) throw new UsageError(`unknown stage ${stageId} (nv-pipeline stages)`);
    // A stage that is run again invalidates everything built on it.
    let after = false;
    for (const x of STAGES) {
      if (x.id === stage.id) after = true;
      if (!after) continue;
      if (s.stages[x.id].terminal) endTerminal(sys, s.stages[x.id].terminal);
      s.stages[x.id] = { status: "pending", tries: 0 };
      for (const bag of [s.choice, s.options, s.approved]) if (bag) delete bag[x.id];
    }
    s.status = "idle"; s.gate = null; s.stage = stage.id; s.stopRequested = false;
  }, `${stageId ?? "the failed stage"}: will run again`);
}

/** Ends every agent of the pipeline and tells a running conductor to stop: it checks before taking
 *  a result and before starting a stage, so nothing runs after this, whoever started it. */
function stop(sys, id) {
  const app = appOf(sys, id);
  return change(app, s => {
    for (const x of STAGES) {
      const r = s.stages[x.id];
      if (r.terminal) { endTerminal(sys, r.terminal); r.terminal = null; }
      if (["running", "blocked"].includes(r.status)) r.status = "pending";
    }
    if (s.runner && s.runner !== sys.self) sys.hc(["kill", s.runner]);
    s.stopRequested = true; s.status = "stopped"; s.gate = null; s.runner = null;
  }, "stopped by the person");
}

function remove(sys, id) {
  stop(sys, id);   // whatever its state, no agent of it is left behind
  locked(join(sys.home, "apps.lock"), () => writeJson(registryFile(sys), registry(sys).filter(a => a.id !== id)));
  rmSync(join(sys.home, "preview", id), { recursive: true, force: true });
  return { removed: id, kept: "the project folder and its pipeline/ files" };
}

/** The last lines of the feed, oldest first. */
export function readFeed(dir, limit = 40) {
  if (!existsSync(feedFile(dir))) return [];
  return readFileSync(feedFile(dir), "utf8").trimEnd().split("\n").slice(-limit).map(readJsonText).filter(e => e && typeof e.text === "string");
}

function status(sys, id) {
  const apps = registry(sys).filter(a => !id || a.id === id).map(a => ({ ...a, state: readJson(stateFile(a.dir), null), feed: readFeed(a.dir) }));
  // Who would take each stage now, so the board can show the model at every desk before it starts.
  const cast = Object.fromEntries(STAGES.map(s => [s.id, agentFor(sys, s.id).name]));
  return { key: keyStatus(sys), root: settings(sys).root, stages: STAGES.map(s => ({ ...s, agent: cast[s.id] })), apps };
}

export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--ref") {
      if (i + 1 >= argv.length) throw new UsageError("--ref needs a link or an image file");
      (flags.ref ??= []).push(argv[++i]);
    } else if (["--idea", "--kind", "--mode", "--dir", "--until"].includes(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags[a.slice(2)] = argv[++i];
    } else rest.push(a);
  }
  return { command: rest[0] ?? "help", args: rest.slice(1), flags };
}

export async function main(sys, { command, args, flags }) {
  switch (command) {
    case "new": return create(sys, args.join(" "), flags);
    case "run": {
      if (flags.until && !stageOf(flags.until)) throw new UsageError(`--until takes a stage: ${STAGES.map(s => s.id).join(", ")}`);
      return advance(sys, need(args, "run"), { until: flags.until });
    }
    case "pick": if (!args[1]) throw new UsageError("pick needs an option id"); return pick(sys, need(args, "pick"), args[1]);
    case "approve": return approve(sys, need(args, "approve"));
    case "mode": return setMode(sys, need(args, "mode"), args[1]);
    case "say": return say(sys, need(args, "say"), args.slice(1).join(" "));
    case "retry": return retry(sys, need(args, "retry"), args[1]);
    case "stop": return stop(sys, need(args, "stop"));
    case "remove": return remove(sys, need(args, "remove"));
    case "status": return status(sys, args[0]);
    case "stages": return { stages: STAGES };
    case "key":
      if (args[0] === "set") { if (!args[1]) throw new UsageError("key set needs the path of the service account JSON"); return { saved: true, ...setKey(sys, resolve(args[1])) }; }
      return keyStatus(sys);
    case "help": case "--help": case "-h":
      return { help: readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).map(l => l.replace(/^\/\/ ?/, "")).join("\n") };
    default: throw new UsageError(`unknown command: ${command} (nv-pipeline help)`);
  }
}
const need = (args, command) => { if (!args[0]) throw new UsageError(`${command} needs a pipeline id (nv-pipeline status)`); return args[0]; };

function print(command, result, json) {
  if (json) return console.log(JSON.stringify(result));
  if (result.help) return console.log(result.help);
  if (command === "stages") return console.log(result.stages.map(s => `${s.id.padEnd(9)} ${s.role.padEnd(16)} ${String(s.minutes).padStart(3)} min  ${s.about}`).join("\n"));
  if (command === "status") {
    console.log(`Play key: ${result.key.present ? result.key.email : "not set (nv-pipeline key set <file>)"}`);
    for (const a of result.apps) {
      const s = a.state;
      if (!s) { console.log(`${a.id}  (state unreadable: ${a.dir})`); continue; }
      console.log(`${a.id}  ${s.status}${s.gate ? ` · needs you: ${s.gate.kind} at ${s.gate.stage}` : ""}  mode ${s.mode}  ${s.engine ?? ""}  ${a.dir}`);
      console.log("  " + STAGES.map(st => `${st.id}:${s.stages[st.id].status}`).join("  "));
    }
    return;
  }
  if (result.id && result.stages) return console.log(`${result.id}: ${result.status}${result.gate ? ` (needs you: ${result.gate.kind} at ${result.gate.stage})` : ""}`);
  console.log(Object.entries(result).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("  "));
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (invoked) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    print(parsed.command, await main(realSystem(), parsed), parsed.flags.json);
    process.exit(0);
  } catch (error) {
    const msg = String(error?.message ?? error);
    if (parsed?.flags.json) console.error(JSON.stringify({ error: msg })); else console.error(`nv-pipeline: ${msg}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
