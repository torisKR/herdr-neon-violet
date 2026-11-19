import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsageError, developerOf, foldersOf, parseArgs, run, summarize } from "../play/nv-play.mjs";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const rel = (name, state, code = 1) => ({ releaseName: name, activeArtifacts: [{ versionCode: code }], releaseLifecycleState: `RELEASE_LIFECYCLE_STATE_${state}` });

/** A temporary home with a service-account key, and a Google that answers from `tracks` ({ package: { track: [release] } }). */
function world(tracks = {}, { apps = Object.keys(tracks), store = {}, developers = {}, token = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nv-play-")), home = join(root, "herdr-app", "play"), key = join(root, "key.json"), projects = join(root, "projects");
  mkdirSync(projects);
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "bot@example.iam.gserviceaccount.com", private_key: pair.privateKey, token_uri: "https://oauth2.example/token" }));
  const seen = [];
  const answer = (status, body, html = "") => ({ status, text: async () => html, json: async () => { if (body === undefined) throw new SyntaxError("Unexpected end of JSON input"); return body; } });
  const page = id => `<script type="application/ld+json">{"@type":"SoftwareApplication","author":{"@type":"Person","name":${JSON.stringify(developers[id] ?? "Toris")},"url":"https://toris.kr"}}</script>`;
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET", auth: init.headers?.authorization ?? null, body: init.body ?? null });
    if (url === "https://oauth2.example/token") return token ? answer(200, { access_token: "tok" }) : answer(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
    if (url.startsWith("https://playdeveloperreporting.googleapis.com/")) {
      const second = url.includes("pageToken=next");
      const mine = apps.length > 1 ? (second ? apps.slice(1) : apps.slice(0, 1)) : apps;
      return answer(200, { apps: mine.map(p => ({ packageName: p, displayName: `App ${p.split(".").at(-1)}` })), ...(apps.length > 1 && !second ? { nextPageToken: "next" } : {}) });
    }
    if (url.startsWith("https://play.google.com/store/apps/details?id=")) { const id = url.split("id=")[1]; return answer(store[id] ?? 404, {}, page(id)); }
    const m = /applications\/([\w.]+)\/tracks\/(\w+)\/releases$/.exec(url);
    if (!m) return answer(500, {});
    const got = tracks[m[1]]?.[m[2]];
    if (got === "empty") return answer(204, undefined);
    if (got === "denied") return answer(403, { error: { message: "The caller does not have permission" } });
    return got ? answer(200, { releases: got }) : answer(404, { error: { message: "Track not found" } });
  };
  let clock = Date.parse("2026-11-19T00:00:00Z");
  const nv = (...argv) => run(parseArgs(argv), home, { fetch, now: () => clock });
  return { root, home, key, projects, seen, nv, tick: minutes => { clock += minutes * 60000; } };
}

test("an account is added by its key file, once, and the key itself is never copied", async () => {
  const w = world();
  const made = await w.nv("account", "add", "Toris", w.key);
  assert.deepEqual([made.id, made.name, made.email], ["toris", "Toris", "bot@example.iam.gserviceaccount.com"]);
  assert.equal((await w.nv("account", "add", "Toris", w.key)).id, "toris", "the same account is not added twice");
  const stored = readFileSync(join(w.home, "play.json"), "utf8");
  assert.ok(stored.includes("key.json") && !stored.includes("PRIVATE KEY"));
  const listed = await w.nv("list");
  assert.deepEqual([listed.accounts.length, listed.accounts[0].at, listed.accounts[0].apps.length], [1, null, 0]);   // nothing is asked until a check
  assert.equal(w.seen.length, 0);
  assert.match(listed.tool, /herdr-app[\\/]bin[\\/]nv-play\.mjs$/);
  writeFileSync(join(w.root, "other.json"), JSON.stringify({ type: "authorized_user" }));
  await assert.rejects(w.nv("account", "add", "X", join(w.root, "other.json")), /not a service-account key/);
  await assert.rejects(w.nv("account", "add", "X", join(w.root, "nope.json")), /does not exist/);
  await assert.rejects(w.nv("account", "add", "X"), UsageError);
  assert.deepEqual(await w.nv("account", "remove", "toris"), { removed: "toris", kept: "the key file" });
  await assert.rejects(w.nv("account", "remove", "toris"), /no account named/);
});

