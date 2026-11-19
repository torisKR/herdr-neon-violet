// nv-replica: how the eleven Replica skills are used inside the nine stages of nv-pipeline.
//
// The skills themselves are a pinned, unmodified copy of github.com/Jakeschincariol/replica-skill in
// ./replica (see replica/UPSTREAM.md). This file is the registry that says, per stage, which skill
// applies, which part of it, what it reads and writes, and how the conductor checks it afterwards.
// nv-pipeline.mjs uses it to write each agent's TASK file (only the skills of that stage), to check
// the results itself with the pack's own Python tools, and to notice when code changed after it was
// tested. A run made without --replica never touches any of this.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The eleven skills in the order the pack itself runs them. */
export const SKILLS = [
  { id: "replica-recon", ko: "화면·흐름·기능·데이터 모델 분석" },
  { id: "replica-architect", ko: "기술 스택·데이터 구조·구현 순서 설계" },
  { id: "replica-design", ko: "디자인 토큰·컴포넌트·화면 규칙" },
  { id: "replica-build", ko: "기능 목록에 따른 화면과 동작 구현" },
  { id: "replica-backend", ko: "인증·저장·결제·외부 서비스 연동" },
  { id: "replica-test", ko: "사용자 흐름 테스트와 결함 기록" },
  { id: "replica-diff", ko: "기능 누락·동작 차이 비교" },
  { id: "replica-entrepreneur", ko: "실제 리뷰에서 개선점과 제품 방향" },
  { id: "replica-brand", ko: "이름·색상·문체와 잔여물 검사" },
  { id: "replica-launch", ko: "가격안·스토어 등록 자료" },
  { id: "replica-deploy", ko: "출시 전 점검과 배포" },
];

export const FEATURE_COLUMNS = ["feature", "area", "priority", "original", "clone", "notes"];
export const REVIEW_COLUMNS = ["source", "url", "date", "rating", "text"];

