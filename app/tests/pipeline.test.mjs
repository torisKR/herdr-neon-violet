import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { CAST, STAGES, activityOf, advance, agentFor, autoPick, castFor, main, modelNames, normalize, parseArgs, parseCast, readFeed, readKey, reference, render, shellQuote, shortTag, slug, statusWord, terminalName, viaShell } from "../pipeline/nv-pipeline.mjs";
import { imageInfo, verifyManifest, writeSheet } from "../pipeline/nv-graphics.mjs";

const T = stage => terminalName(shortTag("cat-cafe"), stage);

const here = fileURLToPath(new URL("../pipeline", import.meta.url));
const KEY = JSON.stringify({ type: "service_account", client_email: "ci@play.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", project_id: "p" });

/** A machine where "agents" are a function: it gets the stage and returns what the agent would write. */
/** A terminal name as the stage and the member in it: pl-<tag>-design, pl-<tag>-assets-w2, pl-<tag>-build-rv. */
const who = name => { const [stage, member = ""] = String(name).replace(/^pl-[a-z0-9]+-/, "").split("-"); return { stage, member }; };

/** A machine where "agents" are a function: it gets the stage and returns what the agent would write.
 *  By default nothing is reviewed or checked, as before those existed; tests that want them say so. */
function world({ agent = stage => ({ status: "done", summary: `${stage} ok` }), key = true, during = null, settings = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nv-pipeline-"));
  const home = join(root, "home"), calls = [], live = new Map();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "settings.json"), JSON.stringify({ root: join(root, "projects"), agent: ["fake-agent"], review: false, checks: false, ...settings }));
  if (key) { mkdirSync(join(home, "secrets")); writeFileSync(join(home, "secrets", "play-key.json"), KEY); }
  let clock = 0;
  const seen = new Set();
  const sys = {
    home, here, self: "t-runner", platform: "win32", has: () => true, now: () => clock, sleep: async ms => { clock += ms; },
    hc(args) {
      calls.push(args);
      if (args[0] === "run") {
        const name = args[args.indexOf("--name") + 1], dir = args[args.indexOf("--cwd") + 1], { stage, member } = who(name);
        // The prompt names the member's own task and result files.
        const prompt = args.at(-1), taskFile = /Read (\S+) and/.exec(prompt)[1], resultFile = /writing (\S+)\.$/.exec(prompt)[1];
        const result = agent(stage, { dir, prompt, member, name, task: readFileSync(join(dir, taskFile), "utf8"), taskFile, resultFile });
        live.set(name, result?.hc ?? { state: "live", status: "idle" });
        if (result && !result.silent) writeFileSync(join(dir, resultFile), JSON.stringify(result));
        return { code: 0, stdout: JSON.stringify({ address: name }), stderr: "" };
      }
      if (args[0] === "get") {
        if (during && !seen.has(args[1])) { seen.add(args[1]); during(who(args[1]).stage, who(args[1]).member); }
        return { code: 0, stdout: JSON.stringify(live.get(args[1]) ?? { state: "finished", exit_code: 0 }), stderr: "" };
      }
      if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ terminals: [...live].map(([name, t]) => ({ address: name, name, ...t })) }), stderr: "" };
      if (args[0] === "kill") live.delete(args[1]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const run = (...argv) => main(sys, parseArgs(argv));
  return { sys, run, calls, live, root };
}

const options = image => ({ status: "done", summary: "three", options: [
  { id: "a", title: "A", desc: "first", score: 60, ...(image ? { image: `pipeline/design/option-a.png` } : {}) },
  { id: "b", title: "B", desc: "second", score: 90, recommended: true },
  { id: "c", title: "C", desc: "third", score: 75 },
] });
const team = stage => stage === "research" || stage === "design" ? options() : stage === "brief" ? { status: "done", summary: "brief", engine: "godot", package: "kr.toris.cat" } : { status: "done", summary: `${stage} ok` };

test("unattended mode runs every stage, takes the recommended options and ends each agent", async () => {
  const w = world({ agent: team });
  const made = await w.run("new", "Cat", "Cafe", "--idea", "cats", "--mode", "auto", "--kind", "game");
  assert.equal(made.id, "cat-cafe");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "done");
  assert.deepEqual(STAGES.map(s => state.stages[s.id].status), STAGES.map(() => "done"));
  assert.deepEqual(state.choice, { research: "b", design: "b" });
  assert.equal(state.engine, "godot");
  assert.equal(state.package, "kr.toris.cat");
  for (const s of STAGES) assert.ok(w.calls.some(c => c[0] === "kill" && c[1] === T(s.id)), `${s.id} agent ended`);
  assert.equal(w.live.size, 0);
  const feed = readFeed(join(w.root, "projects", "cat-cafe"), 100);
  assert.equal(feed.filter(e => e.kind === "handoff").length, STAGES.length);
  assert.deepEqual(feed.find(e => e.kind === "handoff" && e.from === "brief").to, "design");
});

test("each agent gets only its stage's task, with the chosen idea and the engine filled in", async () => {
  const tasks = {};
  const w = world({ agent: (stage, ctx) => { tasks[stage] = ctx; return team(stage); } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe");
  for (const s of STAGES) {
    assert.ok(!/\{\{[a-zA-Z_.]+\}\}/.test(tasks[s.id].task), `${s.id} task has an unfilled placeholder`);
    assert.ok(tasks[s.id].prompt.includes(`pipeline/${s.id}/TASK.md`));
  }
  assert.ok(tasks.brief.task.includes('"title": "B"'));
  assert.ok(tasks.build.task.includes("Engine: **godot**"));
  assert.ok(tasks.build.task.includes("kr.toris.cat"));
  assert.ok(tasks.internal.task.includes("play-key.json"));
  assert.ok(tasks.brief.task.includes("Unity + URP") && tasks.brief.task.includes("Godot") && tasks.brief.task.includes("Flutter"));
});

test("promote mode asks only before production", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe");
  let state = await advance(w.sys, "cat-cafe");
  assert.equal(state.mode, "promote");
  assert.equal(state.status, "waiting");
  assert.deepEqual(state.gate, { kind: "approve", stage: "release" });
  assert.equal(state.stages.internal.status, "done");
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("release"))));
  await w.run("approve", "cat-cafe");
  state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "done");
});

