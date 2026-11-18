#!/usr/bin/env node
// nv-pipeline: takes an app idea from research to the Play Store, one stage at a time, without a
// person. This script is the conductor and spends no tokens: each stage is a fresh agent in its own
// hc terminal that reads pipeline/<stage>/TASK.md, writes pipeline/<stage>/result.json and is then
// ended. Stages hand over through files only, so no conversation grows across the whole run.
//
//   nv-pipeline new "<name>" --idea "<seed>" [--kind app|game|auto] [--mode auto|promote|review] [--dir <path>]
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
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  };
}

// ---------------------------------------------------------------- files

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
// Ids name folders and terminals, so they are plain ASCII (Android tooling dislikes other paths); the display name keeps its script.
export const slug = name => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";

function settings(sys) {
  return { root: join(homedir(), "projects"), agent: ["claude", "--permission-mode", "auto"], retries: 1, ...readJson(join(sys.home, "settings.json"), {}) };
}
const registry = sys => readJson(join(sys.home, "apps.json"), []);
const keyFile = sys => join(sys.home, "secrets", "play-key.json");
const stateFile = dir => join(dir, "pipeline", "state.json");
const feedFile = dir => join(dir, "pipeline", "feed.jsonl");

function find(sys, id) {
  const app = registry(sys).find(a => a.id === id);
  if (!app) throw new UsageError(`no pipeline named ${id} (nv-pipeline status)`);
  const state = readJson(stateFile(app.dir), null);
  if (!state) throw new Error(`${stateFile(app.dir)} is missing or unreadable`);
  return { app, state };
}
function save(app, state, event) {
  if (event) state.log = [...(state.log ?? []), { at: new Date().toISOString(), text: event }].slice(-60);
  state.updatedAt = new Date().toISOString();
  writeJson(stateFile(app.dir), state);
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
function setKey(sys, file) {
  const info = readKey(file);
  mkdirSync(dirname(keyFile(sys)), { recursive: true });
  copyFileSync(file, keyFile(sys));
  try { chmodSync(dirname(keyFile(sys)), 0o700); chmodSync(keyFile(sys), 0o600); } catch { /* Windows has no modes */ }
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
  });
}

// ---------------------------------------------------------------- running one stage

const READY_MS = 4000, POLL_MS = 5000;

/** A command as hc should start it. On macOS and Linux herdr-core does not have the person's PATH
 *  (node, claude, flutter live in their shell profile), so it goes through a login shell. */
export function viaShell(argv, platform = process.platform) {
  return platform === "win32" ? argv : ["/bin/sh", "-lc", 'exec "$@"', "sh", ...argv];
}