// What each stage does with the skills. `scope` is the part of the skill that belongs to this stage
// (a skill can be split over two stages); `optional` is the only case an agent may report "skipped",
// and only for the reason given; `checks` are run by the conductor, not by the agent.
export const PLAN = {
  research: [
    { skill: "replica-recon", ko: "참고 앱 분석", scope: "Steps 1 to 9 of the skill, for ONE reference app: the first store page or web page the person gave; when they gave none, the existing app closest to the idea you recommend (say in the recon map which one and why). Screenshots of the reference go to `replica/screens/` and are never used in our app.",
      reads: ["the references and the seed idea above"], writes: ["replica/recon.md", "replica/features.csv"], checks: ["file:replica/recon.md", "features"] },
    { skill: "replica-entrepreneur", part: "early", ko: "리뷰 조사(초기)", scope: "Steps 1 to 3, and Step 5 as a draft: collect real reviews of the reference into `replica/reviews.csv` (columns exactly `source,url,date,rating,text`, the text copied as written, every row with its link), rank them with `reviews.py`, and write the three lists and two or three possible angles to `replica/fixes.md`. Use the angles in your three ideas. `reviews.py` only ranks what you collected: it does not collect. In `replica/sources.md` list every source you opened with its URL and today's date, how many reviews you took from it, and every source you could not reach. If you reached none, leave `reviews.csv` with only its header line and say so: never write a review yourself. Step 4 (new rows in the feature matrix) is done in the brief stage.",
      reads: ["replica/recon.md"], writes: ["replica/reviews.csv", "replica/feedback.md", "replica/fixes.md", "replica/sources.md"], tool: ["replica-entrepreneur/reviews.py", "replica/reviews.csv --out replica/feedback.md"], checks: ["reviews", "file:replica/fixes.md", "file:replica/sources.md"] },
  ],
  brief: [
    { skill: "replica-architect", ko: "MVP 범위와 구조", scope: "All steps, with the engine from the table above instead of the skill's web stack: do not choose Next.js, Expo, Stripe or Vercel because the skill lists them. Write `replica/architecture.md` (stack with one line of why, data model, the parts that bite, build order). Fix the first version in `replica/features.csv`: every row gets a priority (`must`, `should`, `could`); rows that are not in the first version get `clone` = `skip` with the reason in `notes`; add the fixes you take from `replica/fixes.md` as rows with `original` = `no`. The brief's scope checklist and the `must` rows say the same thing. Write a schema only when the app keeps data on a server.",
      reads: ["replica/recon.md", "replica/features.csv", "replica/fixes.md"], writes: ["replica/architecture.md", "replica/features.csv"], checks: ["file:replica/architecture.md", "features", "must"] },
  ],
  design: [
    { skill: "replica-design", ko: "디자인 토큰", scope: "Steps 1 to 3. For EACH direction you propose, write its tokens to `replica/design/candidates/<option id>/tokens.json` (the skill's `tokens.json` is the template; keep the role names, include the `pairs` list) and check them with `contrast.py`. `<option id>` is the id the option has in your result file{{prefix}}. The component specs go to `replica/design/components.md`. Step 4 (building the primitives) is the developer's.",
      reads: ["replica/recon.md", "replica/screens/ (to measure, never to reuse)"], writes: ["replica/design/candidates/<option id>/tokens.json", "replica/design/components.md"], tool: ["replica-design/contrast.py", "replica/design/candidates/<option id>/tokens.json"], perWorker: true, checks: ["candidates"] },
    { skill: "replica-brand", part: "early", ko: "브랜드 방향(초기)", scope: "Steps 1, 3 and 5 as a first direction only: five name candidates (none close to the reference's name), a palette from a different colour family than the reference's, three words for the voice. Write them to `replica/brand.md` with every trademark and store check marked `to run`. Write `replica/brand.json` with what must not appear in our app: `avoid` (the reference's name and its company), `domains`, `colors` (its brand colours). The final name, the checks and the sweep are done in the store stage.",
      reads: ["replica/fixes.md", "replica/recon.md"], writes: ["replica/brand.md", "replica/brand.json"], checks: ["file:replica/brand.md", "brand"] },
  ],
  assets: [
    { skill: null, ko: "확정된 토큰·브랜드 연결", scope: "No skill to read. The tokens of the direction that was chosen are now `replica/design/tokens.json`: its colours and `replica/brand.md` are the palette of every asset. Nothing from `replica/screens/` (the reference's screenshots) may be traced, cropped or reused.",
      reads: ["replica/design/tokens.json", "replica/brand.md"], writes: [], checks: ["file:replica/design/tokens.json"] },
  ],
  build: [
    { skill: "replica-build", ko: "기능 구현", scope: "Steps 1 to 4 in the engine of this project, with its own commands for analysis, tests and the debug build (the skill's web examples do not apply). Build the rows of `replica/features.csv` that are `must`, then `should`; set each row's `clone` to `yes` or `partial` (with a note) as you finish it, and never touch a row that is `skip`. Use the tokens, not raw colours. Keep `replica/build-log.md`. Saving screenshots for the layout diff is not required.",
      reads: ["replica/architecture.md", "replica/features.csv", "replica/design/tokens.json", "replica/design/components.md"], writes: ["replica/features.csv", "replica/build-log.md"], checks: ["file:replica/build-log.md", "features"] },
    { skill: "replica-backend", ko: "백엔드", optional: "`replica/architecture.md` has no server side: no sign-in, no data kept on a server, no payments, no outside service", scope: "Only what `replica/architecture.md` asks for. A project that already has Firebase or RevenueCat set up is built on that, not replaced. You never create accounts or type keys: when a key or a console step is missing, finish what you can and report `blocked` with exactly what the person must do. Keep `replica/backend.md` with the skill's checklist.",
      reads: ["replica/architecture.md"], writes: ["replica/backend.md"], checks: ["optional:replica/backend.md"] },
  ],
  test: [
    { skill: "replica-test", ko: "흐름 테스트", scope: "Steps 1, 3 and 4 on the device, with adb as this stage describes (the skill's Playwright part applies only to a web project). The plan in `replica/test-plan.md` covers the flows of the first version, not everything the reference does. Every bug you reproduced goes to `replica/bugs.md` in the skill's `bug-report.md` format, with its `Severity:` and `Status:` lines; with no bug the file says so in one line. Test our app only: never script or load the reference.",
      reads: ["replica/recon.md", "replica/features.csv"], writes: ["replica/test-plan.md", "replica/bugs.md"], checks: ["file:replica/test-plan.md", "bugs"] },
    { skill: "replica-diff", ko: "기능 비교", scope: "Step 1, Step 3 and Step 4. Make `replica/features.csv` say what the build really does (you tested it: correct a `yes` that is not true), then write the report with `parity.py`. Parity is judged against the first version: rows that are `skip` and the things we changed on purpose are not gaps, and the look is meant to differ. The layout diff of Step 2 is only for screens where a same-state screenshot of both exists; otherwise leave it out and say so in the report.",
      reads: ["replica/features.csv", "pipeline/brief/acceptance.md"], writes: ["replica/features.csv", "replica/parity.md"], tool: ["replica-diff/parity.py", "replica/features.csv --markdown > replica/parity.md"], checks: ["parity", "file:replica/parity.md"] },
  ],
  store: [
    { skill: "replica-entrepreneur", part: "final", ko: "포지셔닝 확정", scope: "Step 5 only: choose the one angle, from the evidence already in `replica/feedback.md` and from what was actually built, and write it at the top of `replica/fixes.md` under a heading `## Angle`. Do not collect reviews again and do not add features.",
      reads: ["replica/fixes.md", "replica/feedback.md", "replica/parity.md"], writes: ["replica/fixes.md"], checks: ["file:replica/fixes.md"] },
    { skill: "replica-brand", part: "final", ko: "브랜드 확정과 잔여물 검사", scope: "Steps 1, 2, 4 and 6: the final name (the store title of the brief unless a check rules it out), each check either run today with its date and result or marked `to run` (never `available` for a check nobody ran), the logo brief, and the sweep. Keep `replica/brand.json` complete. The sweep must come back clean; when it finds something in the code, fix it there (what it finds under `pipeline/` are this pipeline's own notes and does not count). Changing code, strings or tokens now sends the app back through build and test before it is released, so change only what the sweep or the name requires.",
      reads: ["replica/brand.md", "replica/brand.json", "replica/fixes.md"], writes: ["replica/brand.md", "replica/brand.json"], tool: ["replica-brand/sweep.py", ". --config replica/brand.json"], checks: ["file:replica/brand.md", "brand", "sweep"] },
    { skill: "replica-launch", ko: "출시 자료", scope: "Steps 2 to 4, and Step 1 as text only (`replica/launch/landing.md`; build a page only when the brief asks for a web page). `replica/launch/listing.json` holds the same Google Play texts you put under `fastlane/metadata/android`, with `avoid` from `replica/brand.json`; leave `app_store` out. Pricing follows what the app really sells: for a free app with ads say that in `pricing.md`. No invented proof, and the reference's name nowhere.",
      reads: ["replica/fixes.md", "replica/brand.md", "replica/brand.json"], writes: ["replica/launch/listing.json", "replica/launch/pricing.md", "replica/launch/launch-plan.md", "replica/launch/landing.md"], tool: ["replica-launch/listing.py", "replica/launch/listing.json"], checks: ["listing", "file:replica/launch/pricing.md", "file:replica/launch/launch-plan.md"] },
  ],
  internal: [
    { skill: "replica-deploy", part: "preflight", ko: "출시 전 점검과 내부 배포", scope: "Step 1 and Step 5, for the Play **internal** track only. Fill the skill's `preflight.md` into `replica/deploy.md` with what you ran in this project's engine (its tests and its release build instead of `npx playwright test` and `npm run build`); the conductor has already run the parity, sweep and listing checks, so copy their results from `replica/parity.md` and say so. Steps 2 to 4 (production services, hosting, domain) apply only to a server or a web page this app really has: write `not applicable` with the reason for each that does not. The skill's rule to ask the user before going live is the pipeline's approval, which is decided outside this stage: do not ask, and do not promote. Add `\"version_code\": <the number you uploaded>` to your result file.",
      reads: ["replica/parity.md", "replica/brand.json", "replica/launch/listing.json", "replica/bugs.md"], writes: ["replica/deploy.md"], checks: ["file:replica/deploy.md", "version"] },
  ],
  release: [
    { skill: "replica-deploy", part: "release", ko: "출시와 결과 확인", scope: "Only the release itself: promote the version code that `replica/deploy.md` says was uploaded and tested, exactly as this stage describes, then add the result (track, rollout, link, what to watch in the first week) to `replica/deploy.md`. The go has been given by the pipeline. Add `\"version_code\": <the number you promoted>` to your result file.",
      reads: ["replica/deploy.md"], writes: ["replica/deploy.md"], checks: ["file:replica/deploy.md", "version"] },
  ],
};