test("review mode stops for the person at each choice and continues with what they picked", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "review");
  let state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "pick", stage: "research" });
  assert.equal(state.stages.research.status, "waiting");
  await assert.rejects(() => w.run("pick", "cat-cafe", "z"), /choose one of: a, b, c/);
  await w.run("pick", "cat-cafe", "c");
  state = await advance(w.sys, "cat-cafe");
  assert.equal(state.choice.research, "c");
  assert.deepEqual(state.gate, { kind: "pick", stage: "design" });
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes(T("research"))).length, 1);
});

test("switching to unattended mid-run stops asking", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "review");
  await advance(w.sys, "cat-cafe");
  await w.run("pick", "cat-cafe", "a");
  await w.run("mode", "cat-cafe", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "done");
  assert.deepEqual(state.choice, { research: "a", design: "b" });
});

test("without the Play key the pipeline builds and tests, then asks for the key before uploading", async () => {
  const w = world({ agent: team, key: false });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  let state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "key", stage: "internal" });
  assert.equal(state.stages.store.status, "done");
  const keyPath = join(w.root, "key.json");
  writeFileSync(keyPath, KEY);
  const saved = await w.run("key", "set", keyPath);
  assert.equal(saved.email, "ci@play.iam.gserviceaccount.com");
  state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "done");
});

test("a key that is not a service account is refused with what to do", () => {
  const dir = mkdtempSync(join(tmpdir(), "nv-key-"));
  writeFileSync(join(dir, "oauth.json"), JSON.stringify({ installed: { client_id: "x" } }));
  assert.throws(() => readKey(join(dir, "oauth.json")), /not a Google service account key/);
  writeFileSync(join(dir, "bad.json"), "nope");
  assert.throws(() => readKey(join(dir, "bad.json")), /not a JSON file/);
});

test("a failing stage is tried once more, then the pipeline stops with the reason", async () => {
  let builds = 0;
  const w = world({ agent: stage => stage === "build" ? (builds++, { status: "failed", summary: "gradle exploded" }) : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(builds, 2);
  assert.equal(state.status, "failed");
  assert.equal(state.stages.build.status, "failed");
  assert.equal(state.stages.build.error, "gradle exploded");
  assert.equal(state.stages.test.status, "pending");
  assert.equal(w.live.size, 0);
});

test("an agent that needs a person stays alive and the pipeline waits", async () => {
  const w = world({ agent: stage => stage === "store" ? { silent: true, hc: { state: "live", status: "blocked" } } : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "blocked", stage: "store" });
  assert.equal(state.stages.store.terminal, T("store"));
  assert.ok(w.live.has(T("store")));
});

test("an agent that never answers is ended when the stage's budget runs out", async () => {
  const w = world({ agent: stage => stage === "research" ? { silent: true, hc: { state: "live", status: "working" } } : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "failed");
  assert.match(state.stages.research.error, /no result after 25 minutes/);
  assert.equal(w.live.size, 0);
});

test("running a stage again clears everything built on it", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe");
  const state = await w.run("retry", "cat-cafe", "design");
  assert.equal(state.stages.brief.status, "done");
  assert.deepEqual(["design", "assets", "release"].map(s => state.stages[s].status), ["pending", "pending", "pending"]);
  assert.deepEqual(state.choice, { research: "b" });
});

test("--until pauses after a stage, and a note from the person lands in the feed", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "brief" });
  assert.equal(state.status, "paused");
  assert.equal(state.stages.design.status, "pending");
  const said = await w.run("say", "cat-cafe", "더", "귀엽게");
  assert.equal(said.delivered, false);
  assert.equal(readFeed(join(w.root, "projects", "cat-cafe")).at(-1).text, "더 귀엽게");
});

