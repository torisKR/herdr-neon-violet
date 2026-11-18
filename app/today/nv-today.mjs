#!/usr/bin/env node
// nv-today: what to pick up today, and where each project was left. It keeps a short note per
// project (the state, the one next action, why it stopped, what was verified) and reads git to
// say where to continue and whether that verification still holds. No agent, no tokens.
//
//   nv-today list                              every project, the focused ones first
//   nv-today add <folder> [--name N] [--kind personal|work]
//   nv-today focus <id> main|maint|none        one main project and one maintenance project at a time
//   nv-today kind <id> personal|work
//   nv-today note <id> [--state S] [--next N] [--why W] [--hold H] [--verified V]
//                                              leave it as it is now; --verified says what was really checked
//   nv-today draft <id>                        a note's state drafted from git
//   nv-today remove <id>
//   (--json for machine output)
//
// Home: ~/.config/herdr-app/today/today.json. The Today tab runs this same file on every connected
// machine, so a project is listed where it lives.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export class UsageError extends Error {}
const KINDS = ["personal", "work"], FOCUS = ["main", "maint"], FIELDS = ["state", "next", "why", "hold"];

export const homeOf = (env = process.env) => join(env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"), "today");
const storeFile = home => join(home, "today.json");
function load(home) {
  try { const data = JSON.parse(readFileSync(storeFile(home), "utf8")); return { version: 1, projects: Array.isArray(data.projects) ? data.projects : [] }; }
  catch { return { version: 1, projects: [] }; }
}
function save(home, data) {
  mkdirSync(home, { recursive: true });
  const tmp = `${storeFile(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, storeFile(home));
}
const slug = name => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
const clip = (text, max = 600) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------------------------------------------------------------- git

function git(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trimEnd() };
}

/** Where a project stands in git: branch, commit, what is not committed, the last commits. */
export function gitInfo(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { missing: true };
  // Three git calls per project, not one per fact: on Windows each one is slow.
  const status = git(dir, ["status", "--porcelain=v2", "--branch"]);
  if (!status.ok) return { repo: false };
  const lines = status.out.split("\n"), header = name => lines.find(l => l.startsWith(`# branch.${name} `))?.slice(`# branch.${name} `.length) ?? null;
  const changed = lines.filter(l => l && !l.startsWith("#"));
  const pathOf = l => l[0] === "?" || l[0] === "!" ? l.slice(2) : l.split("\t")[0].split(" ").slice(l[0] === "2" ? 9 : l[0] === "u" ? 10 : 8).join(" ");
  const oid = /^[0-9a-f]{40,}$/.test(header("oid") ?? "") ? header("oid") : null;
  const log = oid ? git(dir, ["log", "-5", "--format=%h%x09%cI%x09%s"]).out : "";
  // One value for "the code as it is now": the commit and everything not committed. A verification
  // remembers it, so any later change, committed or not, shows.
  const diff = oid ? git(dir, ["diff", "HEAD", "--numstat"]).out : "";
  return {
    repo: true, branch: header("head"), head: oid ? oid.slice(0, 7) : null, oid,
    dirty: changed.length, files: changed.slice(0, 12).map(pathOf),
    commits: log ? log.split("\n").map(l => { const [hash, at, ...subject] = l.split("\t"); return { hash, at, subject: subject.join("\t") }; }) : [],
    mark: createHash("sha1").update(`${oid}\n${changed.join("\n")}\n${diff}`).digest("hex"),
  };
}

/** Whether what was verified is still what is there: none (nothing was), fresh, or stale with how much changed since. */
export function verification(dir, note, info) {
  const v = note?.verified;
  if (!v?.text) return { state: "none" };
  if (!info?.repo) return { state: "fresh", text: v.text, at: v.at };
  if (v.mark && v.mark === info.mark) return { state: "fresh", text: v.text, at: v.at };
  const from = v.oid ?? v.head;
  const commits = from ? Number(git(dir, ["rev-list", "--count", `${from}..HEAD`]).out) || 0 : 0;
  const files = from ? git(dir, ["diff", "--name-only", from]).out.split("\n").filter(Boolean).length : info.dirty;
  return { state: "stale", text: v.text, at: v.at, commits, files: Math.max(files, info.dirty) };
}

// ---------------------------------------------------------------- projects

function find(data, id) {
  const project = data.projects.find(p => p.id === id);
  if (!project) throw new UsageError(`no project named ${id} (nv-today list)`);
  return project;
}

/** A project as the Today tab shows it: its note, where it stands, and why it may deserve attention. */
function view(project) {
  const info = gitInfo(project.dir), note = project.note ?? null, check = verification(project.dir, note, info);
  // Reasons are facts that can be checked, never a score.
  const reasons = [];
  if (info.missing) reasons.push("missing");
  if (note?.why) reasons.push("stopped");
  if (check.state === "stale") reasons.push("stale");
  if (info.dirty > 0) reasons.push("dirty");
  if (!note?.next) reasons.push("nonote");
  const moved = Boolean(note && info.repo && (note.head !== info.head || note.branch !== info.branch));
  return { id: project.id, name: project.name, dir: project.dir, kind: project.kind, focus: project.focus ?? null, note, git: info, verification: check, reasons, moved,
    at: note?.at ?? info.commits?.[0]?.at ?? project.addedAt ?? null };
}

function list(home) {
  const order = p => p.focus === "main" ? 0 : p.focus === "maint" ? 1 : 2;
  const projects = load(home).projects.map(view).sort((a, b) => order(a) - order(b) || String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return { version: 1, tool: join(dirname(home), "bin", "nv-today.mjs"), projects };
}

function add(home, dir, flags) {
  if (!dir) throw new UsageError("add needs a folder: nv-today add ~/projects/my-app");
  const folder = resolve(String(dir).replace(/^~(?=$|[\\/])/, homedir()));
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`${folder} is not a folder`);
  const kind = flags.kind ?? "personal";
  if (!KINDS.includes(kind)) throw new UsageError(`--kind is one of ${KINDS.join(", ")}`);
  const data = load(home);
  const same = data.projects.find(p => resolve(p.dir).toLowerCase() === folder.toLowerCase());
  if (same) return view(same);
  const name = clip(flags.name || basename(folder), 60);
  let id = slug(name);
  for (let n = 2; data.projects.some(p => p.id === id); n++) id = `${slug(name)}-${n}`;
  const project = { id, name, dir: folder, kind, focus: null, note: null, history: [], addedAt: new Date().toISOString() };
  data.projects.push(project);
  save(home, data);
  return view(project);
}

function remove(home, id) {
  const data = load(home);
  find(data, id);
  save(home, { ...data, projects: data.projects.filter(p => p.id !== id) });
  return { removed: id, kept: "the project folder" };
}

/** One main project and one maintenance project: giving a place to a project takes it from whoever had it. */
function focus(home, id, where) {
  if (![...FOCUS, "none"].includes(where)) throw new UsageError("focus is main, maint or none");
  const data = load(home), project = find(data, id);
  if (where !== "none") for (const p of data.projects) if (p.focus === where) p.focus = null;
  project.focus = where === "none" ? null : where;
  save(home, data);
  return view(project);
}

function setKind(home, id, kind) {
  if (!KINDS.includes(kind)) throw new UsageError(`kind is one of ${KINDS.join(", ")}`);
  const data = load(home), project = find(data, id);
  project.kind = kind;
  save(home, data);
  return view(project);
}

/** Leaves the project as it is now. Fields that are not given keep their text; "" clears one.
 *  --verified records what was really checked, against the code as it is at this moment. */
function note(home, id, flags) {
  if (![...FIELDS, "verified"].some(f => flags[f] !== undefined)) throw new UsageError("note needs at least one of --state, --next, --why, --hold, --verified");
  const data = load(home), project = find(data, id), info = gitInfo(project.dir), now = new Date().toISOString();
  const next = { ...(project.note ?? {}) };
  for (const f of FIELDS) if (flags[f] !== undefined) next[f] = clip(flags[f]);
  if (flags.verified !== undefined) {
    const text = clip(flags.verified);
    next.verified = text ? { text, at: now, head: info.head ?? null, oid: info.oid ?? null, mark: info.mark ?? null } : null;
  }
  Object.assign(next, { at: now, branch: info.branch ?? null, head: info.head ?? null });
  if (project.note) project.history = [project.note, ...(project.history ?? [])].slice(0, 20);
  project.note = next;
  save(home, data);
  return view(project);
}

/** What git alone can say about where the project stands, as a starting text for the note. */
function draft(home, id) {
  const project = find(load(home), id), info = gitInfo(project.dir);
  if (!info.repo) return { id, state: "", files: [] };
  const last = info.commits[0];
  const state = [last ? `마지막 커밋: ${last.subject} (${last.hash})` : "", info.dirty ? `커밋하지 않은 변경 ${info.dirty}개: ${info.files.slice(0, 5).join(", ")}${info.dirty > 5 ? " 외" : ""}` : "커밋하지 않은 변경 없음"].filter(Boolean).join(". ");
  return { id, state: clip(state), files: info.files, branch: info.branch, head: info.head };
}

// ---------------------------------------------------------------- commands

export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (["--name", "--kind", ...FIELDS.map(f => `--${f}`), "--verified"].includes(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags[a.slice(2)] = argv[++i];
    } else rest.push(a);
  }
  return { command: rest[0] ?? "list", args: rest.slice(1), flags };
}