// ---------------------------------------------------------------- the installed pack and Python

/** Where the skill pack is: the installed copy beside the pipeline's home, else the one in this repository. */
export function bundleOf(sys) {
  for (const dir of [join(sys.home, "replica"), join(sys.here, "replica")]) if (existsSync(join(dir, "replica-recon", "SKILL.md"))) return dir;
  return null;
}
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };

/** The pack's source and version as recorded when it was copied in. */
export function versionOf(bundle) {
  const u = bundle ? readJson(join(bundle, "upstream.json"), null) : null;
  return u ? { url: u.url, commit: u.commit, short: String(u.commit).slice(0, 7), date: u.date, license: u.license } : null;
}

/** Finds Python 3.8+ once: python3, python, then the Windows launcher. */
export function findPython(run = (bin, args) => spawnSync(bin, args, { encoding: "utf8", windowsHide: true, timeout: 20000 })) {
  for (const argv of [["python3"], ["python"], ["py", "-3"]]) {
    const r = run(argv[0], [...argv.slice(1), "--version"]);
    const m = /Python (\d+)\.(\d+)/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    if (r.status === 0 && m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 8))) return argv;
  }
  return null;
}

/** What a Replica run needs on this machine, and what is missing. `sys.python` is the argv of Python, or null. */
export function doctor(sys) {
  const bundle = bundleOf(sys), version = versionOf(bundle), python = sys.python?.() ?? null, missing = [];
  if (!bundle) missing.push("the Replica skill pack is not installed (run this pack's installer again; it copies app/pipeline/replica)");
  else {
    const gone = SKILLS.map(s => s.id).filter(id => !existsSync(join(bundle, id, "SKILL.md")));
    if (gone.length) missing.push(`the Replica skill pack in ${bundle} is incomplete: ${gone.join(", ")} missing`);
    if (!version) missing.push(`${join(bundle, "upstream.json")} is missing: the pack's version is unknown`);
  }
  if (!python) missing.push("Python 3.8 or newer was not found (python3, python or py -3): the Replica tools need it");
  return { bundle, version, python: python ? python.join(" ") : null, missing };
}