test("design images are copied to where the board can show them", async () => {
  const w = world({ agent: (stage, ctx) => {
    if (stage === "design") { writeFileSync(join(ctx.dir, "pipeline", "design", "option-a.png"), "png"); return options(true); }
    return team(stage);
  } });
  await w.run("new", "Cat Cafe", "--mode", "review");
  await advance(w.sys, "cat-cafe");
  await w.run("pick", "cat-cafe", "a");
  const state = await advance(w.sys, "cat-cafe");
  const a = state.options.design.find(o => o.id === "a");
  assert.match(a.preview, /^pipeline\/preview\/cat-cafe\/design-a-\d+\.png$/);
  assert.ok(existsSync(join(w.sys.home, a.preview.replace(/^pipeline\//, ""))));
});

test("small helpers: results, picks, names, templates", () => {
  assert.equal(normalize(null).status, "failed");
  assert.equal(normalize({ status: "weird" }).status, "failed");
  assert.equal(normalize({ status: "done", options: [{ id: 1, title: "x" }, { title: "no id" }] }).options.length, 1);
  assert.equal(autoPick([{ id: "a", score: 1 }, { id: "b", score: 9 }]), "b");
  assert.equal(autoPick([{ id: "a", score: 9 }, { id: "b", recommended: true }]), "b");
  assert.equal(autoPick([]), null);
  assert.equal(slug("  Cat Café 고양이!! "), "cat-caf");
  assert.equal(slug("고양이 카페"), "app");
  assert.equal(render("{{a.b}} {{missing}}", { a: { b: "x" } }), "x {{missing}}");
});

test("on macOS and Linux agents start through a login shell, so node and claude are found", async () => {
  const wrapped = viaShell(["claude", "hi there"], "darwin");
  assert.deepEqual([wrapped[0], wrapped[1], ...wrapped.slice(3)], ["/bin/sh", "-c", "sh", "claude", "hi there"]);
  assert.match(wrapped[2], /SHELL/);            // the person's own shell when it is POSIX-style
  assert.match(wrapped[2], /Darwin.*\/bin\/zsh/); // zsh on macOS, where node usually lives in ~/.zprofile
  assert.deepEqual(viaShell(["claude", "hi"], "win32"), ["claude", "hi"]);
  const w = world({ agent: team });
  w.sys.platform = "darwin";
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe", { until: "research" });
  const launch = w.calls.find(c => c[0] === "run");
  const argv = launch.slice(launch.indexOf("--") + 1);
  assert.deepEqual([argv[0], argv[1], argv[3], argv[4]], ["/bin/sh", "-c", "sh", "fake-agent"]);
});

test("each stage goes to its model: grok researches, codex draws, claude does the rest", async () => {
  const w = world({ agent: team });
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects"), review: false, checks: false }));   // no single custom agent
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(Object.fromEntries(STAGES.map(s => [s.id, state.stages[s.id].agent])), CAST);
  const launch = stage => { const c = w.calls.find(c => c[0] === "run" && c.includes(T(stage))); return c.slice(c.indexOf("--") + 1); };
  assert.deepEqual(launch("research").slice(0, 3), ["grok", "--permission-mode", "auto"]);
  assert.deepEqual(launch("design").slice(0, 6), ["codex", "--no-daemon", "-a", "never", "-s", "workspace-write"]);
  assert.deepEqual(launch("test").slice(0, 3), ["claude", "--permission-mode", "auto"]);
  assert.match(launch("test").at(-1), /"test" stage/);
  assert.deepEqual(launch("build").slice(0, 3), ["claude", "--permission-mode", "auto"]);
  const status = await w.run("status");
  assert.equal(status.stages.find(s => s.id === "research").agent, "grok");
});

test("a model that is not installed, or that failed once, is replaced by claude", async () => {
  let tries = 0;
  const w = world({ agent: stage => stage === "design" && tries++ === 0 ? { status: "failed", summary: "weekly limit reached" } : team(stage) });
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects"), review: false, checks: false }));
  w.sys.has = bin => bin !== "grok";   // as on a machine with only claude and codex
  assert.equal(agentFor(w.sys, "research").name, "claude");
  assert.equal(agentFor(w.sys, "design").name, "codex");
  assert.equal(agentFor(w.sys, "design", 2).name, "claude");
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "done");
  assert.equal(state.stages.research.agent, "claude");
  assert.equal(state.stages.design.agent, "claude");   // the second try
  assert.equal(state.stages.assets.agent, "codex");
  assert.equal(state.stages.test.agent, "claude");
  const designRuns = w.calls.filter(c => c[0] === "run" && c.includes(T("design"))).map(c => c[c.indexOf("--") + 1]);
  assert.deepEqual(designRuns, ["codex", "claude"]);
});

test("agy is never started with skipped permissions unless the person writes that into settings", () => {
  const w = world();
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ cast: { test: "agy" } }));
  assert.deepEqual(agentFor(w.sys, "test").argv("go"), ["agy", "-i", "go"]);
  assert.ok(!Object.values(CAST).includes("agy"));
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ cast: { test: "agy" }, agents: { agy: ["agy", "--dangerously-skip-permissions", "-i", "{prompt}"] } }));
  assert.deepEqual(agentFor(w.sys, "test").argv("go"), ["agy", "--dangerously-skip-permissions", "-i", "go"]);
});

test("settings can recast a stage and change how a model is started", () => {
  const w = world();
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ cast: { research: "claude" }, agents: { claude: ["claude", "--model", "opus", "{prompt}", "--verbose"] } }));
  const a = agentFor(w.sys, "research");
  assert.equal(a.name, "claude");
  assert.deepEqual(a.argv("go"), ["claude", "--model", "opus", "go", "--verbose"]);
});

// ---- what the Codex review reproduced

test("changing the mode while a stage runs is honored: production waits for approval", async () => {
  let w;
  w = world({ agent: team, during: stage => { if (stage === "internal") main(w.sys, parseArgs(["mode", "cat-cafe", "promote"])); } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.mode, "promote");
  assert.deepEqual(state.gate, { kind: "approve", stage: "release" });
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("release"))));
});

test("a stop made while a stage runs wins: its result is not taken and nothing else starts", async () => {
  let w, stops = 0;
  w = world({ agent: team, during: stage => { if (stage === "build" && stops++ === 0) main(w.sys, parseArgs(["stop", "cat-cafe"])); } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "stopped");
  assert.equal(state.stages.build.status, "pending");
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("test"))));
  assert.equal(w.live.size, 0);
  // Continuing later starts from the stopped stage.
  const again = await advance(w.sys, "cat-cafe", { until: "build" });
  assert.equal(again.stages.build.status, "done");
});

test("a second conductor for the same app is refused while one is running", async () => {
  let w, second;
  w = world({ agent: team, during: stage => { if (stage === "research") second = advance(w.sys, "cat-cafe").then(() => "ran", e => e.message); } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.match(await second, /already running/);
  assert.equal(state.status, "done");
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes(T("release"))).length, 1);
});

test("running a stage again while the pipeline works discards what was in progress", async () => {
  let w, once = 0;
  w = world({ agent: team, during: stage => { if (stage === "internal" && once++ === 0) main(w.sys, parseArgs(["retry", "cat-cafe", "design"])); } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.stages.internal.status, "pending");   // the old upload's result was not accepted
  assert.equal(state.stages.design.status, "pending");
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("release"))));
  const done = await advance(w.sys, "cat-cafe");
  assert.equal(done.status, "done");
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes(T("internal"))).length, 2);   // uploaded again after the rebuild
});

test("switching to unattended while a choice is pending takes the saved options without rerunning", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "review");
  await advance(w.sys, "cat-cafe");
  await w.run("mode", "cat-cafe", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "brief" });
  assert.equal(state.choice.research, "b");
  assert.equal(state.stages.brief.status, "done");
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes(T("research"))).length, 1);
});

