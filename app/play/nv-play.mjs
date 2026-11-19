#!/usr/bin/env node
// nv-play: what a developer account has on Google Play, release by release. For every app of the
// account it reads each track (production, open, closed, internal) and says what is published,
// what is in review, what was rejected and what is still a draft, and which developer owns it (the
// name on its public store page). It only reads: every call to Google is a GET (and one token
// request). No agent, no tokens.
//
//   nv-play list [--refresh] [--max-age MIN]     every account and its apps (from the last check;
//                                                --refresh asks Google again, --max-age only when older)
//   nv-play account add <name> <key.json> [--projects DIR]
//                                                a Play service-account key; DIR is where the apps'
//                                                project folders are (default ~/projects)
//   nv-play account remove <id>
//   (--json for machine output)
//
// Home: ~/.config/herdr-app/play/ (play.json: the accounts, cache.json: the last check). The key
// file itself stays where it is; only its path is kept. The Play tab runs this same file on every
// connected machine, so an account is checked on the machine that has its key.
import { createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export class UsageError extends Error {}
export const TRACKS = ["production", "beta", "alpha", "internal"];
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const REPORTING = "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/playdeveloperreporting";
const POOL = 8;

export const homeOf = (env = process.env) => join(env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"), "play");
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}
const load = home => { const d = readJson(join(home, "play.json"), {}); return { version: 1, accounts: Array.isArray(d.accounts) ? d.accounts : [] }; };
const loadCache = home => { const d = readJson(join(home, "cache.json"), {}); return { accounts: d.accounts && typeof d.accounts === "object" ? d.accounts : {} }; };
const slug = name => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "account";
const isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } };

// ---------------------------------------------------------------- Google

/** A short-lived access token for a service-account key (a signed JWT exchanged at the key's token address). */
async function token(key, io) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(io.now() / 1000);
  const claim = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 900 })}`;
  const signed = `${claim}.${createSign("RSA-SHA256").update(claim).sign(key.private_key).toString("base64url")}`;
  const r = await io.fetch(key.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${signed}` });
  const data = await r.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Google did not accept the key: ${data.error_description || data.error || `HTTP ${r.status}`}`);
  return data.access_token;
}

async function getJson(io, url, bearer) {
  const r = await io.fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, message: data?.error?.message ?? null };
}

/** Runs `job` over `items`, a few at a time, keeping the order. */
async function pool(items, job, size = POOL) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await job(items[i], i); }
  }));
  return out;
}

const stateOf = raw => String(raw ?? "").replace(/^RELEASE_LIFECYCLE_STATE_/, "").toLowerCase() || "unknown";

/** One word for where an app stands, from its releases. `live` says whether production has a published release. */
export function summarize(tracks) {
  const has = (track, ...states) => (tracks[track] ?? []).some(r => states.includes(r.state));
  const any = TRACKS.some(t => (tracks[t] ?? []).length > 0), live = has("production", "published");
  // A rejection counts until a newer version (a higher version code) is approved or published: then the app
  // sinks below the ones still rejected. A newer draft or one still in review leaves the rejection standing.
  const top = r => Math.max(0, ...(r.codes ?? []).map(Number).filter(Number.isFinite));
  const production = tracks.production ?? [];
  const passed = production.filter(r => r.state === "published" || r.state === "approved_not_published").map(top);
  const rejected = production.some(r => r.state === "not_approved" && !passed.some(code => code > top(r)));
  const state = rejected ? "rejected"
    : has("production", "in_review") ? "review"
    : has("production", "approved_not_published") ? "ready"
    : has("production", "draft", "not_sent_for_review") ? "draft"      // also when an older release is live: something is waiting to be sent
    : live ? "live"
    : (tracks.production ?? []).length ? "other"
    : any ? "testing" : "none";
  return { state, live };
}

/** The developer named on a public store page (its JSON-LD "author"), or null. */
export function developerOf(html) {
  const m = /"author":\{"@type":"\w+","name":"((?:[^"\\]|\\.)*)"/.exec(String(html ?? ""));
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`) || null; } catch { return null; }
}

