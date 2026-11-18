import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STAGES, advance, autoPick, main, normalize, parseArgs, readFeed, readKey, render, slug, viaShell } from "../pipeline/nv-pipeline.mjs";

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
    home, here, self: "t-runner", now: () => clock, sleep: async ms => { clock += ms; },
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