test("an agent that was waiting for the person is taken over, not started again", async () => {
  let stores = 0;
  const w = world({ agent: stage => stage === "store" ? (stores++, { silent: true, hc: { state: "live", status: "blocked" } }) : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "promote");
  let state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "blocked", stage: "store" });
  // The person answers it; the same agent then finishes its work.
  w.live.set(T("store"), { state: "live", status: "idle" });
  writeFileSync(join(w.root, "projects", "cat-cafe", "pipeline", "store", "result.json"), JSON.stringify({ status: "done", summary: "store ok after help" }));
  state = await advance(w.sys, "cat-cafe");
  assert.equal(stores, 1);
  assert.equal(state.stages.store.summary, "store ok after help");
  assert.equal(state.stages.store.tries, 1);
  assert.deepEqual(state.gate, { kind: "approve", stage: "release" });
});

test("an agent that finished after being helped and then exited is not started again", async () => {
  let stores = 0;
  const w = world({ agent: stage => stage === "store" ? (stores++, { silent: true, hc: { state: "live", status: "blocked" } }) : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "promote");
  await advance(w.sys, "cat-cafe");
  w.live.delete(T("store"));   // it wrote its result and its terminal is gone
  writeFileSync(join(w.root, "projects", "cat-cafe", "pipeline", "store", "result.json"), JSON.stringify({ status: "done", summary: "store ok, then exited" }));
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(stores, 1);
  assert.equal(state.stages.store.summary, "store ok, then exited");
  assert.deepEqual(state.gate, { kind: "approve", stage: "release" });
});

test("removing an app ends an agent that was waiting for the person", async () => {
  const w = world({ agent: stage => stage === "research" ? { silent: true, hc: { state: "live", status: "blocked" } } : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe");
  assert.ok(w.live.has(T("research")));
  await w.run("remove", "cat-cafe");
  assert.equal(w.live.size, 0);
  assert.deepEqual((await w.run("status")).apps, []);
});

test("terminal names fit hc's 32 characters and two apps never share them", async () => {
  const a = shortTag("korean-language-flashcard-an"), b = shortTag("korean-language-flashcard-c0", [a]);
  assert.notEqual(a, b);
  assert.equal(shortTag("x", [shortTag("x")]), `${shortTag("x")}2`);   // a taken tag gets a suffix
  for (const stage of STAGES) assert.ok(terminalName(b, stage.id).length <= 32);
  const w = world({ agent: team });
  const one = await w.run("new", "Cat Cafe"), two = await w.run("new", "Cat Cafe");
  assert.notEqual(one.tag, two.tag);
});

test("the key path is one literal argument in the release commands", () => {
  assert.equal(shellQuote("/tmp/Jane$(printf X)/it's.json", "darwin"), `'/tmp/Jane$(printf X)/it'\\''s.json'`);
  assert.equal(shellQuote("C:\\Users\\O'Neil\\key.json", "win32"), `'C:\\Users\\O''Neil\\key.json'`);
});

test("the Play key is stored owner-only from the first byte", { skip: process.platform === "win32" }, async () => {
  const w = world({ key: false });
  w.sys.platform = process.platform;
  const keyPath = join(w.root, "key.json");
  writeFileSync(keyPath, KEY, { mode: 0o644 });
  await w.run("key", "set", keyPath);
  assert.equal(statSync(join(w.sys.home, "secrets")).mode & 0o777, 0o700);
  assert.equal(statSync(join(w.sys.home, "secrets", "play-key.json")).mode & 0o777, 0o600);
});

test("the listing upload can never reach production, and key paths are quoted", () => {
  const read = name => readFileSync(join(here, "stages", name), "utf8");
  const internal = read("internal.md"), release = read("release.md");
  for (const line of internal.split("\n").filter(l => l.includes("fastlane supply"))) {
    assert.ok(/--track internal/.test(line), line.slice(0, 80));
  }
  assert.ok(internal.includes("--skip_upload_apk") && release.includes("--skip_upload_apk"));
  assert.ok(!/\{\{key\}\}/.test((internal + release).replace(/Play service account key: `\{\{key\}\}`/g, "")), "commands use {{key_arg}}");
  assert.ok(internal.includes("--json_key {{key_arg}}") && release.includes("json_key:{{key_arg}}"));
});

// ---- references

test("references are classified, pictures are copied into the project, and every stage is told not to copy", async () => {
  const tasks = {};
  const w = world({ agent: (stage, ctx) => { tasks[stage] = ctx.task; return team(stage); } });
  const shot = join(w.root, "shot.PNG");
  writeFileSync(shot, "png");
  const made = await w.run("new", "Cat Cafe", "--mode", "auto", "--ref", "https://play.google.com/store/apps/details?id=com.example.cafe", "--ref", "https://github.com/morluto/rea", "--ref", shot, "--ref", "like the cozy ones");
  assert.deepEqual(made.refs.map(r => r.kind), ["play", "repo", "image", "note"]);
  assert.equal(made.refs[2].file, "pipeline/refs/3.png");
  assert.ok(existsSync(join(w.root, "projects", "cat-cafe", "pipeline", "refs", "3.png")));
  await advance(w.sys, "cat-cafe", { until: "design" });
  for (const stage of ["research", "brief", "design"]) {
    assert.ok(tasks[stage].includes("com.example.cafe") && tasks[stage].includes("pipeline/refs/3.png"), stage);
    assert.ok(tasks[stage].includes("References are for learning, not copying"), stage);
  }
  assert.ok(tasks.research.includes("references.md"));
  assert.equal(reference("https://apps.apple.com/app/id1", "/x", 0).kind, "appstore");
});

test("an upload stage left running by a conductor that died is not started again on its own", async () => {
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe", { until: "internal" });
  // As after a crash in the middle of the release: marked running, no terminal, no result.
  const file = join(w.root, "projects", "cat-cafe", "pipeline", "state.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.stages.release = { status: "running", tries: 1 };
  writeFileSync(file, JSON.stringify(saved));
  const state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "blocked", stage: "release" });
  assert.match(state.stages.release.error, /Check Play Console/);
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("release"))));
  await w.run("retry", "cat-cafe", "release");
  assert.equal((await advance(w.sys, "cat-cafe")).status, "done");
});