test("a check reads every app and track with GET requests only, and says where each app stands", async () => {
  const w = world({
    "com.t.live": { production: [rel("1.2 - 큰 업데이트", "PUBLISHED", 12)], internal: [rel("12 (1.2)", "PUBLISHED", 12)] },
    "com.t.review": { production: [rel("2.0", "IN_REVIEW", 20), rel("1.9", "PUBLISHED", 19)] },
    "com.t.rejected": { production: [rel("1.1", "NOT_APPROVED"), rel("1.0", "PUBLISHED")] },
    "com.t.testing": { internal: [rel("3", "PUBLISHED", 3)] },
    "com.t.empty": { production: "empty", beta: "empty" },
    "com.t.denied": { production: "denied" },
  }, { store: { "com.t.live": 200, "com.t.review": 200, "com.t.rejected": 200 }, developers: { "com.t.review": "Wake \"Mission\"" } });
  mkdirSync(join(w.projects, "live_app", "android", "app"), { recursive: true });
  writeFileSync(join(w.projects, "live_app", "android", "app", "build.gradle.kts"), 'android {\n  defaultConfig { applicationId = "com.t.live" }\n}');
  await w.nv("account", "add", "Toris", w.key, "--projects", w.projects);
  const { accounts: [a] } = await w.nv("list", "--refresh");
  assert.equal(a.error, null);
  // What needs a look comes first.
  assert.deepEqual(a.apps.map(x => [x.package, x.state, x.live]), [["com.t.rejected", "rejected", true], ["com.t.review", "review", true], ["com.t.testing", "testing", false],
    ["com.t.live", "live", true], ["com.t.denied", "none", false], ["com.t.empty", "none", false]]);
  const live = a.apps.find(x => x.package === "com.t.live");
  assert.deepEqual(live.tracks, { production: [{ name: "1.2 - 큰 업데이트", codes: [12], state: "published" }], internal: [{ name: "12 (1.2)", codes: [12], state: "published" }] });
  assert.deepEqual([live.name, live.store, live.folder], ["App live", "live", join(w.projects, "live_app")]);
  assert.equal(a.apps.find(x => x.package === "com.t.testing").store, "missing");
  // The developer is the one the public store page names; the account lists its developers, the most common first.
  assert.deepEqual(a.apps.map(x => [x.package, x.developer]), [["com.t.rejected", "Toris"], ["com.t.review", 'Wake "Mission"'], ["com.t.testing", null],
    ["com.t.live", "Toris"], ["com.t.denied", null], ["com.t.empty", null]]);
  assert.deepEqual(a.developers, ["Toris", 'Wake "Mission"']);
  assert.match(a.apps.find(x => x.package === "com.t.denied").error, /production: HTTP 403: The caller does not have permission/);   // a track that cannot be read is said, a track that does not exist is not
  assert.equal(a.apps.find(x => x.package === "com.t.empty").error, undefined);
  // Only the token request is a POST; everything sent to Google Play is a GET with the token.
  assert.deepEqual([...new Set(w.seen.filter(s => s.method !== "GET").map(s => s.url))], ["https://oauth2.example/token"]);
  assert.ok(w.seen.filter(s => s.url.includes("googleapis.com")).every(s => s.auth === "Bearer tok"));
  assert.equal(w.seen.filter(s => s.url.includes("apps:search")).length, 2, "the app list is read page by page");
  // The token request is a JWT signed with the key, for the two read scopes.
  const [head, body, sig] = /assertion=([^&]+)/.exec(w.seen[0].body)[1].split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(pair.publicKey, Buffer.from(sig, "base64url")));
  const claim = JSON.parse(Buffer.from(body, "base64url"));
  assert.deepEqual([claim.iss, claim.aud], ["bot@example.iam.gserviceaccount.com", "https://oauth2.example/token"]);
  assert.match(claim.scope, /androidpublisher .*playdeveloperreporting/);
});

test("the last check is kept: it is read without asking Google until it is old or a check is asked for", async () => {
  const w = world({ "com.t.a": { production: [rel("1.0", "PUBLISHED")] } });
  await w.nv("account", "add", "Toris", w.key);
  await w.nv("list", "--refresh");
  const asked = w.seen.length;
  assert.equal((await w.nv("list")).accounts[0].apps[0].state, "live");
  w.tick(10);
  await w.nv("list", "--max-age", "30");
  assert.equal(w.seen.length, asked, "ten minutes old is not old");
  w.tick(25);
  const again = await w.nv("list", "--max-age", "30");
  assert.ok(w.seen.length > asked);
  assert.equal(again.accounts[0].at, "2026-11-19T00:35:00.000Z");
  await assert.rejects(w.nv("list", "--max-age", "soon"), UsageError);
});

test("a track that cannot be read this time keeps the releases the last check read", async () => {
  const tracks = { "com.t.a": { production: [rel("2.0", "IN_REVIEW"), rel("1.0", "PUBLISHED")], internal: [rel("9", "PUBLISHED")] } };
  const store = { "com.t.a": 200 }, w = world(tracks, { store });
  await w.nv("account", "add", "Toris", w.key);
  await w.nv("list", "--refresh");
  assert.equal((await w.nv("list")).accounts[0].apps[0].developer, "Toris");
  tracks["com.t.a"].production = "denied";                       // Google limits how often releases are listed
  tracks["com.t.a"].internal = [rel("10", "PUBLISHED")];
  store["com.t.a"] = 503;                                         // and the store page does not answer this time
  const app = (await w.nv("list", "--refresh")).accounts[0].apps[0];
  assert.deepEqual([app.state, app.live, app.tracks.production.length, app.tracks.internal[0].name, app.developer], ["review", true, 2, "10", "Toris"]);
  assert.match(app.error, /production: HTTP 403/);
});