/** Starts the stage's agent, waits for its result file, and always ends its terminal. */
async function runStage(sys, app, state, stage) {
  const dir = join(app.dir, "pipeline", stage.id);
  mkdirSync(dir, { recursive: true });
  const resultFile = join(dir, "result.json");
  rmSync(resultFile, { force: true });
  writeFileSync(join(dir, "TASK.md"), task(sys, app, state, stage));
  const prompt = `You are the ${stage.role} ("${stage.id}" stage) of an unattended app pipeline for "${state.name}". Read pipeline/${stage.id}/TASK.md and do exactly what it says, nothing from other stages. Finish by writing pipeline/${stage.id}/result.json.`;
  const name = `pl-${state.id}-${stage.id}`.slice(0, 48);
  sys.hc(["kill", name]); sys.hc(["rm", name]);   // a leftover from an interrupted run
  const started = sys.hc(["run", "--bg", "--json", "--no-notify", "--outlive-parent", "--name", name, "--cwd", app.dir, "--", ...viaShell([...settings(sys).agent, prompt], sys.platform)]);
  if (started.code !== 0) return { status: "failed", summary: `could not start the agent: ${(started.stderr || started.stdout).trim()}` };
  const terminal = readJsonText(started.stdout)?.address ?? name;
  const record = state.stages[stage.id];
  record.terminal = terminal;
  save(app, state);
  const begun = sys.now(), deadline = begun + stage.minutes * 60000;
  let trusted = false, result = null;
  try {
    await sys.sleep(READY_MS);
    for (;;) {
      const info = readJsonText(sys.hc(["get", terminal, "--json"]).stdout) ?? {};
      if (!trusted && sys.now() - begun < 60000) {
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
      if (readJson(stateFile(app.dir), {}).status === "stopped") { result = { status: "stopped", summary: "stopped by the person" }; break; }
      if (sys.now() > deadline) { result = { status: "failed", summary: `no result after ${stage.minutes} minutes (the stage's budget)` }; break; }
      await sys.sleep(POLL_MS);
    }
  } finally {
    // A blocked agent stays so the person can answer it; everything else is ended to free memory.
    if (result?.status !== "blocked") { sys.hc(["kill", terminal]); sys.hc(["rm", terminal]); record.terminal = null; }
  }
  return normalize(result);
}

const readJsonText = text => { try { return JSON.parse(text); } catch { return null; } };
const lastLines = (sys, terminal) => sys.hc(["read", terminal, "--lines", "0"]).stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-3).join(" / ").slice(0, 300);

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

/** Advances a pipeline until it is done, needs a person, fails, or reaches `until`. */
export async function advance(sys, id, { until = null } = {}) {
  const { app, state } = find(sys, id);
  if (state.runner && state.runner !== sys.self && state.status === "running" && /"state":\s*"live"/.test(sys.hc(["get", state.runner, "--json"]).stdout)) {
    throw new UsageError(`${id} is already running in ${state.runner}`);
  }
  state.runner = sys.self; state.status = "running"; state.gate = null;
  save(app, state, "running");
  for (;;) {
    const stage = STAGES.find(s => state.stages[s.id].status !== "done");
    if (!stage) { state.status = "done"; state.stage = null; save(app, state, "pipeline done"); feed(app, { from: "release", kind: "done", code: "done", text: "Pipeline finished." }); break; }
    const record = state.stages[stage.id];
    state.stage = stage.id;
    if (record.status === "waiting" && stage.gate === "pick") { gate(app, state, { kind: "pick", stage: stage.id }); break; }   // options made, choice pending
    if (stage.needsKey && !existsSync(keyFile(sys))) { gate(app, state, { kind: "key", stage: stage.id }); break; }
    if (stage.gate === "approve" && state.mode !== "auto" && !state.approved?.[stage.id]) { gate(app, state, { kind: "approve", stage: stage.id }); break; }
    record.status = "running"; record.startedAt = new Date().toISOString(); record.endedAt = null; record.tries = (record.tries ?? 0) + 1; record.error = null;
    save(app, state, `${stage.id}: started (try ${record.tries})`);
    feed(app, { from: stage.id, kind: "start", code: record.tries > 1 ? "start.again" : "start", text: `${stage.role} started${record.tries > 1 ? ` (try ${record.tries})` : ""}.` });
    const result = await runStage(sys, app, state, stage);
    record.endedAt = new Date().toISOString();
    record.summary = result.summary;
    if (result.status === "stopped") { record.status = "pending"; state.status = "stopped"; save(app, state, `${stage.id}: stopped`); break; }
    if (result.status === "blocked") { record.status = "blocked"; record.error = result.summary; gate(app, state, { kind: "blocked", stage: stage.id }); break; }
    if (result.status !== "done") {
      record.error = result.summary;
      feed(app, { from: stage.id, kind: "fail", text: result.summary });
      if (record.tries <= settings(sys).retries) { record.status = "pending"; save(app, state, `${stage.id}: failed, trying again (${result.summary})`); continue; }
      record.status = "failed"; state.status = "failed"; save(app, state, `${stage.id}: failed (${result.summary})`); break;
    }
    for (const field of ["engine", "package", "title"]) if (typeof result[field] === "string" && result[field]) state[field] = result[field];
    const next = STAGES[STAGES.indexOf(stage) + 1];
    if (stage.gate === "pick") {
      const options = preview(sys, app, state, stage, result.options ?? []);
      if (!options.length) { record.status = "failed"; state.status = "failed"; record.error = "the stage offered no options"; save(app, state, `${stage.id}: failed (no options)`); break; }
      state.options = { ...(state.options ?? {}), [stage.id]: options };
      if (state.mode === "review") { record.status = "waiting"; gate(app, state, { kind: "pick", stage: stage.id }); break; }
      state.choice = { ...(state.choice ?? {}), [stage.id]: autoPick(options) };
      feed(app, { from: stage.id, kind: "choice", code: "pick.auto", arg: options.find(o => o.id === state.choice[stage.id]).title, text: `Chose "${options.find(o => o.id === state.choice[stage.id]).title}" (unattended).` });
    }
    record.status = "done";
    save(app, state, `${stage.id}: done`);
    feed(app, { from: stage.id, to: next?.id ?? null, kind: "handoff", text: result.summary });
    if (until === stage.id) { state.status = "paused"; save(app, state, `paused after ${stage.id}`); break; }
  }
  const final = readJson(stateFile(app.dir), state);
  final.runner = null;
  writeJson(stateFile(app.dir), final);
  return final;
}