// ---- what is really happening: stalled runs, agents that stopped on their own

test("hc reports an agent's status as a word or as { app, state }, and both are read", async () => {
  assert.equal(statusWord({ status: "working" }), "working");
  assert.equal(statusWord({ status: { app: "codex", state: "error" } }), "error");
  assert.equal(statusWord({}), undefined);
  // `hc get` gives the object form: a blocked agent must still be seen as blocked.
  const w = world({ agent: stage => stage === "store" ? { silent: true, hc: { state: "live", status: { app: "claude", state: "blocked" } } } : team(stage) });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(state.gate, { kind: "blocked", stage: "store" });
});

test("an agent that stops without a result is reminded twice, then the stage fails with what it showed", async () => {
  const w = world({ agent: stage => stage === "design" ? { silent: true, hc: { state: "live", status: "idle" } } : team(stage), settings: { retries: 0 } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "failed");
  assert.match(state.stages.design.error, /stopped without a result/);
  const nudges = w.calls.filter(c => c[0] === "send" && c[1] === T("design"));
  assert.equal(nudges.length, 2);
  assert.match(nudges[0][2], /result file/);
  assert.equal(w.live.size, 0);
});

test("an agent whose provider reports an error is given up on quickly, and the stand-in model takes the stage", async () => {
  let designs = 0;
  // As when codex answers 429 and sits there: live, status error, no result.
  const w = world({ agent: stage => stage === "design" && designs++ === 0 ? { silent: true, hc: { state: "live", status: { app: "codex", state: "error" } } } : team(stage) });
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects"), review: false, checks: false }));
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "design" });
  assert.equal(state.stages.design.status, "done");
  assert.equal(state.stages.design.agent, "claude");
  assert.equal(w.calls.filter(c => c[0] === "send" && c[1] === T("design")).length, 1);
  assert.ok(readFeed(join(w.root, "projects", "cat-cafe"), 100).some(e => e.kind === "fail" && /reports an error/.test(e.text)));
});

test("an agent whose terminal disappeared fails the stage instead of waiting out its budget", async () => {
  const w = world({ agent: stage => stage === "build" ? { silent: true, hc: { error: { kind: "not_found" } } } : team(stage), settings: { retries: 0 } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "failed");
  assert.match(state.stages.build.error, /terminal is gone/);
});

test("status says what a running stage is really doing: working, quiet or stalled", async () => {
  const term = (status, state = "live") => new Map([["t1", { state, status }]]);
  const rec = { status: "running", terminal: "t1" };
  assert.equal(activityOf(rec, term("working"), true), "working");
  assert.equal(activityOf(rec, term(undefined), true), "working");      // a CLI that reports nothing
  assert.equal(activityOf(rec, term("idle"), true), "quiet");
  assert.equal(activityOf(rec, term("error"), true), "quiet");
  assert.equal(activityOf(rec, new Map(), true), "stalled");            // its terminal is gone
  assert.equal(activityOf(rec, term("working"), false), "stalled");     // no conductor is alive
  assert.equal(activityOf(rec, null, true), "working");                 // the list could not be read
  assert.equal(activityOf({ status: "done" }, term("working"), true), null);
  // A run whose conductor died: the state file still says running.
  const w = world({ agent: team });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe", { until: "brief" });
  const file = join(w.root, "projects", "cat-cafe", "pipeline", "state.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.status = "running"; saved.stage = "design"; saved.stages.design = { status: "running", tries: 1, terminal: T("design") };
  writeFileSync(file, JSON.stringify(saved));
  let app = (await w.run("status")).apps[0];
  assert.equal(app.conducted, false);
  assert.equal(app.activity.design, "stalled");
  assert.equal(app.live[T("design")], "gone");
  // With a conductor alive (this process holds the run lock) and the agent working.
  writeFileSync(join(w.root, "projects", "cat-cafe", "pipeline", "run.lock"), String(process.pid));
  w.live.set(T("design"), { state: "live", status: "working" });
  app = (await w.run("status")).apps[0];
  assert.equal(app.conducted, true);
  assert.equal(app.activity.design, "working");
  assert.equal(app.live[T("design")], "working");
});

// ---- the cast: models and workers chosen before the start

test("an app's own cast picks the agent, its model and how many work on a stage", async () => {
  const w = world({ agent: team });
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects"), review: false, checks: false }));
  const made = await w.run("new", "Cat Cafe", "--mode", "auto", "--cast", "build=claude:opus", "--cast", "research=codex*2", "--cast", "brief=grok:grok-4.7", "--review", "build=none");
  assert.deepEqual(made.cast, { build: { agent: "claude", model: "opus", review: "none" }, research: { agent: "codex", model: null, count: 2 }, brief: { agent: "grok", model: "grok-4.7" } });
  const state = await advance(w.sys, "cat-cafe", { until: "build" });
  const launch = name => { const c = w.calls.find(c => c[0] === "run" && c.includes(name)); return c.slice(c.indexOf("--") + 1); };
  assert.deepEqual(launch(T("build")).slice(0, 5), ["claude", "--model", "opus", "--permission-mode", "auto"]);
  assert.deepEqual(launch(T("brief")).slice(0, 3), ["grok", "-m", "grok-4.7"]);
  // Two researchers, each in its own terminal with its own files; their options are merged.
  const t = shortTag("cat-cafe");
  assert.equal(launch(terminalName(t, "research", "w1"))[0], "codex");
  assert.equal(launch(terminalName(t, "research", "w2"))[0], "codex");
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(T("research"))));
  assert.deepEqual(state.stages.research.members.map(m => [m.id, m.part, m.agent, m.status]), [["w1", "worker", "codex", "done"], ["w2", "worker", "codex", "done"]]);
  assert.deepEqual(state.options.research.map(o => o.id), ["w1-b", "w2-b", "w1-c", "w2-c", "w1-a", "w2-a"]);
  assert.equal(state.options.research.filter(o => o.recommended).length, 1);
  assert.equal(state.choice.research, "w1-b");
  const shown = (await w.run("status")).apps[0].team;
  assert.deepEqual(shown.build, { agent: "claude", model: "opus", count: 1, review: "none" });
  assert.deepEqual(shown.research, { agent: "codex", model: null, count: 2, review: "none" });
  assert.equal(shown.assets.review, "none");
});