// ---------------------------------------------------------------- the task section

const tick = text => `\`${text}\``;

/** The section of a TASK file about the skills of this stage, for one member. Null when the stage has none for them. */
export function taskSection(sys, stage, { member, count = 1, review = false }) {
  const steps = PLAN[stage.id] ?? [], info = doctor(sys), bundle = info.bundle ?? "(not installed)", py = info.python ?? "python3";
  if (!steps.length) return null;
  const owner = count > 1 ? "w1" : "", mine = count <= 1 || !/^w[0-9]+$/.test(member.id) || member.id === owner;
  if (review) return `## Replica files of this stage\n\nThis run uses the Replica skill pack. Besides the stage's own work, check what it wrote: ${[...new Set(steps.flatMap(s => s.writes))].map(tick).join(", ") || "(nothing new)"}. Are they complete, do they agree with each other and with the code, and is anything in them invented (a review, a number, a check that was not run)?`;
  const shown = steps.filter(s => mine || s.perWorker);
  const lines = ["## Replica skills for this stage", "",
    `This run uses the Replica skill pack (${info.version ? `commit ${info.version.short}` : "version unknown"}), installed at ${tick(bundle)}. Here is what this stage takes from it. Read each skill file named below before you do its part, and nothing else of the pack.`, ""];
  if (!mine) lines.push(`The shared files under ${tick("replica/")} are written by worker **${owner}** only, so that nobody overwrites them: do not create or edit anything there except what is listed below.`, "");
  shown.forEach((s, i) => {
    const title = s.skill ? `${s.skill}${s.part ? ` (${s.part} part)` : ""}` : "no skill";
    lines.push(`### ${i + 1}. ${title}`);
    if (s.skill) lines.push(`- **Read:** ${tick(join(bundle, s.skill, "SKILL.md"))} (and the templates it names in its own folder)`);
    lines.push(`- **Do only this:** ${s.scope.replace("{{prefix}}", member.id ? ` (with ${tick(`${member.id}-`)} in front, because you are worker ${member.id}: ${tick(`${member.id}-a`)})` : "")}`);
    lines.push(`- **Handed to you:** ${s.reads.map(r => /^[\w./-]+$/.test(r) ? tick(r) : r).join(", ")}`);
    if (s.writes.length) lines.push(`- **Write:** ${s.writes.map(tick).join(", ")}`);
    if (s.tool) lines.push(`- **Run:** ${tick(`${py} "${join(bundle, s.tool[0])}" ${s.tool[1]}`)}`);
    if (s.optional) lines.push(`- **Not needed when:** ${s.optional}. Then do not do it, and report it as skipped with that reason (see below).`);
    lines.push(`- **Done when:** ${s.checks.map(c => DONE[c.split(":")[0]](c.split(":")[1])).join("; ")}. The conductor checks this itself after you finish.`, "");
  });
  lines.push("### How the skill files fit this pipeline", "",
    "- **This file wins.** Where a skill file and this task disagree (the stack, the order, what to ask the person), follow this task.",
    "- **The conductor runs the next step.** Every skill file ends with \"Next: /replica-…\" or tells you to run another skill first: ignore that. Do not start another skill, another stage or another agent. If an input named above is missing, report `failed` and say which.",
    "- **Nobody answers questions.** Where a skill says to ask the user, decide from the brief and the files, or report `blocked` when only a person can do it (an account, a payment, a key).",
    `- **Paths.** The skill files write commands as ${tick("python3 parity.py …")} or ${tick("../replica-design/contrast.py")}: those tools are in ${tick(bundle)}, each in its skill's folder. Run them from the project folder with the full path, as shown above.`,
    `- **Two folders.** ${tick("replica/")} holds the analysis and plans the skills write. ${tick("pipeline/")} holds this pipeline's own tasks, results and reports. Keep the stage's files where the task above says.`,
    "- **Only what you really read.** No invented review, quote, number or check result. What you could not open is listed as not reached.",
    `- **Say what you did** in your result file, beside ${tick("status")} and ${tick("summary")}: ${tick(`"replica":{"<skill id>":{"status":"done"}}`)}, or ${tick(`{"status":"skipped","reason":"<why>"}`)} for a part marked "Not needed when". A part without that mark cannot be skipped.`);
  return lines.join("\n");
}

