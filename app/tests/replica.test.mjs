import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STAGES, advance, main, parseArgs, readFeed, shortTag, terminalName } from "../pipeline/nv-pipeline.mjs";
import { FEATURE_COLUMNS, PLAN, REVIEW_COLUMNS, SKILLS, audit, changedSince, doctor, findPython, markVerified, openBugs, preflight, readCsv, settleDesign, taskSection } from "../pipeline/nv-replica.mjs";

const here = fileURLToPath(new URL("../pipeline", import.meta.url)), pack = join(here, "replica");
const PY = findPython();
const needsPython = { skip: PY ? false : "Python 3.8+ is not installed" };
const who = name => { const [stage, member = ""] = String(name).replace(/^pl-[a-z0-9]+-/, "").split("-"); return { stage, member }; };
const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");

/** A machine whose agents are a function, as in pipeline.test.mjs, with real Python for the pack's tools. */
function world({ agent, python = PY, settings = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nv-replica-")), home = join(root, "home"), calls = [], live = new Map(), tools = [];
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(join(home, "settings.json"), JSON.stringify({ root: join(root, "projects"), review: false, checks: false, ...settings }));
  writeFileSync(join(home, "secrets", "play-key.json"), JSON.stringify({ type: "service_account", client_email: "ci@play.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", project_id: "p" }));
  let clock = 0;
  const w = { root, home, calls, live, tools, python, dir: join(root, "projects", "booker") };
  w.sys = {
    home, here, self: "t-runner", platform: "win32", has: () => true, now: () => clock, sleep: async ms => { clock += ms; },
    python: () => w.python,
    py(args, cwd) {
      tools.push(args.map(a => String(a).replaceAll("\\", "/").replace(/^.*\/replica\/(replica-[a-z]+\/)/, "$1")).join(" "));
      const r = spawnSync(PY[0], [...PY.slice(1), ...args], { cwd, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" } });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    hc(args) {
      calls.push(args);
      if (args[0] === "run") {
        const name = args[args.indexOf("--name") + 1], dir = args[args.indexOf("--cwd") + 1], { stage, member } = who(name);
        const prompt = args.at(-1), taskFile = /Read (\S+) and/.exec(prompt)[1], resultFile = /writing (\S+)\.$/.exec(prompt)[1];
        const result = agent(stage, { dir, member, task: readFileSync(join(dir, taskFile), "utf8"), taskFile, resultFile });
        live.set(name, { state: "live", status: "idle" });
        if (result) writeFileSync(join(dir, resultFile), JSON.stringify(result));
        return { code: 0, stdout: JSON.stringify({ address: name }), stderr: "" };
      }
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify(live.get(args[1]) ?? { state: "finished", exit_code: 0 }), stderr: "" };
      if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ terminals: [...live].map(([name, t]) => ({ address: name, name, ...t })) }), stderr: "" };
      if (args[0] === "kill") live.delete(args[1]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  w.run = (...argv) => main(w.sys, parseArgs(argv));
  w.started = stage => calls.filter(c => c[0] === "run" && who(c[c.indexOf("--name") + 1]).stage === stage).length;
  return w;
}

const FEATURES = (book, extra = "") => `feature,area,priority,original,clone,notes\nBook a slot as a guest,booking,must,yes,${book},\nEmail reminders,notifications,should,yes,${book === "no" ? "no" : "yes"},\nMarketplace of partner apps,integrations,could,yes,skip,their partner network is not ours to rebuild\nText reminders,notifications,should,no,${book === "no" ? "no" : "yes"},from the reviews${extra}\n`;
const REVIEWS = `source,url,date,rating,text\napp-store,https://apps.example/r/1,2026-10-01,1,"The price jumps per seat, and nobody warned us"\nreddit,https://reddit.example/t/2,2026-09-12,,No text reminders so clients forget\ngoogle-play,https://play.example/r/3,2026-08-30,2,Time zones confuse every guest\n`;
const TOKENS = readFileSync(join(pack, "replica-design", "tokens.json"), "utf8");
const LISTING = JSON.stringify({ avoid: ["Calendly"], google_play: { title: "Slotwise: Booking Links", short_description: "Share one link and let clients book a time you are free.", full_description: "Slotwise turns your calendar into a booking link.\n\nFree for one calendar." } });
const three = prefix => ({ options: ["a", "b", "c"].map((id, i) => ({ id, title: `${prefix} ${id.toUpperCase()}`, desc: "…", score: [60, 90, 75][i], ...(id === "b" ? { recommended: true } : {}) })) });

/** A stand-in team that leaves what each stage's skills ask for. `patch(stage, ctx)` may return a result to use instead,
 *  after doing its own writes; `skip` names stages that write nothing of the skills. */
function actors({ patch = () => null, source = "void main() {}\n" } = {}) {
  return (stage, ctx) => {
    const d = ctx.dir, id = ctx.member, shared = !id || id === "w1", pre = id ? `${id}-` : "";
    const done = (more = {}) => ({ status: "done", summary: `${stage} ok`, ...more });
    let result;
    if (stage === "research") {
      if (shared) { put(d, "replica/recon.md", "# Recon\nS01 booking page\n"); put(d, "replica/features.csv", FEATURES("no")); put(d, "replica/reviews.csv", REVIEWS); put(d, "replica/feedback.md", "# Feedback\n"); put(d, "replica/fixes.md", "# Fixes\n"); put(d, "replica/sources.md", "- https://apps.example (2026-11-19): 1\n"); }
      result = done({ ...three("Idea"), replica: { "replica-recon": { status: "done" }, "replica-entrepreneur": { status: "done" } } });
    } else if (stage === "brief") {
      put(d, "replica/architecture.md", "# Architecture\nFlutter, local storage only.\n");
      result = done({ engine: "flutter", package: "kr.toris.booker", title: "Slotwise" });
    } else if (stage === "design") {
      for (const o of ["a", "b", "c"]) put(d, `replica/design/candidates/${pre}${o}/tokens.json`, TOKENS.replace('"#2f5bea"', `"#2f5b${o}${o}"`));
      if (shared) { put(d, "replica/design/components.md", "Button\n"); put(d, "replica/brand.md", "# Brand (draft)\n"); put(d, "replica/brand.json", JSON.stringify({ avoid: ["Calendly"], domains: ["calendly.com"], colors: ["#006bff"] })); }
      result = done(three("Look"));
    } else if (stage === "build") {
      put(d, "lib/main.dart", source); put(d, "replica/build-log.md", "S01 done\n"); put(d, "replica/features.csv", FEATURES("yes"));
      result = done({ replica: { "replica-build": { status: "done" }, "replica-backend": { status: "skipped", reason: "architecture.md has no server side" } } });
    } else if (stage === "test") {
      put(d, "replica/test-plan.md", "| case |\n"); put(d, "replica/bugs.md", "No bug reproduced.\n"); put(d, "replica/parity.md", "## Parity\n");
      result = done();
    } else if (stage === "store") {
      put(d, "replica/fixes.md", "## Angle\nFlat pricing for small teams.\n"); put(d, "replica/brand.md", "# Brand\nName: Slotwise. USPTO: to run.\n");
      put(d, "replica/launch/listing.json", LISTING); put(d, "replica/launch/pricing.md", "Free with ads.\n"); put(d, "replica/launch/launch-plan.md", "Beta list.\n"); put(d, "replica/launch/landing.md", "Hero\n");
      result = done();
    } else if (stage === "internal" || stage === "release") {
      put(d, "replica/deploy.md", `# Deploy\n${stage}\n`);
      result = done({ version_code: 7 });
    } else result = done();
    return patch(stage, ctx, result) ?? result;
  };
}
const start = (w, ...more) => w.run("new", "Booker", "--idea", "booking links", "--ref", "https://calendly.com", "--mode", "auto", "--replica", ...more);
const stateOf = w => JSON.parse(read(w.dir, "pipeline/state.json"));

// ---------------------------------------------------------------- the pack itself

test("the skill pack is the recorded copy of the source: all files, unchanged, with its license", () => {
  const meta = JSON.parse(readFileSync(join(pack, "upstream.json"), "utf8")), list = [];
  const walk = d => { for (const e of readdirSync(join(pack, d), { withFileTypes: true })) { const p = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) { if (e.name !== "__pycache__") walk(p); } else if (!["UPSTREAM.md", "upstream.json"].includes(p) && !p.endsWith(".pyc")) list.push(p); } };
  walk(""); list.sort();
  const hash = createHash("sha256");
  for (const p of list) { hash.update(p); hash.update("\0"); hash.update(readFileSync(join(pack, p))); hash.update("\0"); }
  assert.equal(list.length, meta.files);
  assert.equal(hash.digest("hex"), meta.sha256, "a copied file changed: write it down in UPSTREAM.md and upstream.json");
  assert.deepEqual([meta.url, meta.commit.length, meta.license, meta.modified], ["https://github.com/Jakeschincariol/replica-skill", 40, "MIT", []]);
  assert.match(readFileSync(join(pack, "LICENSE"), "utf8"), /MIT License\s+Copyright \(c\) 2026 Jake Schincariol/);
  assert.ok(readFileSync(join(pack, "UPSTREAM.md"), "utf8").includes(meta.commit));
});

test("the eleven skills keep the pack's ids and order, and every one of them has a place in a stage", () => {
  const order = /^recon -> .*deploy$/m.exec(readFileSync(join(pack, "README.md"), "utf8"))[0].split(" -> ").map(s => `replica-${s}`);
  assert.deepEqual(SKILLS.map(s => s.id), order);
  assert.equal(SKILLS.length, 11);
  for (const s of SKILLS) assert.match(readFileSync(join(pack, s.id, "SKILL.md"), "utf8"), new RegExp(`^name: ${s.id}$`, "m"));
  const used = Object.values(PLAN).flat().map(s => s.skill).filter(Boolean);
  assert.deepEqual([...new Set(used)].sort(), order.slice().sort());
  assert.deepEqual(Object.keys(PLAN), STAGES.map(s => s.id), "every stage of the pipeline is planned, in order");
  // A skill used in two stages says which part each stage does.
  for (const id of ["replica-entrepreneur", "replica-brand", "replica-deploy"]) assert.deepEqual(Object.values(PLAN).flat().filter(s => s.skill === id).map(s => typeof s.part), ["string", "string"]);
  // Every tool a step names, and every file a skill refers to in another skill's folder, is in the pack.
  for (const s of Object.values(PLAN).flat()) if (s.tool) assert.ok(existsSync(join(pack, s.tool[0])), s.tool[0]);
  for (const s of SKILLS) for (const m of readFileSync(join(pack, s.id, "SKILL.md"), "utf8").matchAll(/\.\.\/(replica-[a-z]+\/[\w.-]+)/g)) assert.ok(existsSync(join(pack, m[1])), `${s.id} refers to ${m[1]}`);
  assert.deepEqual([FEATURE_COLUMNS.join(","), REVIEW_COLUMNS.join(",")], ["feature,area,priority,original,clone,notes", "source,url,date,rating,text"]);
  assert.equal(readFileSync(join(pack, "replica-recon", "features.csv"), "utf8").split("\n")[0].trim(), FEATURE_COLUMNS.join(","));
});

test("the pack's own tests pass on this machine's Python", needsPython, () => {
  const r = spawnSync(PY[0], [...PY.slice(1), "-m", "unittest", "discover", "-s", "tests"], { cwd: pack, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, r.stderr.slice(-800));
  assert.match(r.stderr, /Ran \d+ tests/);
});

// ---------------------------------------------------------------- a run without Replica

test("a run made without --replica is the pipeline as it was: no skills in the tasks, no checks, no Python", async () => {
  const tasks = {};
  const w = world({ agent: (stage, ctx) => { tasks[stage] = ctx.task; return stage === "research" || stage === "design" ? { status: "done", summary: "three", ...three("X") } : { status: "done", summary: "ok" }; } });
  const made = await w.run("new", "Booker", "--mode", "auto");
  assert.equal(made.replica, false);
  // A state file from before this feature has no such field at all.
  const saved = stateOf(w); delete saved.replica; writeFileSync(join(w.dir, "pipeline", "state.json"), JSON.stringify(saved));
  const state = await advance(w.sys, "booker");
  assert.equal(state.status, "done");
  for (const s of STAGES) { assert.ok(!/Replica skill|`replica\/|SKILL\.md/.test(tasks[s.id]), `${s.id} task mentions Replica`); assert.equal(state.stages[s.id].replica, undefined); }
  assert.ok(!existsSync(join(w.dir, "replica")) && !existsSync(join(w.dir, "pipeline", "replica-verified.json")));
  assert.equal(w.tools.length, 0);
  assert.equal((await w.run("status", "booker")).apps[0].replica, undefined);
});

// ---------------------------------------------------------------- the whole run with stand-in agents

test("with --replica every stage gets only its own skills, and the conductor checks what they left with the pack's tools", needsPython, async () => {
  const tasks = {};
  const w = world({ agent: actors({ patch: (stage, ctx) => { tasks[stage] = ctx.task; return null; } }) });
  assert.equal((await start(w)).replica, true);
  const state = await advance(w.sys, "booker");
  assert.equal(state.status, "done", JSON.stringify(STAGES.map(s => [s.id, state.stages[s.id].status, state.stages[s.id].error])));
  // Each task names the skills of its stage and no other, where to read them, what to write and when it is done.
  for (const s of STAGES) {
    const mine = PLAN[s.id].map(x => x.skill).filter(Boolean), named = [...new Set([...tasks[s.id].matchAll(/(replica-[a-z]+)[\\/]SKILL\.md/g)].map(m => m[1]))];
    assert.deepEqual(named, [...new Set(mine)], `${s.id} is told to read exactly its own skills`);
    assert.ok(!/\{\{[a-zA-Z_.]+\}\}/.test(tasks[s.id]), `${s.id} task has an unfilled placeholder`);
    for (const m of tasks[s.id].matchAll(/\*\*Read:\*\* `([^`]+)`/g)) assert.ok(existsSync(m[1]), `${m[1]} exists`);
    assert.ok(tasks[s.id].includes("Done when:") && tasks[s.id].includes("The conductor runs the next step") && tasks[s.id].includes(`pipeline/${s.id}/result.json`));
    assert.ok(tasks[s.id].length < 16000, `${s.id} task stays small (${tasks[s.id].length})`);
  }
  assert.ok(tasks.build.includes("Not needed when:") && tasks.brief.includes("do not choose Next.js, Expo, Stripe or Vercel"));
  assert.ok(tasks.research.includes("replica/reviews.csv --out replica/feedback.md") && tasks.internal.includes("do not ask, and do not promote"));
  assert.ok(tasks.assets.includes("replica/design/tokens.json") && !tasks.assets.includes("SKILL.md"));
  // What the conductor found, per skill, is in the state file with the pack's version.
  const steps = id => state.stages[id].replica.steps.map(x => [x.skill, x.part, x.status]);
  assert.deepEqual(steps("research"), [["replica-recon", null, "done"], ["replica-entrepreneur", "early", "done"]]);
  assert.deepEqual(steps("build"), [["replica-build", null, "done"], ["replica-backend", null, "skipped"]]);
  assert.equal(state.stages.build.replica.steps[1].reason, "architecture.md has no server side");
  assert.deepEqual(steps("store").map(x => x[2]), ["done", "done", "done"]);
  assert.equal(state.stages.research.replica.steps[1].sample, 3, "the number of reviews really collected");
  assert.equal(state.stages.test.replica.version, JSON.parse(readFileSync(join(pack, "upstream.json"), "utf8")).commit);
  assert.match(state.stages.test.replica.steps[1].checks[0].detail, /parity 100\.0, must-haves 1 of 1/);
  // The chosen design's tokens became the project's, the tested source was recorded, and the uploaded version is the released one.
  assert.equal(read(w.dir, "replica/design/tokens.json"), read(w.dir, "replica/design/candidates/b/tokens.json"));
  assert.ok(existsSync(join(w.dir, "pipeline", "replica-verified.json")));
  assert.deepEqual(state.replicaRelease, { versionCode: 7, package: "kr.toris.booker" });
  // The pack's real tools ran: contrast on each candidate, parity, sweep (store and again before the upload), listing.
  for (const t of ["replica-design/contrast.py replica/design/candidates/a/tokens.json", "replica-diff/parity.py replica/features.csv --json", "replica-brand/sweep.py . --config replica/brand.json --json", "replica-launch/listing.py replica/launch/listing.json"]) assert.ok(w.tools.includes(t), t);
  assert.equal(w.tools.filter(t => t.startsWith("replica-brand/sweep.py")).length, 2);
  for (const s of STAGES) assert.equal(w.started(s.id), 1, `${s.id} ran once`);
  // The board gets every step with its files.
  const shown = (await w.run("status", "booker")).apps[0].replica;
  assert.deepEqual(shown.store[2].files.map(f => [f.path, f.exists])[0], ["replica/launch/listing.json", true]);
  assert.deepEqual([shown.build[1].status, shown.build[1].optional, shown.design[0].skill], ["skipped", true, "replica-design"]);
});

test("a reviewer of a Replica stage is told which of the skills' files to check, not to redo them", needsPython, async () => {
  const tasks = [];
  const w = world({ agent: (stage, ctx) => { if (ctx.taskFile.includes("review")) { tasks.push(ctx.task); return { status: "done", summary: "fine", verdict: "pass" }; } return actors()(stage, ctx); }, settings: { review: { research: "claude" } } });
  await start(w);
  await advance(w.sys, "booker", { until: "research" });
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].includes("## Replica files of this stage") && tasks[0].includes("`replica/reviews.csv`") && !tasks[0].includes("SKILL.md"));
});

// ---------------------------------------------------------------- missing tools and missing files

test("without Python or without the pack a Replica run waits and says for what, and no agent is started", needsPython, async () => {
  const w = world({ agent: actors(), python: null });
  await start(w);
  let state = await advance(w.sys, "booker");
  assert.deepEqual([state.status, state.gate], ["waiting", { kind: "blocked", stage: "research" }]);
  assert.match(state.stages.research.error, /^Replica: Python 3\.8 or newer was not found/);
  assert.equal(w.calls.filter(c => c[0] === "run").length, 0);
  assert.deepEqual((await w.run("replica")).missing.length, 1);
  // Once it is there, running again goes on.
  w.python = PY;
  state = await advance(w.sys, "booker", { until: "research" });
  assert.equal(state.stages.research.status, "done");
  // A machine where the pack was never installed.
  const none = world({ agent: actors() });
  none.sys.here = join(none.root, "nowhere");
  await start(none);
  assert.match((await advance(none.sys, "booker")).stages.research.error, /Replica skill pack is not installed/);
});

test("a file a skill had to leave is asked for again, and a stage that still lacks it fails with the reason: it is never passed", needsPython, async () => {
  let tries = 0;
  const fixes = [];
  const w = world({ settings: { rounds: 2, retries: 0 }, agent: actors({ patch: (stage, ctx, result) => {
    if (stage !== "research") return null;
    fixes.push(existsSync(join(ctx.dir, "pipeline/research/fixes.md")) ? read(ctx.dir, "pipeline/research/fixes.md") : null);
    if (tries++ === 0) { put(ctx.dir, "replica/reviews.csv", "source,url,rating,text\nreddit,,3,no link here\n"); return { ...result, replica: { "replica-recon": { status: "skipped", reason: "looked obvious" } } }; }
    put(ctx.dir, "replica/reviews.csv", "source,url,date,rating,text\nreddit,,,3,no link here\n");
    return null;
  } }) });
  await start(w);
  const state = await advance(w.sys, "booker");
  assert.equal(tries, 2);
  assert.equal(fixes[0], null);
  assert.match(fixes[1], /replica\/reviews\.csv lacks the column\(s\) date/);
  assert.match(fixes[1], /replica-recon cannot be skipped in this stage \(reported reason: looked obvious\)/);
  assert.deepEqual([state.status, state.stages.research.status], ["failed", "failed"]);
  assert.match(state.stages.research.error, /automatic checks still fail after 2 round\(s\).*1 row\(s\) have no link or no text/);
  assert.deepEqual(state.stages.research.replica.steps.map(x => x.status), ["done", "failed"]);
  assert.equal(w.started("brief"), 0);
});

test("reviews that could not be reached are an honest zero, and an invented row without its link is refused", needsPython, () => {
  const w = world({ agent: actors() }), dir = join(w.root, "p");
  const stage = STAGES[0], state = { stages: {} };
  put(dir, "replica/recon.md", "x"); put(dir, "replica/features.csv", FEATURES("no")); put(dir, "replica/fixes.md", "x"); put(dir, "replica/sources.md", "- G2: not reached (login wall)\n");
  put(dir, "replica/reviews.csv", "source,url,date,rating,text\n");
  let a = audit(w.sys, dir, state, stage, { status: "done" });
  assert.deepEqual([a.issues, a.record[1].sample, a.record[1].status], [[], 0, "done"]);
  put(dir, "replica/reviews.csv", `source,url,date,rating,text\nreddit,https://r.example/1,2026-01-01,2,"quoted, with a comma\nand a line break"\n`);
  a = audit(w.sys, dir, state, stage, { status: "done" });
  assert.match(a.issues[0], /replica\/feedback\.md is missing: run reviews\.py/);
  assert.deepEqual(readCsv(join(dir, "replica/reviews.csv")).rows.map(r => r.text), ["quoted, with a comma\nand a line break"]);
  put(dir, "replica/features.csv", "feature,area,priority,original,clone,notes\nA,x,urgent,yes,maybe,\nB,x,could,yes,skip,\n");
  assert.deepEqual(audit(w.sys, dir, state, stage, { status: "done" }).issues.filter(i => i.includes("features.csv")).map(i => i.split(" (")[0]),
    ["replica/features.csv: priority must be one of must|should|could|p0", "replica/features.csv: clone must be one of yes|partial|no|skip", "replica/features.csv: a skipped row needs its reason in notes"]);
});

// ---------------------------------------------------------------- several workers

test("several researchers and designers: one of them writes the shared files, each keeps its own candidates, and the choice settles the tokens", needsPython, async () => {
  const tasks = {}, wrote = {};
  const w = world({ agent: actors({ patch: (stage, ctx) => { tasks[`${stage}-${ctx.member}`] = ctx.task; if (stage === "research") wrote[ctx.member] = existsSync(join(ctx.dir, "replica/features.csv")) ? read(ctx.dir, "replica/features.csv") : null; return null; } }) });
  await start(w, "--cast", "research=claude*2", "--cast", "design=codex*3");
  const state = await advance(w.sys, "booker", { until: "assets" });
  assert.equal(state.stages.assets.status, "done", state.stages.design.error ?? state.stages.assets.error);
  // Only w1 is given the shared files to write; w2 is told to leave them alone and gets no skill to read.
  assert.ok(tasks["research-w1"].includes("replica-recon") && tasks["research-w1"].includes("`replica/features.csv`"));
  assert.ok(tasks["research-w2"].includes("written by worker **w1** only") && !tasks["research-w2"].includes("SKILL.md"));
  assert.equal(read(w.dir, "replica/features.csv"), FEATURES("no"), "written once, by w1");
  // Every designer writes tokens under its own option ids; only w1 writes the brand files.
  assert.ok(tasks["design-w2"].includes("replica/design/candidates/<option id>/tokens.json") && tasks["design-w2"].includes("`w2-a`") && !tasks["design-w2"].includes("replica-brand"));
  assert.ok(tasks["design-w1"].includes("replica-brand") && tasks["design-w3"].includes("`w3-`"));
  for (const id of ["w1-a", "w2-b", "w3-c"]) assert.ok(existsSync(join(w.dir, `replica/design/candidates/${id}/tokens.json`)), id);
  assert.match(state.choice.design, /^w[123]-b$/);
  assert.equal(read(w.dir, "replica/design/tokens.json"), read(w.dir, `replica/design/candidates/${state.choice.design}/tokens.json`));
  assert.equal(state.stages.design.replica.steps[0].checks[0].ok, true);
  // A chosen design without tokens stops the artist's stage with the reason.
  assert.deepEqual(settleDesign(w.dir, { choice: { design: "w9-z" } }), null, "tokens already settled are kept");
  assert.match(settleDesign(join(w.root, "empty"), { choice: { design: "b" } }).error, /candidates\/b\/tokens\.json is missing/);
});

// ---------------------------------------------------------------- the test stage and the developer

test("a must-have that is not done and an open serious bug both go back to the developer, and the tester checks again", needsPython, async () => {
  let builds = 0, tests = 0;
  const fixes = [];
  const w = world({ agent: actors({ patch: (stage, ctx) => {
    if (stage === "build") { fixes.push(existsSync(join(ctx.dir, "pipeline/build/fixes.md")) ? read(ctx.dir, "pipeline/build/fixes.md") : null); if (builds++ === 0) put(ctx.dir, "replica/features.csv", FEATURES("partial")); }
    if (stage === "test" && tests++ === 1) put(ctx.dir, "replica/bugs.md", "### BUG-001: booking twice in one slot\n\n- Severity: S1\n- Flow / case: F01-E1\n\nStatus: open\n\n### BUG-002: label cut off\n\n- Severity: S4\n\nStatus: open\n");
    return null;
  } }) });
  await start(w);
  const state = await advance(w.sys, "booker", { until: "test" });
  assert.deepEqual([builds, tests, state.loops, state.stages.test.status], [3, 3, 2, "done"]);
  assert.match(fixes[1], /must-have not done \(partial\): Book a slot as a guest/);
  assert.match(fixes[2], /open S1 bug: BUG-001: booking twice in one slot/);
  assert.ok(!fixes[2].includes("BUG-002"), "a cosmetic bug does not send the app back");
  assert.deepEqual(openBugs("### BUG-1: a\n- Severity: S2\nStatus: fixed in abc1234\n### BUG-2: b\n- Severity: S2\nStatus: Open\n").map(b => b.title), ["BUG-2: b"]);
});

// ---------------------------------------------------------------- code that changed after the tests

test("code changed after the tests passed is never uploaded: the developer and the tester go again first", needsPython, async () => {
  let stores = 0;
  const fixes = [];
  const w = world({ agent: actors({ patch: (stage, ctx) => {
    if (stage === "build") fixes.push(existsSync(join(ctx.dir, "pipeline/build/fixes.md")) ? read(ctx.dir, "pipeline/build/fixes.md") : null);
    // The marketer renames a string in the app while settling the brand: after the tests.
    if (stage === "store" && stores++ === 0) put(ctx.dir, "lib/strings.dart", "const appName = 'Slotwise';\n");
    return null;
  } }) });
  await start(w);
  const state = await advance(w.sys, "booker");
  assert.equal(state.status, "done");
  assert.deepEqual(["build", "test", "store", "internal", "release"].map(w.started), [2, 2, 1, 1, 1]);
  assert.equal(fixes[0], null);
  assert.match(fixes[1], /1 source file\(s\) changed after the tests passed.*lib\/strings\.dart/);
  const order = w.calls.filter(c => c[0] === "run").map(c => who(c[c.indexOf("--name") + 1]).stage);
  assert.deepEqual(order.slice(-6), ["test", "store", "build", "test", "internal", "release"]);
  const loop = readFeed(w.dir, 200).find(e => e.code === "loop.preflight");
  assert.deepEqual([loop.from, loop.to], ["internal", "build"]);
  assert.deepEqual(changedSince(w.dir), [], "what was uploaded is what the second test passed on");
});

test("the check before the upload: files that are not source do not count, the reference's name does, and the loop is limited", needsPython, async () => {
  const w = world({ agent: actors() }), dir = join(w.root, "p");
  put(dir, "lib/main.dart", "void main() {}\n"); put(dir, "replica/brand.json", JSON.stringify({ avoid: ["Calendly"] }));
  assert.match(preflight(w.sys, dir).back[0], /no record of the tested source/);
  assert.equal(markVerified(dir), 1);
  put(dir, "pipeline/research/references.md", "Calendly does this well.\n"); put(dir, "replica/notes.md", "Calendly\n"); put(dir, "fastlane/metadata/android/en-US/title.txt", "Slotwise\n"); put(dir, "build/app.apk", "bin");
  assert.deepEqual(preflight(w.sys, dir).back, [], "notes, listing files and build output are not the tested source, and the pipeline's notes may name the reference");
  put(dir, "lib/widgets/calendly_button.dart", "class CalendlyButton {}\n");
  const back = preflight(w.sys, dir).back;
  assert.match(back[0], /1 source file\(s\) changed.*lib\/widgets\/calendly_button\.dart/);
  assert.ok(back.some(l => /the reference is still in the project: lib\/widgets\/calendly_button\.dart/.test(l)));
  assert.deepEqual(changedSince(join(w.root, "never")), null);
  // When no loop is left, the upload stage fails and says why instead of uploading.
  const spent = world({ settings: { loops: 0 }, agent: actors({ patch: (stage, ctx) => { if (stage === "store") put(ctx.dir, "lib/late.dart", "x"); return null; } }) });
  await start(spent);
  const state = await advance(spent.sys, "booker");
  assert.deepEqual([state.status, state.stages.internal.status, state.loops, spent.started("internal"), spent.started("build")], ["failed", "failed", 0, 0, 1]);
  assert.match(state.stages.internal.error, /changed after the tests passed/);
});

// ---------------------------------------------------------------- release: modes, versions, resuming

test("the approval mode decides the release as before, and only the version that was uploaded and tested can be promoted", needsPython, async () => {
  const w = world({ agent: actors({ patch: (stage, ctx, result) => stage === "release" ? { ...result, version_code: 8 } : null }), settings: { retries: 0 } });
  await start(w, "--mode", "promote");
  let state = await advance(w.sys, "booker");
  assert.deepEqual([state.status, state.gate, state.stages.internal.status, w.started("release")], ["waiting", { kind: "approve", stage: "release" }, "done", 0]);
  assert.ok(state.stages.internal.replica.steps[0].checks.every(c => c.ok));
  await w.run("approve", "booker");
  state = await advance(w.sys, "booker");
  assert.equal(state.mode, "promote", "a skill never changes the mode");
  // 8 is not what was tested. The publisher is not started a second time: the person looks first.
  assert.deepEqual([state.status, state.gate, w.started("release")], ["waiting", { kind: "blocked", stage: "release" }, 1]);
  assert.match(state.stages.release.error, /version code 8 was promoted, but 7 is the one that was uploaded to internal and tested.*Play Console/);
  assert.equal(state.stages.release.replica.steps[0].status, "failed");
  // Once the record is put right, continuing takes the result that is there: nothing is promoted again.
  put(w.dir, "pipeline/release/result.json", JSON.stringify({ status: "done", summary: "7 on production", version_code: 7 }));
  state = await advance(w.sys, "booker");
  assert.deepEqual([state.status, w.started("release")], ["done", 1]);
  // In review mode a Replica run still stops at each choice.
  const r = world({ agent: actors() });
  await start(r, "--mode", "review");
  assert.deepEqual((await advance(r.sys, "booker")).gate, { kind: "pick", stage: "research" });
});

test("an upload stage that a dead conductor left running is not started again with Replica either, and finished stages are not redone", needsPython, async () => {
  const w = world({ agent: actors() });
  await start(w);
  await advance(w.sys, "booker", { until: "internal" });
  const file = join(w.dir, "pipeline", "state.json"), saved = JSON.parse(readFileSync(file, "utf8"));
  saved.stages.release = { status: "running", tries: 1 };
  writeFileSync(file, JSON.stringify(saved));
  const state = await advance(w.sys, "booker");
  assert.deepEqual(state.gate, { kind: "blocked", stage: "release" });
  assert.match(state.stages.release.error, /Check Play Console/);
  assert.deepEqual([w.started("internal"), w.started("release")], [1, 0], "the upload is not repeated, the promotion is not started");
  assert.ok(!w.calls.some(c => c[0] === "run" && c.includes(terminalName(shortTag("booker"), "release"))));
  assert.equal(state.stages.internal.replica.steps[0].versionCode, 7);
});

// ---------------------------------------------------------------- small parts

test("what a Replica run needs is found or named: the pack, its version, Python", () => {
  const sys = { home: join(tmpdir(), "nv-none"), here, python: () => ["python3"] };
  assert.deepEqual([doctor(sys).missing, doctor(sys).version.short, doctor(sys).bundle], [[], "77c9436", pack]);
  assert.match(doctor({ ...sys, python: () => null }).missing[0], /Python 3\.8 or newer was not found/);
  const answers = { python3: { status: 1 }, python: { status: 0, stdout: "Python 3.7.9" }, py: { status: 0, stdout: "Python 3.12.1" } };
  assert.deepEqual(findPython(bin => answers[bin]), ["py", "-3"], "a Python that is too old is passed over");
  assert.equal(findPython(() => ({ status: 1 })), null);
  assert.equal(taskSection(sys, { id: "nope" }, { member: { id: "", part: "worker" } }), null);
});