test("cast specs, and changing the cast of a stage that has not started", async () => {
  assert.deepEqual(parseCast("claude"), { agent: "claude", model: null });
  assert.deepEqual(parseCast("codex:google-antigravity/gemini-4-hydrogen*3"), { agent: "codex", model: "google-antigravity/gemini-4-hydrogen", count: 3 });
  assert.throws(() => parseCast(":opus"), /names no agent/);
  const w = world({ agent: team });
  await assert.rejects(() => w.run("new", "X", "--cast", "nope=claude"), /--cast takes <stage>=<agent>/);
  await w.run("new", "Cat Cafe", "--mode", "auto", "--cast", "test=claude:opus");
  await advance(w.sys, "cat-cafe", { until: "research" });
  let state = await w.run("cast", "cat-cafe", "test", "codex", "--review", "claude:sonnet");
  assert.deepEqual(state.cast.test, { agent: "codex", review: "claude:sonnet" });   // the old agent's model is not kept
  state = await w.run("cast", "cat-cafe", "design", "claude*3");
  assert.equal(castFor(w.sys, state, "design").count, 3);
  assert.equal(castFor(w.sys, { cast: { build: { count: 3 } } }, "build").count, 1);   // build is never split
  assert.equal(castFor(w.sys, { cast: { design: { count: 9 } } }, "design").count, 4);
  await assert.rejects(() => w.run("cast", "cat-cafe", "research", "claude"), /already started/);
});