// What "done" means for each check, in the words of the task file.
const DONE = {
  file: path => `${tick(path)} exists and is not empty`,
  optional: path => `${tick(path)} exists, or the part is reported as skipped with its reason`,
  features: () => `${tick("replica/features.csv")} has the columns ${tick(FEATURE_COLUMNS.join(","))} and only the allowed values (priority must|should|could, original yes|no, clone yes|partial|no|skip, a reason in notes for every skip)`,
  must: () => "at least one row is `must`",
  reviews: () => `${tick("replica/reviews.csv")} has the columns ${tick(REVIEW_COLUMNS.join(","))}, every row has its link and its text, and ${tick("replica/feedback.md")} exists when there is at least one review`,
  candidates: () => "every option of your result has its `tokens.json`, and `contrast.py` passes on each",
  brand: () => `${tick("replica/brand.json")} is valid JSON with a non-empty ${tick("avoid")} list`,
  bugs: () => "no bug in `replica/bugs.md` with Severity S1 or S2 is still open (an open one is sent back to the developer)",
  parity: () => "`parity.py` reports every must-have as done (a missing one is sent back to the developer)",
  sweep: () => "`sweep.py` finds nothing of the reference in the project",
  listing: () => "`listing.py` reports no error",
  version: () => "your result file has `version_code`, and it is the one that was tested and uploaded",
};

// ---------------------------------------------------------------- checks the conductor runs

/** A CSV file as rows of objects, with the header as written. Quoted fields may hold commas and line breaks. */
export function readCsv(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, ""), rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(x => x !== "")) rows.push(row); }
  const header = (rows.shift() ?? []).map(h => h.trim().toLowerCase());
  return { header, rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

const filled = file => { try { return statSync(file).size > 0; } catch { return false; } };

function featuresIssues(dir) {
  const file = join(dir, "replica", "features.csv");
  if (!filled(file)) return { issues: ["replica/features.csv is missing"], rows: [] };
  const { header, rows } = readCsv(file), issues = [];
  const lack = FEATURE_COLUMNS.filter(c => !header.includes(c));
  if (lack.length) return { issues: [`replica/features.csv lacks the column(s) ${lack.join(", ")} (it needs ${FEATURE_COLUMNS.join(",")})`], rows: [] };
  if (!rows.length) issues.push("replica/features.csv has no feature rows");
  const bad = (name, allowed) => rows.filter(r => !allowed.includes(r[name].toLowerCase())).map(r => r.feature || "(no name)");
  for (const [name, allowed] of [["priority", ["must", "should", "could", "p0", "p1", "p2"]], ["original", ["yes", "no"]], ["clone", ["yes", "partial", "no", "skip"]]]) {
    const wrong = bad(name, allowed);
    if (wrong.length) issues.push(`replica/features.csv: ${name} must be one of ${allowed.slice(0, 4).join("|")} (wrong in: ${wrong.slice(0, 4).join("; ")})`);
  }
  const noReason = rows.filter(r => r.clone.toLowerCase() === "skip" && !r.notes).map(r => r.feature);
  if (noReason.length) issues.push(`replica/features.csv: a skipped row needs its reason in notes (missing for: ${noReason.slice(0, 4).join("; ")})`);
  return { issues, rows };
}

/** The bugs of replica/bugs.md that are S1 or S2 and still open. */
export function openBugs(text) {
  return String(text).split(/^### /m).slice(1).map(block => ({
    title: block.split("\n")[0].trim(),
    severity: /^- ?Severity:\s*(S[1-4])/mi.exec(block)?.[1]?.toUpperCase() ?? null,
    status: /^Status:\s*(.+)$/mi.exec(block)?.[1]?.trim().toLowerCase() ?? "open",
  })).filter(b => ["S1", "S2"].includes(b.severity) && b.status.startsWith("open"));
}