function gate(app, state, g) {
  state.status = "waiting"; state.gate = g;
  save(app, state, `${g.stage}: waiting for the person (${g.kind})`);
  feed(app, { from: g.stage, to: "person", kind: "ask", code: `ask.${g.kind}`, text: { pick: "Please choose one.", approve: "Ready for production. Approve?", key: "I need the Play service account key.", blocked: "I'm stuck and need you." }[g.kind] });
}

// ---------------------------------------------------------------- commands

function create(sys, name, flags) {
  if (!name) throw new UsageError('new needs a name: nv-pipeline new "Cat Cafe" --idea "..."');
  const kind = flags.kind ?? "auto", mode = flags.mode ?? "promote";
  if (!["app", "game", "auto"].includes(kind)) throw new UsageError("--kind is app, game or auto");
  if (!MODES.includes(mode)) throw new UsageError(`--mode is one of ${MODES.join(", ")}`);
  const apps = registry(sys);
  let id = slug(name);
  for (let n = 2; apps.some(a => a.id === id); n++) id = `${slug(name)}-${n}`;
  const dir = resolve(flags.dir ? flags.dir.replace(/^~(?=$|[\\/])/, homedir()) : join(settings(sys).root, id));
  if (existsSync(stateFile(dir))) throw new UsageError(`${dir} already has a pipeline`);
  const state = {
    id, name, idea: flags.idea ?? "", kind, mode, engine: null, status: "idle", stage: STAGES[0].id, gate: null,
    stages: Object.fromEntries(STAGES.map(s => [s.id, { status: "pending", tries: 0 }])), options: {}, choice: {}, approved: {},
    createdAt: new Date().toISOString(), log: [],
  };
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  save({ dir }, state, "created");
  feed({ dir }, { from: "person", to: "research", kind: "note", text: flags.idea ? `Idea: ${flags.idea}` : "Find something worth building." });
  writeJson(join(sys.home, "apps.json"), [...apps, { id, name, dir }]);
  return state;
}

function pick(sys, id, option) {
  const { app, state } = find(sys, id);
  const stage = state.gate?.kind === "pick" ? state.gate.stage : STAGES.find(s => s.gate === "pick" && state.stages[s.id].status === "waiting")?.id;
  if (!stage) throw new UsageError(`${id} is not waiting for a choice`);
  const options = state.options?.[stage] ?? [];
  const chosen = options.find(o => o.id === option);
  if (!chosen) throw new UsageError(`choose one of: ${options.map(o => o.id).join(", ")}`);
  state.choice = { ...(state.choice ?? {}), [stage]: option };
  state.stages[stage].status = "done";
  state.gate = null; state.status = "idle";
  save(app, state, `${stage}: the person chose ${option}`);
  feed(app, { from: "person", to: stage, kind: "choice", code: "pick.person", arg: chosen.title, text: `Go with "${chosen.title}".` });
  return state;
}

