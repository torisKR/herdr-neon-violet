import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CAST, STAGES, advance, agentFor, autoPick, main, normalize, parseArgs, readFeed, readKey, render, slug, viaShell } from "../pipeline/nv-pipeline.mjs";

const here = fileURLToPath(new URL("../pipeline", import.meta.url));
const KEY = JSON.stringify({ type: "service_account", client_email: "ci@play.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", project_id: "p" });

/** A machine where "agents" are a function: it gets the stage and returns what the agent would write. */
function world({ agent = stage => ({ status: "done", summary: `${stage} ok` }), key = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nv-pipeline-"));
  const home = join(root, "home"), calls = [], live = new Map();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "settings.json"), JSON.stringify({ root: join(root, "projects"), agent: ["fake-agent"] }));
  if (key) { mkdirSync(join(home, "secrets")); writeFileSync(join(home, "secrets", "play-key.json"), KEY); }
  let clock = 0;
  const sys = {
    home, here, self: "t-runner", platform: "win32", has: () => true, now: () => clock, sleep: async ms => { clock += ms; },
    hc(args) {
      calls.push(args);
      if (args[0] === "run") {
        const name = args[args.indexOf("--name") + 1], dir = args[args.indexOf("--cwd") + 1], stage = name.split("-").at(-1);
        const result = agent(stage, { dir, prompt: args.at(-1), task: readFileSync(join(dir, "pipeline", stage, "TASK.md"), "utf8") });
        live.set(name, result?.hc ?? { state: "live", status: "idle" });
        if (result && !result.silent) writeFileSync(join(dir, "pipeline", stage, "result.json"), JSON.stringify(result));
        return { code: 0, stdout: JSON.stringify({ address: name }), stderr: "" };
      }
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify(live.get(args[1]) ?? { state: "finished", exit_code: 0 }), stderr: "" };
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
  for (const s of STAGES) assert.ok(w.calls.some(c => c[0] === "kill" && c[1] === `pl-cat-cafe-${s.id}`), `${s.id} agent ended`);
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
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes("pl-cat-cafe-release")));
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
  assert.equal(w.calls.filter(c => c[0] === "run" && c.includes("pl-cat-cafe-research")).length, 1);
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
  assert.equal(state.stages.store.terminal, "pl-cat-cafe-store");
  assert.ok(w.live.has("pl-cat-cafe-store"));
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
  assert.deepEqual(viaShell(["claude", "hi there"], "darwin"), ["/bin/sh", "-lc", 'exec "$@"', "sh", "claude", "hi there"]);
  assert.deepEqual(viaShell(["claude", "hi"], "win32"), ["claude", "hi"]);
  const w = world({ agent: team });
  w.sys.platform = "darwin";
  await w.run("new", "Cat Cafe", "--mode", "auto");
  await advance(w.sys, "cat-cafe", { until: "research" });
  const launch = w.calls.find(c => c[0] === "run");
  assert.deepEqual(launch.slice(launch.indexOf("--") + 1, launch.indexOf("--") + 6), ["/bin/sh", "-lc", 'exec "$@"', "sh", "fake-agent"]);
});

test("each stage goes to its model: grok researches, codex draws, claude does the rest", async () => {
  const w = world({ agent: team });
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects") }));   // no single custom agent
  await w.run("new", "Cat Cafe", "--mode", "auto");
  const state = await advance(w.sys, "cat-cafe");
  assert.deepEqual(Object.fromEntries(STAGES.map(s => [s.id, state.stages[s.id].agent])), CAST);
  const launch = stage => { const c = w.calls.find(c => c[0] === "run" && c.includes(`pl-cat-cafe-${stage}`)); return c.slice(c.indexOf("--") + 1); };
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
  writeFileSync(join(w.sys.home, "settings.json"), JSON.stringify({ root: join(w.root, "projects") }));
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
  const designRuns = w.calls.filter(c => c[0] === "run" && c.includes("pl-cat-cafe-design")).map(c => c[c.indexOf("--") + 1]);
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