/** Runs one of the pack's tools in the project folder. */
function tool(sys, bundle, dir, script, args) {
  const r = sys.py([join(bundle, script), ...args], dir);
  return { code: r.code, out: `${r.stdout ?? ""}`.trim(), err: `${r.stderr ?? ""}`.trim() };
}
const lastLine = text => String(text).trim().split("\n").filter(Boolean).at(-1) ?? "";
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };

// Each check answers { ok, detail, issues: [text], defects?: [text] }. A defect is a problem in the app
// itself, found in the test stage: it goes back to the developer instead of to the same stage again.
const CHECKS = {
  file: ({ dir }, path) => filled(join(dir, path)) ? { ok: true } : { issues: [`${path} is missing or empty`] },
  optional: ({ dir, declared, step }, path) => {
    const said = declared[step.skill];
    if (said?.status === "skipped") return said.reason ? { ok: true, skipped: String(said.reason).slice(0, 300) } : { issues: [`${step.skill} was reported as skipped without a reason`] };
    return filled(join(dir, path)) ? { ok: true } : { issues: [`${path} is missing: do ${step.skill}, or report it as skipped with the reason`] };
  },
  features: ({ dir }) => { const { issues, rows } = featuresIssues(dir); return issues.length ? { issues } : { ok: true, detail: `${rows.length} features` }; },
  must: ({ dir }) => { const { rows } = featuresIssues(dir); return rows.some(r => ["must", "p0"].includes(r.priority.toLowerCase()) && r.clone.toLowerCase() !== "skip") ? { ok: true } : { issues: ["replica/features.csv has no must-have row for the first version"] }; },
  reviews: ({ dir }) => {
    const file = join(dir, "replica", "reviews.csv");
    if (!filled(file)) return { issues: ["replica/reviews.csv is missing (with no review reached it still has its header line)"] };
    const { header, rows } = readCsv(file), lack = REVIEW_COLUMNS.filter(c => !header.includes(c));
    if (lack.length) return { issues: [`replica/reviews.csv lacks the column(s) ${lack.join(", ")} (it needs ${REVIEW_COLUMNS.join(",")})`] };
    const loose = rows.filter(r => !/^https?:\/\//i.test(r.url) || !r.text).length;
    if (loose) return { issues: [`replica/reviews.csv: ${loose} row(s) have no link or no text; every review needs both`] };
    if (rows.length && !filled(join(dir, "replica", "feedback.md"))) return { issues: ["replica/feedback.md is missing: run reviews.py on replica/reviews.csv"] };
    return { ok: true, detail: `${rows.length} reviews from ${new Set(rows.map(r => r.source.toLowerCase())).size} source(s)`, sample: rows.length };
  },
  candidates: ({ sys, bundle, dir, result }) => {
    const ids = (result?.options ?? []).map(o => String(o.id)), issues = [];
    if (!ids.length) return { issues: ["the result has no options to check tokens for"] };
    for (const id of ids) {
      const rel = `replica/design/candidates/${id}/tokens.json`;
      if (!filled(join(dir, rel))) { issues.push(`${rel} is missing (the tokens of option ${id})`); continue; }
      const r = tool(sys, bundle, dir, "replica-design/contrast.py", [rel]);
      if (r.code !== 0) issues.push(`contrast.py fails on ${rel}: ${lastLine(r.out || r.err)}`);
    }
    return issues.length ? { issues } : { ok: true, detail: `${ids.length} token sets pass the contrast check` };
  },
  brand: ({ dir }) => {
    const b = readJson(join(dir, "replica", "brand.json"), null);
    return b && Array.isArray(b.avoid) && b.avoid.some(x => String(x).trim()) ? { ok: true } : { issues: ["replica/brand.json needs a non-empty \"avoid\" list (the reference's name and company)"] };
  },
  bugs: ({ dir }) => {
    if (!filled(join(dir, "replica", "bugs.md"))) return { issues: ["replica/bugs.md is missing (with no bug it says so in one line)"] };
    const open = openBugs(readFileSync(join(dir, "replica", "bugs.md"), "utf8"));
    return open.length ? { defects: open.map(b => `open ${b.severity} bug: ${b.title} (replica/bugs.md)`) } : { ok: true };
  },
  parity: ({ sys, bundle, dir }) => {
    const r = tool(sys, bundle, dir, "replica-diff/parity.py", ["replica/features.csv", "--json"]), data = parsed(r.out);
    if (r.code !== 0 || !data) return { issues: [`parity.py could not score replica/features.csv: ${lastLine(r.err || r.out)}`] };
    const detail = `parity ${Number(data.feature_score).toFixed(1)}, must-haves ${data.must_have_done} of ${data.must_have_total}`;
    if (data.problems?.length) return { issues: data.problems.slice(0, 4).map(p => `replica/features.csv: ${p}`), detail };
    const missing = (data.missing ?? []).filter(m => /^(must|p0)$/i.test(m.priority));
    return missing.length ? { detail, defects: missing.map(m => `must-have not done (${m.clone}): ${m.feature}${m.notes ? ` (${m.notes})` : ""}`) } : { ok: true, detail };
  },
  sweep: ({ sys, bundle, dir }) => { const hits = sweepHits(sys, bundle, dir); return hits.error ? { issues: [hits.error] } : hits.list.length ? { issues: hits.list.slice(0, 8).map(h => `the reference is still in the project: ${h}`) } : { ok: true, detail: "sweep clean" }; },
  listing: ({ sys, bundle, dir }) => {
    if (!filled(join(dir, "replica", "launch", "listing.json"))) return { issues: ["replica/launch/listing.json is missing"] };
    const r = tool(sys, bundle, dir, "replica-launch/listing.py", ["replica/launch/listing.json"]);
    if (r.code === 0) return { ok: true, detail: "listing passes" };
    const errors = r.out.split("\n").filter(l => /^ERROR/.test(l.trim())).slice(0, 6).map(l => `listing.py: ${l.trim()}`);
    return { issues: errors.length ? errors : [`listing.py could not check the listing: ${lastLine(r.err || r.out)}`] };
  },
  version: ({ result, state, stage }) => {
    const code = Number(result?.version_code);
    if (!Number.isInteger(code) || code <= 0) return { issues: ["the result file has no version_code (the version code that was uploaded)"] };
    const tested = state.replicaRelease?.versionCode;
    return stage.id === "release" && tested && tested !== code ? { issues: [`version code ${code} was promoted, but ${tested} is the one that was uploaded to internal and tested`] } : { ok: true, detail: `version code ${code}`, versionCode: code };
  },
};

function sweepHits(sys, bundle, dir) {
  if (!filled(join(dir, "replica", "brand.json"))) return { error: "replica/brand.json is missing, so the sweep cannot run" };
  const r = tool(sys, bundle, dir, "replica-brand/sweep.py", [".", "--config", "replica/brand.json", "--json"]);
  if (r.code === 2) return { error: `sweep.py could not run: ${lastLine(r.err)}` };
  const hits = parsed(r.out);
  if (!Array.isArray(hits)) return { error: `sweep.py gave no readable answer: ${lastLine(r.err || r.out)}` };
  // The pipeline's own notes (the research, the brief's "how ours differs") name the reference on purpose, like replica/ does: they do not ship.
  return { list: hits.map(h => ({ ...h, file: String(h.file).replaceAll("\\", "/") })).filter(h => !h.file.startsWith("pipeline/")).map(h => `${h.file}${h.line ? `:${h.line}` : ""} (${h.kind}: ${h.match})`) };
}

/** Checks everything the stage's skills had to produce. `result` is the stage's result file (of the worker
 *  who writes the shared files). Returns the issues for the fix round, the defects for the developer, and
 *  one record per skill for the state file and the board. */
export function audit(sys, dir, state, stage, result) {
  const steps = PLAN[stage.id] ?? [], info = doctor(sys), declared = result?.replica && typeof result.replica === "object" ? result.replica : {};
  const issues = [], defects = [], record = [];
  for (const step of steps) {
    const out = { skill: step.skill, part: step.part ?? null, status: "done", checks: [] };
    const said = step.skill ? declared[step.skill] : null;
    if (said?.status === "skipped" && !step.optional) issues.push(`${step.skill} cannot be skipped in this stage (reported reason: ${String(said.reason ?? "none").slice(0, 200)})`);
    for (const spec of step.checks) {
      const [name, arg] = spec.split(":");
      let r;
      try { r = info.missing.length ? { issues: [`not checked: ${info.missing[0]}`] } : CHECKS[name]({ sys, bundle: info.bundle, dir, state, stage, step, result, declared }, arg); }
      catch (error) { r = { issues: [`${arg ?? name} could not be checked: ${String(error?.message ?? error).slice(0, 200)}`] }; }
      out.checks.push({ name: spec, ok: Boolean(r.ok), detail: r.detail ?? (r.issues ?? r.defects ?? [])[0] ?? null });
      if (r.skipped) { out.status = "skipped"; out.reason = r.skipped; }
      if (r.sample !== undefined) out.sample = r.sample;
      if (r.versionCode) out.versionCode = r.versionCode;
      issues.push(...(r.issues ?? []));
      defects.push(...(r.defects ?? []));
    }
    if (out.checks.some(c => !c.ok) || (said?.status === "skipped" && !step.optional)) out.status = "failed";
    record.push(out);
  }
  return { issues, defects, record, version: info.version?.commit ?? null };
}

// ---------------------------------------------------------------- settling a choice, and code that changed after the tests

/** The tokens of the design that was chosen become the project's tokens, once. Returns what it did. */
export function settleDesign(dir, state) {
  const chosen = state.choice?.design, to = join(dir, "replica", "design", "tokens.json");
  if (!chosen) return null;
  const from = join(dir, "replica", "design", "candidates", chosen, "tokens.json");
  if (!existsSync(from)) return existsSync(to) ? null : { error: `replica/design/candidates/${chosen}/tokens.json is missing: the chosen design has no tokens` };
  if (existsSync(to) && readFileSync(to, "utf8") === readFileSync(from, "utf8")) return null;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return { copied: `replica/design/candidates/${chosen}/tokens.json` };
}

const OUTSIDE = /^(pipeline|replica|fastlane)\//, BUILT = new Set([".git", "node_modules", "build", ".dart_tool", ".gradle", ".idea", ".godot", "Library", "Temp", "Logs", "obj", "Pods", ".venv", "__pycache__"]);

/** The project's source files with a hash each: what the tests were run against. Planning folders,
 *  listing files and build output are left out. With git, ignored files are left out too. */
export function sourceFiles(dir) {
  let names = null;
  if (existsSync(join(dir, ".git"))) {
    const r = spawnSync("git", ["-C", dir, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 64 << 20 });
    if (r.status === 0) names = r.stdout.split("\0").filter(Boolean);
  }
  if (!names) {
    names = [];
    const walk = rel => {
      for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const path = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!BUILT.has(e.name)) walk(path); } else if (e.isFile()) names.push(path);
      }
    };
    walk("");
  }
  const files = {};
  for (const name of names.map(n => n.replaceAll("\\", "/")).filter(n => !OUTSIDE.test(n)).sort()) {
    try { const s = statSync(join(dir, name)); if (s.isFile()) files[name] = s.size > 8 << 20 ? `size:${s.size}` : createHash("sha1").update(readFileSync(join(dir, name))).digest("hex"); } catch { /* gone meanwhile */ }
  }
  return files;
}
const verifiedFile = dir => join(dir, "pipeline", "replica-verified.json");