test("the machine's agents are listed with their models, and another CLI can be added", async () => {
  const w = world();
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({}));
  let listings = 0;
  w.sys.has = bin => ["claude", "codex", "grok", "mycli"].includes(bin);
  w.sys.exec = argv => (listings++, argv[0] === "grok"
    ? { code: 0, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.7-build-fast\n  - ocx-gpt-6-2-sol\n", stderr: "" } : { code: 1, stdout: "", stderr: "" });
  const list = await w.run("agents");
  const by = Object.fromEntries(list.agents.map(a => [a.name, a]));
  assert.deepEqual(by.grok.models, ["grok-4.7", "grok-4.7-build-fast", "ocx-gpt-6-2-sol"]);
  assert.deepEqual(by.claude.models, ["opus", "sonnet", "haiku"]);
  assert.equal(by.codex.installed, true);
  assert.equal(by.gemini.installed, false);
  assert.equal(by.opencode.model, false);   // no model flag: its own default is used
  assert.deepEqual(list.team.assets, { agent: "codex", split: true, review: "claude" });
  assert.deepEqual(list.team.build, { agent: "claude", split: false, review: "codex" });
  await w.run("agents");
  assert.equal(listings, 1, "the listing is kept, not asked again every time");
  assert.deepEqual(modelNames("Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nauto - Auto (default)\ngpt-5.2 - GPT-5.2\n"), ["gemini-4-argon-high", "gpt-5.2"]);
  // A CLI the + menu knows but the pipeline does not: castable once added, its task as the last argument.
  assert.deepEqual(await w.run("agents", "add", "mycli", "mycli", "run"), { added: true, name: "mycli" });
  assert.deepEqual(await w.run("agents", "add", "claude", "claude"), { added: false, name: "claude" });
  assert.deepEqual(agentFor(w.sys, "build", 1, { agent: "mycli" }).argv("go"), ["mycli", "run", "go"]);
  assert.ok((await w.run("agents")).agents.some(a => a.name === "mycli" && a.installed && !a.builtin));
});

// ---- loops: review rounds, the conductor's own checks, test back to build

test("a reviewer's findings send the worker back for another round, then the review passes", async () => {
  let builds = 0, reviews = 0;
  const seen = [];
  const w = world({ settings: { review: { build: "claude" } }, agent: (stage, ctx) => {
    if (stage !== "build") return team(stage);
    if (ctx.member === "rv") {
      assert.match(ctx.task, /You review; you do not fix/);
      return reviews++ === 0 ? { status: "done", verdict: "fix", issues: ["lib/main.dart: 시작 버튼이 동작하지 않음"], summary: "고칠 것 1건" } : { status: "done", verdict: "pass", issues: [], summary: "통과" };
    }
    seen.push({ fixes: existsSync(join(ctx.dir, "pipeline", "build", "fixes.md")), task: ctx.task });
    return { status: "done", summary: `build ${++builds}` };
  } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "build" });
  assert.equal(state.stages.build.status, "done");
  assert.deepEqual([builds, reviews], [2, 2]);
  assert.equal(state.stages.build.round, 2);
  assert.equal(state.stages.build.summary, "build 2");
  assert.deepEqual(seen.map(s => s.fixes), [false, true]);
  assert.match(seen[0].task, /first round/);
  assert.match(seen[1].task, /round 2\. Read `pipeline\/build\/fixes\.md`/);
  assert.ok(!existsSync(join(w.root, "projects", "cat-cafe", "pipeline", "build", "fixes.md")), "a clean stage leaves no fix list");
  assert.deepEqual(state.stages.build.members.map(m => m.part).sort(), ["review", "worker"]);
  const codes = readFeed(join(w.root, "projects", "cat-cafe"), 100).filter(e => e.from === "build").map(e => e.code).filter(Boolean);
  assert.deepEqual(codes, ["start", "review.start", "round", "review.start", "review.pass"]);
  assert.equal(w.live.size, 0);
});

test("a reviewer that never passes does not hold the stage forever, and one that crashes is skipped", async () => {
  let builds = 0;
  const w = world({ settings: { review: { build: "claude", assets: "claude" }, rounds: 2 }, agent: (stage, ctx) => {
    if (ctx.member === "rv") return stage === "assets" ? { status: "failed", summary: "limit reached" } : { status: "done", verdict: "fix", issues: ["아직 마음에 들지 않음"], summary: "fix" };
    if (stage === "build") builds++;
    return team(stage);
  } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "build" });
  assert.equal(state.stages.assets.status, "done");
  assert.equal(builds, 2);
  assert.equal(state.stages.build.status, "done");
  assert.match(state.stages.build.summary, /검토 지적 1건/);
  assert.ok(existsSync(join(w.root, "projects", "cat-cafe", "pipeline", "build", "fixes.md")));
});

/** A small RGBA PNG whose pixels come from a function. */
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sprite = (x, y) => (x + y) % 2 ? [200, 60, 60, 255] : [0, 0, 0, 0];      // has see-through pixels
const solid = (x, y) => [x * 9 % 256, y * 5 % 256, 90, 255];                    // opaque, not blank

test("pictures are measured from their bytes: size, transparency, blank images, duplicates, missing files", () => {
  assert.deepEqual(imageInfo(png(8, 6, sprite)), { format: "png", w: 8, h: 6, alpha: true, transparent: true, flat: false });
  assert.deepEqual(imageInfo(png(4, 4, solid)), { format: "png", w: 4, h: 4, alpha: true, transparent: false, flat: false });
  assert.equal(imageInfo(png(4, 4, () => [9, 9, 9, 255])).flat, true);
  assert.equal(imageInfo(Buffer.from("not an image")), null);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 1, 0x11, 0]);
  assert.deepEqual(imageInfo(jpeg), { format: "jpeg", w: 30, h: 20, alpha: false, transparent: false });
  const dir = mkdtempSync(join(tmpdir(), "nv-graphics-"));
  mkdirSync(join(dir, "assets"), { recursive: true }); mkdirSync(join(dir, "pipeline", "assets"), { recursive: true });
  const put = (name, buf) => writeFileSync(join(dir, "assets", name), buf);
  put("cat.png", png(8, 8, sprite)); put("bg.png", png(16, 8, solid)); put("small.png", png(4, 4, solid));
  put("blank.png", png(8, 8, () => [255, 255, 255, 255])); put("copy.png", png(8, 8, sprite)); put("icon.png", png(10, 10, sprite)); put("fg.png", png(6, 6, solid));
  const items = [
    { file: "assets/cat.png", w: 8, h: 8, alpha: true, use: "player", owner: "w1" },
    { file: "assets/bg.png", w: 16, h: 8, alpha: false, owner: "w1" },
    { file: "assets/small.png", w: 8, h: 8, owner: "w2" },
    { file: "assets/blank.png", owner: "w2" },
    { file: "assets/copy.png", owner: "w2" },
    { file: "assets/icon.png", alpha: false, owner: "w1" },
    { file: "assets/fg.png", alpha: true, owner: "w1" },
    { file: "assets/missing.png", owner: "w2" },
    { file: "../outside.png" },
  ];
  writeFileSync(join(dir, "pipeline", "assets", "manifest.json"), JSON.stringify({ items }));
  const found = verifyManifest(dir, "pipeline/assets/manifest.json");
  const said = Object.fromEntries(found.issues.map(i => [i.file, i.text]));
  assert.deepEqual(Object.keys(said).sort(), ["../outside.png", "assets/blank.png", "assets/copy.png", "assets/fg.png", "assets/icon.png", "assets/missing.png", "assets/small.png"]);
  assert.match(said["assets/small.png"], /is 4x4, the manifest says 8x8/);
  assert.match(said["assets/blank.png"], /one flat color/);
  assert.match(said["assets/copy.png"], /same picture as assets\/cat\.png/);
  assert.match(said["assets/icon.png"], /must be fully opaque/);
  assert.match(said["assets/fg.png"], /needs a transparent background/);
  assert.match(said["assets/missing.png"], /does not exist/);
  assert.equal(found.issues.find(i => i.file === "assets/small.png").owner, "w2");
  assert.deepEqual(found.items.filter(i => i.ok).map(i => i.file), ["assets/cat.png", "assets/bg.png"]);
  writeSheet(dir, "pipeline/assets/sheet.html", "Artist", found.items, found.issues);
  const sheet = readFileSync(join(dir, "pipeline", "assets", "sheet.html"), "utf8");
  assert.ok(sheet.includes('src="../../assets/cat.png"') && sheet.includes("문제 7건"));
  assert.match(verifyManifest(dir, "pipeline/none.json").issues[0].text, /is missing/);
});

test("the conductor checks the artist's images itself and sends the bad ones back", async () => {
  let rounds = 0;
  const seen = [];
  const w = world({ settings: { checks: true }, agent: (stage, ctx) => {
    if (stage !== "assets") return team(stage);
    rounds++;
    seen.push(existsSync(join(ctx.dir, "pipeline", "assets", "fixes.md")) ? readFileSync(join(ctx.dir, "pipeline", "assets", "fixes.md"), "utf8") : null);
    mkdirSync(join(ctx.dir, "assets"), { recursive: true });
    writeFileSync(join(ctx.dir, "assets", "cat.png"), png(rounds === 1 ? 5 : 8, 8, sprite));   // the first try is the wrong size
    writeFileSync(join(ctx.dir, "pipeline", "assets", "manifest.json"), JSON.stringify({ items: [{ file: "assets/cat.png", w: 8, h: 8, alpha: true, use: "player" }] }));
    return { status: "done", summary: "1 asset" };
  } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "assets" });
  assert.equal(state.stages.assets.status, "done");
  assert.equal(rounds, 2);
  assert.equal(seen[0], null);
  assert.match(seen[1], /assets\/cat\.png: is 5x8, the manifest says 8x8/);
  assert.ok(existsSync(join(w.root, "projects", "cat-cafe", "pipeline", "assets", "sheet.html")));
});