/** The developers of an account's apps, the most common first. */
export const developersOf = apps => {
  const count = new Map();
  for (const app of apps) if (app.developer) count.set(app.developer, (count.get(app.developer) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name);
};

/** Which project folder builds which package: the Android application id, or the fastlane Appfile, of each folder in `root`. */
export function foldersOf(root) {
  const found = {};
  let names = [];
  try { names = readdirSync(root); } catch { return found; }
  for (const name of names) {
    const dir = join(root, name);
    if (name.startsWith(".") || !isDir(dir)) continue;
    for (const [file, pattern] of [
      ["android/app/build.gradle.kts", /applicationId\s*=\s*"([\w.]+)"/], ["android/app/build.gradle", /applicationId\s*=?\s*["']([\w.]+)["']/],
      ["android/fastlane/Appfile", /package_name\(?\s*["']([\w.]+)["']/], ["fastlane/Appfile", /package_name\(?\s*["']([\w.]+)["']/]]) {
      let text;
      try { text = readFileSync(join(dir, file), "utf8"); } catch { continue; }
      const m = pattern.exec(text);
      if (m) { found[m[1]] ??= dir; break; }
    }
  }
  return found;
}

/** Asks Google about one account: its apps, every track of each, and whether the public store page answers.
 *  A track that could not be read this time (Google limits how often releases are listed) keeps what `before` had for it. */
async function check(account, io, before = []) {
  const key = readJson(account.key, null);
  if (!key?.client_email || !key?.private_key || !key?.token_uri) throw new Error(`${account.key} is not a service-account key file`);
  const bearer = await token(key, io);
  const apps = [];
  for (let page = ""; ;) {
    const r = await getJson(io, `${REPORTING}?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, bearer);
    if (r.status !== 200) throw new Error(`could not list the apps (HTTP ${r.status}${r.message ? `: ${r.message}` : ""}). The key needs the Play Developer Reporting API and access to the apps.`);
    apps.push(...(r.data.apps ?? []).map(a => ({ package: a.packageName, name: a.displayName || a.packageName })));
    page = r.data.nextPageToken ?? "";
    if (!page) break;
  }
  const folders = foldersOf(account.projects || join(homedir(), "projects"));
  const per = TRACKS.length + 1;
  const jobs = apps.flatMap(app => [...TRACKS.map(track => ({ app, track })), { app, store: true }]);
  const results = await pool(jobs, async job => {
    try {
      if (job.store) {
        const r = await io.fetch(`https://play.google.com/store/apps/details?id=${job.app.package}`, { redirect: "manual" });
        return r.status === 200 ? { store: "live", developer: developerOf(await r.text().catch(() => "")) } : { store: r.status === 404 ? "missing" : null };
      }
      const r = await getJson(io, `${API}/${job.app.package}/tracks/${job.track}/releases`, bearer);
      if (r.status === 204) return [];                               // a track with no release answers with no content
      if (r.status !== 200) return { error: r.status === 404 ? null : `HTTP ${r.status}${r.message ? `: ${r.message}` : ""}` };
      return (r.data.releases ?? []).map(x => ({ name: x.releaseName ?? "", codes: (x.activeArtifacts ?? []).map(a => a.versionCode).filter(Boolean), state: stateOf(x.releaseLifecycleState) }));
    } catch (error) { return job.store ? { store: null } : { error: String(error?.message ?? error) }; }
  });
  const order = { rejected: 0, review: 1, ready: 2, draft: 3, other: 4, testing: 5, live: 6, none: 7 };
  return apps.map((app, i) => {
    const mine = results.slice(i * per, (i + 1) * per), tracks = {}, errors = [], prev = before.find(b => b.package === app.package), old = prev?.tracks ?? {};
    TRACKS.forEach((track, t) => {
      if (Array.isArray(mine[t])) { if (mine[t].length) tracks[track] = mine[t]; return; }
      if (mine[t]?.error) { errors.push(`${track}: ${mine[t].error}`); if (old[track]) tracks[track] = old[track]; }
    });
    const { store, developer } = mine[TRACKS.length];
    // The developer is only on a public store page: an app without one keeps the name the last check read.
    return { ...app, tracks, ...summarize(tracks), store, developer: developer ?? prev?.developer ?? null, folder: folders[app.package] ?? null, ...(errors.length ? { error: errors[0] } : {}) };
  }).sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- commands

async function list(home, flags, io) {
  const data = load(home), cache = loadCache(home), maxAge = flags["max-age"] === undefined ? null : Number(flags["max-age"]) * 60000;
  if (maxAge !== null && !(maxAge >= 0)) throw new UsageError("--max-age needs a number of minutes");
  let changed = false;
  for (const account of data.accounts) {
    const last = cache.accounts[account.id];
    const due = flags.refresh || (maxAge !== null && (!last?.at || io.now() - Date.parse(last.at) > maxAge));
    if (!due) continue;
    try { cache.accounts[account.id] = { at: new Date(io.now()).toISOString(), apps: await check(account, io, last?.apps) }; }
    // A failed check keeps what was read before, and says why this one failed.
    catch (error) { cache.accounts[account.id] = { at: last?.at ?? null, apps: last?.apps ?? [], error: String(error?.message ?? error) }; }
    changed = true;
  }
  if (changed) writeJson(join(home, "cache.json"), cache);
  return { version: 1, tool: join(dirname(home), "bin", "nv-play.mjs"), accounts: data.accounts.map(a => {
    const c = cache.accounts[a.id] ?? {};
    const apps = c.apps ?? [];
    return { id: a.id, name: a.name, key: a.key, developers: developersOf(apps), at: c.at ?? null, error: c.error ?? null, apps };
  }) };
}

function addAccount(home, name, keyPath, flags) {
  if (!name || !keyPath) throw new UsageError("account add needs a name and the path of a service-account key file");
  const file = resolve(keyPath);
  if (!existsSync(file)) throw new UsageError(`${file} does not exist`);
  const key = readJson(file, null);
  if (key?.type !== "service_account" || !key.client_email || !key.private_key) throw new UsageError(`${file} is not a service-account key file`);
  if (flags.projects && !isDir(resolve(flags.projects))) throw new UsageError(`${flags.projects} is not a folder`);
  const data = load(home), projects = flags.projects ? resolve(flags.projects) : null;
  let account = data.accounts.find(a => a.name === name || a.key === file);
  if (account) Object.assign(account, { name, key: file, ...(projects ? { projects } : {}) });
  else {
    let id = slug(name);
    for (let n = 2; data.accounts.some(a => a.id === id); n++) id = `${slug(name)}-${n}`;
    account = { id, name, key: file, ...(projects ? { projects } : {}) };
    data.accounts.push(account);
  }
  writeJson(join(home, "play.json"), data);
  return { id: account.id, name: account.name, key: account.key, email: key.client_email };
}

function removeAccount(home, id) {
  const data = load(home), cache = loadCache(home);
  if (!data.accounts.some(a => a.id === id)) throw new UsageError(`no account named ${id} (nv-play list)`);
  data.accounts = data.accounts.filter(a => a.id !== id);
  delete cache.accounts[id];
  writeJson(join(home, "play.json"), data); writeJson(join(home, "cache.json"), cache);
  return { removed: id, kept: "the key file" };
}

export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "--refresh") flags[a.slice(2)] = true;
    else if (a === "--max-age" || a === "--projects") {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags[a.slice(2)] = argv[++i];
    } else rest.push(a);
  }
  return { command: rest[0] ?? "list", args: rest.slice(1), flags };
}

/** Runs one command. The Play tab calls this with the same shape the command line parses to. */
export async function run({ command, args = [], flags = {} }, home = homeOf(), io = {}) {
  const real = { fetch: io.fetch ?? globalThis.fetch, now: io.now ?? Date.now };
  switch (command) {
    case "list": return list(home, flags, real);
    case "account":
      if (args[0] === "add") return addAccount(home, args[1], args[2], flags);
      if (args[0] === "remove") return removeAccount(home, args[1]);
      throw new UsageError("account add <name> <key.json> | account remove <id>");
    case "help": case "--help": case "-h": return { help: HELP };
    default: throw new UsageError(`unknown command: ${command} (nv-play help)`);
  }
}
const HELP = `nv-play list [--refresh] [--max-age MIN] | account add <name> <key.json> [--projects DIR] | account remove <id>   (--json)`;

const WORD = { live: "live", review: "IN REVIEW", rejected: "REJECTED", ready: "approved, not published", draft: "draft", testing: "testing only", none: "no release", other: "production" };
function print(command, result) {
  if (result.help) return console.log(result.help);
  if (command !== "list") return console.log(Object.entries(result).map(([k, v]) => `${k}: ${v}`).join("  "));
  if (!result.accounts.length) return console.log("no account yet: nv-play account add <name> <key.json>");
  for (const a of result.accounts) {
    console.log(`${a.name}${a.developers.length ? `  developer ${a.developers.join(", ")}` : ""}  ${a.apps.length} apps  ${a.at ? `checked ${a.at}` : "not checked yet (--refresh)"}${a.error ? `  failed: ${a.error}` : ""}`);
    for (const app of a.apps) {
      const releases = TRACKS.flatMap(t => (app.tracks[t] ?? []).map(r => `${t} ${r.name || r.codes.join(",")} ${r.state}`)).join(" | ");
      console.log(`  ${(WORD[app.state] ?? app.state).padEnd(24)} ${app.name}  (${app.package})${releases ? `  ${releases}` : ""}`);
    }
  }
}

const invoked = process.argv[1] && /nv-play\.mjs$/i.test(process.argv[1]);
if (invoked) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    const result = await run(parsed);
    if (parsed.flags.json) console.log(JSON.stringify(result)); else print(parsed.command, result);
    process.exit(0);
  } catch (error) {
    const msg = String(error?.message ?? error);
    if (parsed?.flags.json) console.error(JSON.stringify({ error: msg })); else console.error(`nv-play: ${msg}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