test("a check that fails says why and keeps what the last one read", async () => {
  const w = world({ "com.t.a": { production: [rel("1.0", "PUBLISHED")] } });
  await w.nv("account", "add", "Toris", w.key);
  const first = (await w.nv("list", "--refresh")).accounts[0];
  writeFileSync(w.key, "{}");
  const failed = (await w.nv("list", "--refresh")).accounts[0];
  assert.match(failed.error, /not a service-account key file/);
  assert.deepEqual([failed.at, failed.apps.length], [first.at, 1]);
  const bad = world({}, { token: false });
  await bad.nv("account", "add", "Toris", bad.key);
  assert.match((await bad.nv("list", "--refresh")).accounts[0].error, /Google did not accept the key: Invalid JWT Signature/);
});

test("where an app stands is one word, the most urgent first", () => {
  const r = (...states) => states.map(state => ({ name: "x", codes: [], state }));
  assert.deepEqual(summarize({ production: r("in_review", "published") }), { state: "review", live: true });
  assert.deepEqual(summarize({ production: r("not_approved", "in_review") }), { state: "rejected", live: false });
  assert.deepEqual(summarize({ production: r("approved_not_published") }), { state: "ready", live: false });
  assert.deepEqual(summarize({ production: r("draft") }), { state: "draft", live: false });
  assert.deepEqual(summarize({ production: r("not_sent_for_review", "published") }), { state: "draft", live: true });
  assert.deepEqual(summarize({ production: r("something_new") }), { state: "other", live: false });
  assert.deepEqual(summarize({ alpha: r("published") }), { state: "testing", live: false });
  assert.deepEqual(summarize({}), { state: "none", live: false });
});

test("a rejection only counts while it is the newest version: a later approved one sinks it", () => {
  const v = (state, code) => ({ name: "x", codes: [code], state });
  assert.deepEqual(summarize({ production: [v("not_approved", 3), v("published", 4)] }), { state: "live", live: true });
  assert.deepEqual(summarize({ production: [v("not_approved", 3), v("approved_not_published", 4)] }), { state: "ready", live: false });
  // Only a newer version that went through replaces a rejection: one in review or a draft leaves it unresolved.
  assert.deepEqual(summarize({ production: [v("not_approved", 3), v("in_review", 4)] }), { state: "rejected", live: false });
  assert.deepEqual(summarize({ production: [v("not_approved", 3), v("draft", 4)] }), { state: "rejected", live: false });
  assert.deepEqual(summarize({ production: [v("published", 4), v("not_approved", 5)] }), { state: "rejected", live: true });
});

test("the developer is read from the JSON-LD author of a store page", () => {
  assert.equal(developerOf('..."author":{"@type":"Organization","name":"Acme \\u0026 Co","url":"x"}...'), "Acme & Co");
  assert.equal(developerOf("<html>no author</html>"), null);
  assert.equal(developerOf(undefined), null);
});

test("project folders are matched to packages by the Android application id or the fastlane Appfile", () => {
  const w = world();
  const put = (path, text) => { mkdirSync(join(w.projects, ...path.slice(0, -1)), { recursive: true }); writeFileSync(join(w.projects, ...path), text); };
  put(["a", "android", "app", "build.gradle"], "defaultConfig {\n  applicationId 'com.t.a'\n}");
  put(["b", "android", "fastlane", "Appfile"], 'json_key_file("x.json")\npackage_name("com.t.b")');
  put(["c", "fastlane", "Appfile"], "package_name 'com.t.c'");
  put(["d", "README.md"], "no android here");
  assert.deepEqual(foldersOf(w.projects), { "com.t.a": join(w.projects, "a"), "com.t.b": join(w.projects, "b"), "com.t.c": join(w.projects, "c") });
  assert.deepEqual(foldersOf(join(w.root, "nope")), {});
});

test("the command line: flags, the default command, unknown commands", async () => {
  assert.deepEqual(parseArgs([]), { command: "list", args: [], flags: {} });
  assert.deepEqual(parseArgs(["list", "--refresh", "--json", "--max-age", "5"]), { command: "list", args: [], flags: { refresh: true, json: true, "max-age": "5" } });
  assert.throws(() => parseArgs(["list", "--max-age"]), /--max-age needs a value/);
  const w = world();
  await assert.rejects(w.nv("frobnicate"), /unknown command/);
  await assert.rejects(w.nv("account", "rename"), UsageError);
  assert.match((await w.nv("help")).help, /nv-play list/);
});