function approve(sys, id) {
  const { app, state } = find(sys, id);
  const stage = state.gate?.stage ?? "release";
  state.approved = { ...(state.approved ?? {}), [stage]: true };
  if (state.gate?.kind === "approve") { state.gate = null; state.status = "idle"; }
  save(app, state, `${stage}: approved by the person`);
  feed(app, { from: "person", to: stage, kind: "choice", code: "approve", text: "Approved. Ship it." });
  return state;
}

function setMode(sys, id, mode) {
  if (!MODES.includes(mode)) throw new UsageError(`mode is one of ${MODES.join(", ")}`);
  const { app, state } = find(sys, id);
  state.mode = mode;
  save(app, state, `mode: ${mode}`);
  return state;
}

/** A note from the person: shown in the feed and typed to the agent working now, if any. */
function say(sys, id, text) {
  if (!text) throw new UsageError("say needs the message");
  const { app, state } = find(sys, id);
  const stage = stageOf(state.stage);
  const terminal = stage && state.stages[stage.id].terminal;
  feed(app, { from: "person", to: stage?.id ?? null, kind: "note", text });
  if (!terminal) return { delivered: false, note: "nobody is working now: the note is in the feed for the next stage" };
  const r = sys.hc(["send", terminal, `Note from the person (follow it within your stage): ${text}`]);
  return { delivered: r.code === 0, to: terminal, ...(r.code === 0 ? {} : { error: (r.stderr || r.stdout).trim() }) };
}

function retry(sys, id, stageId) {
  const { app, state } = find(sys, id);
  const stage = stageId ? stageOf(stageId) : STAGES.find(s => ["failed", "blocked"].includes(state.stages[s.id].status)) ?? stageOf(state.stage);
  if (!stage) throw new UsageError(`unknown stage ${stageId} (nv-pipeline stages)`);
  // A stage that is run again invalidates everything built on it.
  let after = false;
  for (const s of STAGES) {
    if (s.id === stage.id) after = true;
    if (!after) continue;
    const t = state.stages[s.id].terminal;
    if (t) { sys.hc(["kill", t]); sys.hc(["rm", t]); }
    state.stages[s.id] = { status: "pending", tries: 0 };
    for (const bag of [state.choice, state.options, state.approved]) if (bag) delete bag[s.id];
  }
  state.status = "idle"; state.gate = null; state.stage = stage.id;
  save(app, state, `${stage.id}: will run again`);
  return state;
}

function stop(sys, id) {
  const { app, state } = find(sys, id);
  for (const s of STAGES) {
    const t = state.stages[s.id].terminal;
    if (t) { sys.hc(["kill", t]); sys.hc(["rm", t]); state.stages[s.id].terminal = null; }
    if (["running", "blocked"].includes(state.stages[s.id].status)) state.stages[s.id].status = "pending";
  }
  if (state.runner && state.runner !== sys.self) sys.hc(["kill", state.runner]);
  state.status = "stopped"; state.gate = null; state.runner = null;
  save(app, state, "stopped by the person");
  return state;
}

function remove(sys, id) {
  const { state } = find(sys, id);
  if (state.status === "running") stop(sys, id);
  writeJson(join(sys.home, "apps.json"), registry(sys).filter(a => a.id !== id));
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
  return { key: keyStatus(sys), root: settings(sys).root, stages: STAGES, apps };
}

export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (["--idea", "--kind", "--mode", "--dir", "--until"].includes(a)) {
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