test("images that still fail the checks after the last round fail the stage, with the reason", async () => {
  const w = world({ settings: { checks: true, rounds: 2, retries: 0 }, agent: team });   // the artist never writes a manifest
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "failed");
  assert.match(state.stages.assets.error, /automatic checks still fail after 2 round\(s\).*manifest\.json is missing/);
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes(T("assets"))).length, 2);
});

test("several artists: the lead splits the manifest first, then the workers draw at the same time", async () => {
  const order = [], tasks = {};
  const w = world({ agent: (stage, ctx) => { if (stage === "assets") { order.push(ctx.member); tasks[ctx.member] = ctx; } return team(stage); } });
  await w.run("new", "Cat Cafe", "--mode", "auto", "--cast", "assets=codex*2");
  const state = await advance(w.sys, "cat-cafe", { until: "assets" });
  assert.deepEqual(order, ["ld", "w1", "w2"]);
  assert.match(tasks.ld.task, /split the art of the first version among 2 artists/);
  assert.match(tasks.ld.task, /`owner`: one of w1, w2/);
  assert.equal(tasks.ld.resultFile, "pipeline/assets/result-lead.json");
  assert.match(tasks.w2.task, /make \*\*only\*\* the items whose `owner` is `w2`/);
  assert.equal(tasks.w2.resultFile, "pipeline/assets/result-w2.json");
  // Both workers were started before either was waited for.
  const runs = w.calls.map((c, i) => ({ c, i })).filter(x => x.c[0] === "run" && /-assets-w\d$/.test(x.c[x.c.indexOf("--name") + 1])).map(x => x.i);
  const firstGet = w.calls.findIndex(c => c[0] === "get" && /-assets-w\d$/.test(c[1]));
  assert.ok(runs.length === 2 && runs[1] < firstGet);
  assert.equal(state.stages.assets.status, "done");
  assert.match(state.stages.assets.summary, /\[w1\] assets ok \[w2\] assets ok/);
  assert.equal(w.live.size, 0);
  for (const m of ["ld", "w1", "w2", "rv"]) assert.ok(terminalName(shortTag("korean-language-flashcard-an"), "research", m).length <= 32);
});

test("stopping ends every worker of a stage, and a note from the person reaches each of them", async () => {
  let w, said;
  w = world({ agent: stage => stage === "design" ? { silent: true, hc: { state: "live", status: "working" } } : team(stage),
    during: (stage, member) => { if (stage === "design" && member === "w2") { said = main(w.sys, parseArgs(["say", "cat-cafe", "더 밝게"])); main(w.sys, parseArgs(["stop", "cat-cafe"])); } } });
  await w.run("new", "Cat Cafe", "--mode", "auto", "--cast", "design=codex*3");
  const state = await advance(w.sys, "cat-cafe");
  assert.equal(state.status, "stopped");
  assert.equal((await said).delivered, true);
  assert.equal(w.calls.filter(c => c[0] === "send" && /-design-w\d$/.test(c[1])).length, 3);
  assert.equal(w.live.size, 0);
  assert.equal(state.stages.design.status, "pending");
});

test("a test that fails on defects goes back to the developer, and both stages run again", async () => {
  let builds = 0, tests = 0;
  const fixes = [];
  const w = world({ agent: (stage, ctx) => {
    if (stage === "build") { builds++; fixes.push(existsSync(join(ctx.dir, "pipeline", "build", "fixes.md")) ? readFileSync(join(ctx.dir, "pipeline", "build", "fixes.md"), "utf8") : null); }
    if (stage === "test" && tests++ === 0) return { status: "failed", summary: "8 of 10 pass", defects: ["check 3: 시작을 누르면 검은 화면", "check 7: 회전하면 점수가 0이 됨"] };
    return team(stage);
  } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe", { until: "test" });
  assert.deepEqual([builds, tests], [2, 2]);
  assert.equal(state.stages.test.status, "done");
  assert.equal(state.loops, 1);
  assert.equal(fixes[0], null);
  assert.match(fixes[1], /check 3: 시작을 누르면 검은 화면\n- check 7/);
  const loop = readFeed(join(w.root, "projects", "cat-cafe"), 100).find(e => e.code === "loop.build");
  assert.deepEqual([loop.from, loop.to, loop.arg], ["test", "build", "2"]);
});

test("the build and test loop is limited, and a failure that is not a defect in the app does not loop", async () => {
  let builds = 0;
  const w = world({ settings: { loops: 2 }, agent: stage => {
    if (stage === "build") builds++;
    return stage === "test" ? { status: "failed", summary: "still broken", defects: ["check 1 fails"] } : team(stage);
  } });
  await w.run("new", "Cat Cafe", "--mode", "auto");
  let state = await advance(w.sys, "cat-cafe");
  assert.equal(builds, 3);                      // the first build and two loops
  assert.equal(state.status, "failed");
  assert.equal(state.stages.test.status, "failed");
  await w.run("retry", "cat-cafe", "build");    // running it again starts the count anew
  assert.equal(JSON.parse(readFileSync(join(w.root, "projects", "cat-cafe", "pipeline", "state.json"), "utf8")).loops, 0);
  let tests = 0;
  const v = world({ agent: stage => stage === "test" ? (tests++, { status: "failed", summary: "no device" }) : team(stage) });
  await v.run("new", "Cat Cafe", "--mode", "auto");
  state = await advance(v.sys, "cat-cafe");
  assert.equal(tests, 2);                       // the ordinary one retry
  assert.equal(v.calls.filter(c => c[0] === "run" && c.includes(T("build"))).length, 1);
});