/** Remembers the source exactly as the tests passed on it. */
export function markVerified(dir, at = new Date().toISOString()) {
  const files = sourceFiles(dir);
  mkdirSync(dirname(verifiedFile(dir)), { recursive: true });
  writeFileSync(verifiedFile(dir), JSON.stringify({ at, files }));
  return Object.keys(files).length;
}

/** The source files that are not what was tested: changed, added or removed since. Null when nothing was recorded. */
export function changedSince(dir) {
  const then = readJson(verifiedFile(dir), null)?.files;
  if (!then) return null;
  const now = sourceFiles(dir);
  return [...new Set([...Object.keys(then), ...Object.keys(now)])].filter(f => then[f] !== now[f]).sort();
}

/** Before anything is uploaded: is the code still what was tested, and is nothing of the reference left in it?
 *  Returns the lines to send back to the developer; empty when the app may be released. */
export function preflight(sys, dir) {
  const info = doctor(sys), back = [];
  if (info.missing.length) return { blocked: info.missing[0], back };
  const changed = changedSince(dir);
  if (changed === null) back.push("there is no record of the tested source (pipeline/replica-verified.json): the tests have to pass again on the code as it is");
  else if (changed.length) back.push(`${changed.length} source file(s) changed after the tests passed, so that result is not about this code: ${changed.slice(0, 12).join(", ")}${changed.length > 12 ? " …" : ""}. Check that the app still builds and does everything in the first-version scope, and repair what the change broke.`);
  const hits = sweepHits(sys, info.bundle, dir);
  if (hits.error) back.push(hits.error);
  else back.push(...hits.list.slice(0, 8).map(h => `the reference is still in the project: ${h}`));
  return { back };
}

/** For the board: every skill step of every stage with its files and, once the stage ran, what was found. */
export function overview(dir, state) {
  return Object.fromEntries(Object.entries(PLAN).map(([stageId, steps]) => {
    const rec = state.stages?.[stageId] ?? {}, done = rec.replica?.steps ?? [];
    return [stageId, steps.map((s, i) => ({ skill: s.skill, part: s.part ?? null, ko: s.ko, optional: Boolean(s.optional),
      status: done[i]?.status ?? (rec.status === "running" ? "running" : rec.status === "done" ? "unchecked" : "planned"),
      reason: done[i]?.reason ?? null, checks: done[i]?.checks ?? [], sample: done[i]?.sample ?? null,
      files: s.writes.filter(w => !w.includes("<")).map(w => ({ path: w, exists: filled(join(dir, w)) })) }))];
  }));
}