/** Runs one command. The Today tab calls this with the same shape the command line parses to. */
export function run({ command, args = [], flags = {} }, home = homeOf()) {
  const need = () => { if (!args[0]) throw new UsageError(`${command} needs a project id (nv-today list)`); return args[0]; };
  switch (command) {
    case "list": return list(home);
    case "add": return add(home, args[0], flags);
    case "remove": return remove(home, need());
    case "focus": return focus(home, need(), args[1]);
    case "kind": return setKind(home, need(), args[1]);
    case "note": return note(home, need(), flags);
    case "draft": return draft(home, need());
    case "help": case "--help": case "-h": return { help: HELP };
    default: throw new UsageError(`unknown command: ${command} (nv-today help)`);
  }
}
const HELP = `nv-today list | add <folder> [--name N] [--kind personal|work] | focus <id> main|maint|none | kind <id> personal|work
nv-today note <id> [--state S] [--next N] [--why W] [--hold H] [--verified V] | draft <id> | remove <id>   (--json)`;

function print(command, result) {
  if (result.help) return console.log(result.help);
  if (command === "list") {
    for (const p of result.projects) {
      const where = p.git.repo ? `${p.git.branch}@${p.git.head}${p.git.dirty ? ` +${p.git.dirty}` : ""}` : p.git.missing ? "(folder missing)" : "(no git)";
      console.log(`${p.focus === "main" ? "★" : p.focus === "maint" ? "•" : " "} ${p.id}  ${where}  ${p.dir}`);
      if (p.note?.next) console.log(`    next: ${p.note.next}`);
      if (p.verification.state === "stale") console.log("    the code changed since it was verified");
    }
    return;
  }
  console.log(Object.entries(result).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("  "));
}

const invoked = process.argv[1] && /nv-today\.mjs$/i.test(process.argv[1]);
if (invoked) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    const result = run(parsed);
    if (parsed.flags.json) console.log(JSON.stringify(result)); else print(parsed.command, result);
  } catch (error) {
    const msg = String(error?.message ?? error);
    if (parsed?.flags.json) console.error(JSON.stringify({ error: msg })); else console.error(`nv-today: ${msg}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
