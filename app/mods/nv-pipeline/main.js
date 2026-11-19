// App pipeline board: a team of agents takes an idea to the Play Store, and you watch them work.
//   - the team canvas: one card per teammate (Researcher → … → Publisher), linked by hand-offs;
//     the one working pulses, the one that needs you glows
//   - the team chat: what they tell each other (pipeline/feed.jsonl), and you can say something
//   - the choice panel: pick an idea or a design from cards with pictures, approve production,
//     drop the Play service account key, switch between unattended / ask before production / ask always
// bin/nv-pipeline.mjs is the conductor (no tokens); this mod only shows its state and sends commands.
// Open it as a tab: tab.new { mod: "nv-pipeline" } (Ctrl+Shift+Y).
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, checking, exec, knownAgents, pickFolder, props, run, settings, shared, setShared, terminals, theme, window } from "herdr";

const POLL_MS = 2000;
// What a desk can be doing, in the order the summary line counts them. "quiet" and "stalled" are a
// stage the state file calls running whose agents are not: reported idle, or left without a conductor.
const STATES = ["working", "quiet", "stalled", "needs", "pending", "done", "failed"];
// The person's login shell (as in bin/nv-pipeline.mjs): $SHELL when POSIX-style, else zsh on macOS, bash, sh.
const LOGIN = 's="${SHELL:-}"; case "$s" in */zsh|*/bash|*/sh|*/dash|*/ksh) [ -x "$s" ] || s= ;; *) s= ;; esac; ' +
  'if [ -z "$s" ]; then if [ "$(uname)" = Darwin ] && [ -x /bin/zsh ]; then s=/bin/zsh; elif [ -x /bin/bash ]; then s=/bin/bash; else s=/bin/sh; fi; fi; ' +
  'exec "$s" -lc \'exec "$@"\' sh "$@"';
const TOP_H = 40, CANVAS_H = 200, NOTE_H = 26, SUMMARY_H = 26;
const TEXT = {
  en: { title: "App pipeline", add: "+ New app", key: "Play key", keyMissing: "Play key needed", chat: "Team chat", say: "Tell the team something…", send: "Send",
    name: "App name (optional: taken from the folder)", idea: "What should it be? Describe the service, or name a reference (empty: find what is trending)",
    refs: "References: Play Store links, repositories (space-separated). Drop screenshots here too.", refsHelp: "References are studied, never copied: ours gets its own name, art and text.",
    dir: "Project folder (empty: a new folder under {root})", browse: "Choose folder…", needIdea: "Say what to build, or give it a name.", auto: "Auto app: from plan to store", kind: { auto: "Decide for me", app: "App", game: "Game" },
    mode: { auto: "Unattended", promote: "Ask before production", review: "Ask at every choice" },
    replica: { use: "Use the Replica skills", on: "Replica", help: "Eleven skills inside the stages: the reference app is analysed, real reviews are read, features are tracked in a matrix, and the conductor checks parity, leftovers of the reference and the listing before anything is uploaded. Needs Python 3.8+.", missing: "The Replica skill pack is not installed on that machine: run this pack's installer there.",
      title: "Replica skills in this stage", none: "uses the files the skills left", files: "Files", sample: "{n} reviews collected",
      status: { planned: "planned", running: "in progress", done: "done", skipped: "not needed", failed: "failed", unchecked: "not checked" } },
    modeHelp: { auto: "Nobody is asked, production included.", promote: "Choices are automatic; production waits for you.", review: "You pick the idea and the design, and approve production." },
    start: "Start", startNoKey: "Start without the key (asked again before upload)", cancel: "Cancel", empty: "No app yet. Start one and watch the team work.",
    drop: "Drop the Play service account key (.json) here", dropHelp: "Google Cloud > IAM > Service accounts > Keys. Invite its email in Play Console > Users and permissions.", keyOk: "Key saved for",
    pick: "Choose one", choose: "Click to choose", chosen: "Chosen", recommended: "Recommended", approve: "Promote to production", approveHelp: "The tested build goes to production (20% rollout).",
    blocked: "This teammate is stuck and needs you.", watch: "Watch the agent", retry: "Run again", stop: "Stop", resume: "Continue", remove: "Remove from the board",
    status: { pending: "waiting", running: "working", done: "done", failed: "failed", waiting: "needs you", blocked: "needs you" },
    state: { working: "Working", quiet: "Not responding", stalled: "Stalled", needs: "Needs you", pending: "Waiting", done: "Done", failed: "Failed" },
    stalled: "This run stopped on its own: nothing is conducting it. Press Continue to pick it up where it was.",
    quiet: "The agent reports that it is not working and has written no result. The conductor is reminding it; open its screen to see why.",
    gone: "That agent's terminal has ended.", peek: "Show", keep: "Open as tab", conductor: "Conductor log",
    part: { worker: "Worker", lead: "Lead", review: "Reviewer" }, round: "round",
    team: "Team: who does each stage", teamHelp: "Agents installed on this computer. Click a model to switch, ×n for several working at once, and a reviewer to have another model check the work.",
    teamLoading: "Checking installed agents and their models…", model: "model", unset: "default", review: "review", none: "none",
    modelInput: "Type a model name for the selected role and press Enter (empty: the CLI's default)",
    you: "You", shipped: "Store", needsYou: "needs you", score: "score",
    feed: { start: "Starting.", "start.again": "Trying again.", "review.start": "The reviewer is checking the work.", "review.pass": "The review passed.", "review.skip": "The reviewer did not finish; going on without a review.",
      round: "Round {arg}: fixing what was found.", "loop.build": "{arg} defect(s) back to the developer, then I test again.", "ask.pick": "Please choose one.", "ask.approve": "Ready for production. Approve?", "ask.key": "I need the Play service account key.", "ask.blocked": "I am stuck and need you.",
      "pick.auto": "Chose \"{arg}\" (unattended).", "pick.person": "Go with \"{arg}\".", approve: "Approved. Ship it.", done: "Shipped. The pipeline is finished." } },
  ko: { title: "앱 파이프라인", add: "+ 새 앱", key: "Play 키", keyMissing: "Play 키 필요", chat: "팀 대화", say: "팀에게 한마디…", send: "보내기",
    name: "앱 이름 (선택: 비우면 폴더 이름)", idea: "어떤 서비스를 만들까요? 설명이나 레퍼런스를 적어 주세요 (비우면 유행하는 것에서 찾음)",
    refs: "레퍼런스: 플레이스토어 링크, 저장소 (띄어쓰기로 구분). 스크린샷은 여기에 끌어다 놓으세요.", refsHelp: "레퍼런스는 참고만 하고 베끼지 않습니다. 이름·그림·문구는 새로 만듭니다.",
    dir: "프로젝트 폴더 (비우면 {root} 아래 새 폴더)", browse: "폴더 선택…", needIdea: "무엇을 만들지 적거나 이름을 정해 주세요.", auto: "Auto app: 기획부터 스토어까지", kind: { auto: "알아서", app: "앱", game: "게임" },
    mode: { auto: "무인", promote: "승격만 확인", review: "모두 확인" },
    replica: { use: "Replica 스킬 사용", on: "Replica", help: "단계 안에서 11개 스킬을 씁니다. 참고 앱을 분석하고, 실제 리뷰를 읽고, 기능을 표로 추적하며, 업로드 전에 지휘자가 기능 충족·참고 앱 잔여물·스토어 문구를 직접 검사합니다. Python 3.8 이상이 필요합니다.", missing: "그 머신에 Replica 스킬 묶음이 설치돼 있지 않습니다. 거기서 이 팩의 설치 스크립트를 실행하세요.",
      title: "이 단계의 Replica 스킬", none: "스킬이 남긴 파일을 사용", files: "산출물", sample: "리뷰 {n}건 수집",
      status: { planned: "예정", running: "진행 중", done: "완료", skipped: "해당 없음", failed: "실패", unchecked: "검사 전" } },
    modeHelp: { auto: "프로덕션까지 아무것도 묻지 않습니다.", promote: "선택은 자동이고, 프로덕션 승격만 기다립니다.", review: "기획과 디자인을 직접 고르고 승격도 승인합니다." },
    start: "시작", startNoKey: "키 없이 시작 (업로드 전에 다시 요청)", cancel: "취소", empty: "아직 앱이 없습니다. 하나 시작하고 팀이 일하는 걸 지켜보세요.",
    drop: "Play 서비스 계정 키(.json)를 여기에 끌어다 놓으세요", dropHelp: "Google Cloud > IAM > 서비스 계정 > 키. 그 이메일을 Play Console > 사용자 및 권한에 초대하세요.", keyOk: "키 저장됨:",
    pick: "하나를 골라 주세요", choose: "눌러서 선택", chosen: "선택됨", recommended: "추천", approve: "프로덕션으로 승격", approveHelp: "테스트한 빌드가 프로덕션으로 갑니다(20% 단계 출시).",
    blocked: "이 팀원이 막혀서 도움이 필요합니다.", watch: "에이전트 화면 보기", retry: "다시 실행", stop: "중단", resume: "계속", remove: "보드에서 빼기",
    status: { pending: "대기", running: "작업 중", done: "완료", failed: "실패", waiting: "확인 필요", blocked: "확인 필요" },
    state: { working: "작업 중", quiet: "응답 없음", stalled: "멈춤", needs: "확인 필요", pending: "대기", done: "완료", failed: "실패" },
    stalled: "이 실행은 혼자 멈췄습니다. 진행시키는 지휘자가 없습니다. 「계속」을 누르면 멈춘 곳에서 이어집니다.",
    quiet: "에이전트가 일하지 않는다고 보고했고 결과도 쓰지 않았습니다. 지휘자가 재촉하는 중이니, 화면을 열어 이유를 확인하세요.",
    gone: "그 에이전트의 터미널은 이미 끝났습니다.", peek: "화면 보기", keep: "탭으로 열기", conductor: "지휘자 로그",
    part: { worker: "작업자", lead: "리드", review: "검토자" }, round: "라운드",
    team: "팀 구성: 단계마다 누가 할지", teamHelp: "이 컴퓨터에 설치된 에이전트입니다. 모델을 누르면 바뀌고, ×n 은 동시에 일하는 인원, 검토는 다른 모델이 결과를 확인하게 합니다.",
    teamLoading: "설치된 에이전트와 모델을 확인하는 중…", model: "모델", unset: "기본", review: "검토", none: "없음",
    modelInput: "선택한 역할의 모델 이름을 직접 입력하고 Enter (비우면 CLI 기본값)",
    you: "나", shipped: "스토어", needsYou: "확인 필요", score: "점수",
    feed: { start: "시작합니다.", "start.again": "다시 해 봅니다.", "review.start": "검토자가 결과를 확인합니다.", "review.pass": "검토를 통과했습니다.", "review.skip": "검토자가 끝내지 못해 검토 없이 진행합니다.",
      round: "{arg}라운드: 지적된 것을 고칩니다.", "loop.build": "결함 {arg}건을 개발자에게 돌려보내고 다시 테스트합니다.", "ask.pick": "하나를 골라 주세요.", "ask.approve": "프로덕션에 올릴 준비가 됐습니다. 승인할까요?", "ask.key": "Play 서비스 계정 키가 필요합니다.", "ask.blocked": "막혔습니다. 도와주세요.",
      "pick.auto": "\"{arg}\" 로 정했습니다 (무인).", "pick.person": "\"{arg}\" 로 갑시다.", approve: "승인. 출시합시다.", done: "출시했습니다. 파이프라인을 마쳤습니다." } },
};
const language = value => { const k = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0]; return Object.hasOwn(TEXT, k) ? k : null; };
const lang = () => language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en";
const copy = () => TEXT[lang()];
const roleName = stage => (lang() === "ko" ? stage?.ko : stage?.role) ?? "";

// One color per teammate, from the terminal palette so it follows the theme.
const HUE = { research: "ansi4", brief: "ansi5", design: "ansi13", assets: "ansi3", build: "ansi2", test: "ansi6", store: "ansi11", internal: "ansi12", release: "ansi10", person: "accent" };
const initials = role => String(role).split(/\s+/).map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();

// Pixel people, drawn from rows of letters so no image files are needed (and they take theme colors).
// h hair, s skin, e eye, b shirt (the teammate's color), d trousers, . nothing.
const PERSON = [
  "..hhhhhh..",
  ".hhhhhhhh.",
  ".hssssssh.",
  ".hsessesh.",
  ".ssssssss.",
  "..ssssss..",
  ".bbbbbbbb.",
  "sbbbbbbbbs",
  "sbbbbbbbbs",
  ".bbbbbbbb.",
  ".dd....dd.",
];
const ASLEEP = PERSON.map((row, i) => i === 3 ? ".hssssssh." : row);   // eyes closed
const HAIR = ["#3b2a20", "#101018", "#7a4a21", "#c9a227", "#5b3d8a", "#27323f", "#8a2f2f", "#2f5d50", "#444444"];

/** One sprite: each row is a strip of runs, so a figure is a few dozen boxes, not a hundred. */
function sprite(rows, colors, px) {
  return v_flex().flex_none().children(rows.map(row => {
    const runs = [];
    for (const ch of row) { const last = runs.at(-1); if (last && last.ch === ch) last.n++; else runs.push({ ch, n: 1 }); }
    return h_flex().h(px).flex_none().children(runs.map(r => {
      const box = div().w(r.n * px).h(px).flex_none();
      return colors[r.ch] ? box.bg(colors[r.ch]) : box;
    }));
  }));
}

/** A cast as the conductor reads it: claude, claude:opus, codex*2. */
const castSpec = v => `${v.agent}${v.model ? `:${v.model}` : ""}${v.count > 1 ? `*${v.count}` : ""}`;
/** The next value after `current` in a list, wrapping around. */
const after = (list, current) => list[(list.indexOf(current) + 1) % list.length];

/** "3m", "2h": how long ago, short. */
function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

export default class Pipeline extends View {
  init(_props, cx) {
    this.data = { key: { present: false }, stages: [], apps: [] };
    this.selected = shared("nv.pipeline.app") ?? null;
    this.focus = null;        // the stage whose details show; null follows the pipeline
    this.form = null;         // { kind, mode } while the new-app form is open
    this.note = null;         // feedback line
    this.nameInput = InputState.new({ placeholder: copy().name });
    this.ideaInput = InputState.new({ placeholder: copy().idea });
    this.dirInput = InputState.new({ placeholder: copy().dir.replace("{root}", "~/projects") });
    this.refsInput = InputState.new({ placeholder: copy().refs });
    this.refImages = [];   // screenshots dropped on the form
    this.ideaInput.on("submit", (_e, cx) => this.create(cx));
    // Opened from the + menu as "Auto app": the form is the first thing shown.
    if (props()?.create) { this.form = { kind: "auto", mode: "promote" }; if (props().dir) this.dirInput.set_value(String(props().dir)); }
    this.sayInput = InputState.new({ placeholder: copy().say });
    this.sayInput.on("submit", (_e, cx) => this.say(cx));
    this.catalog = null;      // nv-pipeline agents: the CLIs of this machine, their models, the default team
    this.team = {};           // the form's changes to the default team: { [stage]: { agent, model, count, review } }
    this.teamStage = null;    // the role a typed model name goes to
    this.modelInput = InputState.new({ placeholder: copy().modelInput });
    this.modelInput.on("submit", (_e, cx) => {
      if (!this.teamStage) return;
      this.setTeam(this.teamStage, { model: this.modelInput.value().trim() || null });
      this.modelInput.set_value("");
      cx.notify();
    });
    if (checking()) return;
    cx.timer.every(POLL_MS, cx => this.load(cx));
    this.load(cx);
    this.loadCatalog(cx);
  }

  /** The agents that can be cast. CLIs the + menu knows but the pipeline does not are added first. */
  loadCatalog(cx) {
    cx.spawn(async cx => {
      try {
        let r = await this.nv(["agents"]);
        if (r.code !== 0) { this.note = this.errorOf(r); cx.notify(); return; }
        let catalog = JSON.parse(r.stdout);
        const known = typeof knownAgents === "function" ? await knownAgents({ on: null }).catch(() => []) : [];
        const bins = new Set(catalog.agents.flatMap(a => [a.name, a.bin]));
        let added = false;
        for (const a of known) {
          const bin = String(a.run?.[0] ?? "").split(/[\\/]/).at(-1).replace(/\.(exe|cmd)$/i, "");
          const name = String(a.key ?? bin).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
          if (!a.installed || !bin || !name || bins.has(bin) || bins.has(name) || a.key === "herdr-web-browser") continue;
          const made = await this.nv(["agents", "add", name, ...a.run]);
          if (made.code === 0) { added = true; bins.add(bin); bins.add(name); }
        }
        if (added) { r = await this.nv(["agents"]); if (r.code === 0) catalog = JSON.parse(r.stdout); }
        this.catalog = catalog;
      } catch (error) { this.note = String(error.message ?? error); }
      cx.notify();
    });
  }

  /** A stage's cast as the form shows it: the default, with what the person changed. */
  teamOf(stageId) {
    const base = this.catalog?.team?.[stageId] ?? {};
    return { agent: base.agent ?? "", model: null, count: 1, review: base.review ?? "none", split: Boolean(base.split), ...(this.team[stageId] ?? {}) };
  }
  setTeam(stageId, patch) { this.team = { ...this.team, [stageId]: { ...(this.team[stageId] ?? {}), ...patch } }; this.teamStage = stageId; }

  /** The form's team as --cast / --review flags, only for what differs from the default. */
  castFlags() {
    const flags = [];
    for (const id of Object.keys(this.team)) {
      const base = this.catalog?.team?.[id] ?? {}, v = this.teamOf(id);
      if (v.agent !== base.agent || v.model || v.count > 1) flags.push("--cast", `${id}=${castSpec(v)}`);
      if (v.review !== (base.review ?? "none")) flags.push("--review", `${id}=${v.review}`);
    }
    return flags;
  }

  tool() { return `${appHome()}/bin/nv-pipeline.mjs`; }
  nv(args) { return exec("node", [this.tool(), ...args, "--json"], { timeout: 30000 }); }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const r = await this.nv(["status"]);
        if (r.code === 0) this.data = JSON.parse(r.stdout);
        else this.note = this.errorOf(r);
      } catch (error) { this.note = String(error.message ?? error); }
      this.loading = false;
      cx.notify();
    });
  }

  app() { return this.data.apps.find(a => a.id === this.selected && a.state) ?? this.data.apps.find(a => a.state) ?? null; }

  errorOf(r) {
    try { return JSON.parse(r.stderr).error; } catch { return (r.stderr || r.stdout).trim(); }
  }

  /** Runs a conductor command, then (when asked) lets the pipeline move on in its own terminal. */
  command(cx, args, { resume = false } = {}) {
    cx.spawn(async cx => {
      try {
        const r = await this.nv(args);
        if (r.code !== 0) { this.note = this.errorOf(r); cx.notify(); return; }
        this.note = null;
        if (resume) await this.resume(args[1]);
      } catch (error) { this.note = String(error.message ?? error); }
      this.load(cx);
    });
  }

  /** The conductor runs outside the window, in an hc terminal that ends when it has nothing to do. */
  async resume(id, dir = this.data.apps.find(a => a.id === id)?.dir) {
    // hc names are at most 32 characters; the app's saved tag is unique among the apps.
    const tag = this.data.apps.find(a => a.id === id)?.state?.tag ?? id.slice(0, 20);
    const name = `pipe-${tag}`;
    await exec("hc", ["kill", name]).catch(() => {});
    await exec("hc", ["rm", name]).catch(() => {});
    const r = await exec("hc", ["run", "--bg", "--json", "--no-notify", "--no-parent", "--rm", "--name", name, ...(dir ? ["--cwd", dir] : []), "--", ...this.viaShell(["node", this.tool(), "run", id])], { timeout: 20000 });
    if (r.code !== 0) this.note = (r.stderr || r.stdout).trim();
  }

  /** herdr-core on macOS and Linux lacks the person's PATH (node lives in their shell profile). */
  viaShell(argv) { return window().platform === "windows" ? argv : ["/bin/sh", "-c", LOGIN, "sh", ...argv]; }

  create(cx) {
    const dir = this.dirInput.value().trim(), idea = this.ideaInput.value().trim();
    // The name may be left out: the folder's name, else the first words of the request.
    const name = this.nameInput.value().trim() || dir.split(/[\\/]/).filter(Boolean).at(-1) || idea.split(/\s+/).slice(0, 4).join(" ");
    if (!name) { this.note = copy().needIdea; cx.notify(); return; }
    const { kind, mode } = this.form, withReplica = Boolean(this.form.replica);
    cx.spawn(async cx => {
      try {
        const refs = [...this.refsInput.value().split(/[\s,]+/).filter(Boolean), ...this.refImages];
        const r = await this.nv(["new", name, "--idea", idea, "--kind", kind, "--mode", mode, ...(dir ? ["--dir", dir] : []), ...refs.flatMap(x => ["--ref", x]), ...this.castFlags(), ...(withReplica ? ["--replica"] : [])]);
        if (r.code !== 0) { this.note = this.errorOf(r); cx.notify(); return; }
        const made = JSON.parse(r.stdout);
        this.select(made.id);
        this.note = null; this.team = {}; this.teamStage = null;
        this.nameInput.set_value(""); this.ideaInput.set_value(""); this.dirInput.set_value(""); this.refsInput.set_value(""); this.refImages = [];
        const listed = await this.nv(["status", made.id]);
        await this.resume(made.id, listed.code === 0 ? JSON.parse(listed.stdout).apps[0]?.dir : undefined);
      } catch (error) { this.note = String(error.message ?? error); }
      this.load(cx);
    });
  }

  /** Shows an app's board. The new-app form is closed: it hides the board, so a click on a running
   *  app while the form was open used to change nothing on screen. */
  select(id) { this.selected = id; this.focus = null; this.form = null; setShared("nv.pipeline.app", id); }

  /** What a stage is really doing (one of STATES): the state file's word, corrected by what the
   *  conductor saw of its agents' terminals. */
  stateOf(app, stageId) {
    const s = app.state, rec = s.stages?.[stageId] ?? { status: "pending" };
    if (["waiting", "blocked"].includes(rec.status) || s.gate?.stage === stageId) return "needs";
    if (rec.status === "running") return app.activity?.[stageId] ?? "working";
    return STATES.includes(rec.status) ? rec.status : "pending";
  }
  /** The run has no conductor although its state says running: it goes on only when continued. */
  stalled(app) { return app.state.status === "running" && app.conducted === false; }
  stateColor(key, t) { return { working: t.working, quiet: t.ansi3 ?? t.blocked, stalled: t.blocked, needs: t.blocked, failed: t.blocked, done: t.done, pending: t.dim }[key] ?? t.dim; }

  /** The terminals of a stage that are still there, the one of the working member first. */
  liveTerminals(app, rec) {
    const all = [...new Set([rec?.terminal, ...(rec?.members ?? []).map(m => m.terminal)].filter(Boolean))];
    return all.filter(t => !["gone"].includes(app.live?.[t]));
  }

  /** A desk was clicked: its details show, and when an agent is at it, so does the agent's screen. */
  open(app, stageId, cx) {
    this.focus = stageId;
    const rec = app.state.stages?.[stageId] ?? {}, terminal = this.liveTerminals(app, rec)[0];
    if (terminal) { this.note = null; run("terminal.peek", { terminal }); }
    else if (rec.status === "running") this.note = copy().gone;
    cx.notify();
  }

  say(cx) {
    const app = this.app(), text = this.sayInput.value().trim();
    if (!app || !text) return;
    this.sayInput.set_value("");
    this.command(cx, ["say", app.id, text]);
  }

  /** A key file dropped anywhere on the board. */
  dropKey(paths, cx) {
    // Pictures dropped while the form is open are references for the new app.
    const pictures = (paths ?? []).filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p));
    if (this.form && pictures.length) { this.refImages = [...this.refImages, ...pictures].slice(0, 8); cx.notify(); return; }
    const file = (paths ?? []).find(p => /\.json$/i.test(p));
    if (!file) { this.note = copy().drop; cx.notify(); return; }
    const app = this.app();
    cx.spawn(async cx => {
      try {
        const r = await this.nv(["key", "set", file]);
        if (r.code !== 0) this.note = this.errorOf(r);
        else {
          this.note = `${copy().keyOk} ${JSON.parse(r.stdout).email}`;
          if (app?.state.gate?.kind === "key") await this.resume(app.id);
        }
      } catch (error) { this.note = String(error.message ?? error); }
      this.load(cx);
    });
  }

  // ------------------------------------------------------------------ drawing

  button(id, label, onClick, t, { primary = false, active = false, danger = false } = {}) {
    return div().id(id).px(10).py(4).rounded(6).flex_none().text_size(12).cursor_pointer()
      .bg(primary ? t.accent : active ? t.selected : t.raised).text_color(primary ? t.accent_foreground : danger ? t.blocked : active ? t.foreground : t.muted)
      .hover(s => s.opacity(0.85))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  avatar(stageId, role, t, size = 28) {
    return div().w(size).h(size).rounded_full().flex_none().flex().items_center().justify_center().bg(t[HUE[stageId]] ?? t.accent).text_color(t.background)
      .text_size(Math.round(size * 0.38)).font_semibold().child(stageId === "person" ? "★" : initials(role));
  }

  topBar(t, l) {
    const key = this.data.key;
    const dot = st => st === "waiting" || st === "failed" ? t.blocked : st === "running" ? t.working : st === "done" ? t.done : t.idle;
    return h_flex().h(40).flex_none().px(12).gap(8).items_center().bg(t.chrome).border_b_1().border_color(t.border)
      .child(div().font_semibold().text_size(13).flex_none().child(l.title))
      .child(h_flex().flex_1().min_w(0).gap(4).overflow_hidden().children(this.data.apps.filter(a => a.state).map(a => {
        // The chip pulses only while something is really going on; a run that stopped on its own is red and still.
        const active = a.id === this.app()?.id && !this.form, stalled = this.stalled(a), live = !stalled && (a.state.status === "running" || a.state.status === "waiting");
        return h_flex().id(`app-${a.id}`).px(9).py(3).gap(6).rounded(12).items_center().cursor_pointer().flex_none()
          .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.select(a.id); cx.notify(); })
          .child(div().w(7).h(7).rounded_full().bg(stalled ? t.blocked : dot(a.state.status)).when(live, el => el.loop("opacity", { from: 0.35, to: 1, period: 1100 })))
          .child(a.state.name)
          .when(stalled, el => el.child(div().text_size(10).text_color(t.blocked).child(l.state.stalled)));
      })))
      .child(div().id("key-chip").px(9).py(3).rounded(12).text_size(11).flex_none().bg(t.raised).text_color(key.present ? t.done : t.blocked)
        .child(key.present ? `${l.key} ✓ ${String(key.email).split("@")[0]}` : l.keyMissing))
      .child(this.button("new-app", l.add, cx => { this.form = this.form ? null : { kind: "auto", mode: "promote" }; cx.notify(); }, t, { primary: true }));
  }

  keyDrop(t, l) {
    return v_flex().id("key-drop").p(14).gap(4).rounded(10).border_1().border_color(t.accent).bg(t.surface).items_center()
      .child(div().font_semibold().text_color(t.accent).child(l.drop))
      .child(div().text_size(11).text_color(t.muted).child(l.dropHelp));
  }

  newForm(t, l) {
    const chips = (id, values, labels, current, set) => h_flex().gap(4).children(values.map(v => this.button(`${id}-${v}`, labels[v], cx => { set(v); cx.notify(); }, t, { active: current === v })));
    const field = state => h_flex().h(30).px(8).rounded(6).bg(t.raised).items_center().child(Input.new(state).w_full().h_full().text_size(13).text_color(t.foreground));
    const hasKey = this.data.key.present;
    // The team section makes the form tall: it scrolls inside the tab instead of running off it.
    const room = Math.max(320, (this.size?.height ?? 900) - TOP_H - (this.note ? NOTE_H : 0) - 20);
    return v_flex().id("new-form").flex_none().max_h(room).overflow_y_scrollbar().p(14).gap(10).mx(12).my(10).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .when(!hasKey, el => el.child(this.keyDrop(t, l)))
      .child(div().font_semibold().text_size(13).child(l.auto))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().child(field(this.dirInput)))
        .child(this.button("browse", l.browse, cx => cx.spawn(async cx => {
          const chosen = await pickFolder({ prompt: l.browse }).catch(() => null);
          if (chosen) { this.dirInput.set_value(chosen); cx.notify(); }
        }), t)))
      .child(field(this.ideaInput))
      .child(field(this.refsInput))
      .when(this.refImages.length > 0, el => el.child(h_flex().gap(4).flex_wrap().children(this.refImages.map((p, i) => div().id(`ref-image-${i}`).px(7).py(2).rounded(9).text_size(11).bg(t.raised).text_color(t.muted).cursor_pointer()
        .on_click((_e, cx) => { this.refImages = this.refImages.filter((_x, n) => n !== i); cx.notify(); })
        .child(`${p.split(/[\\/]/).at(-1)} ×`)))))
      .child(div().text_size(11).text_color(t.dim).child(l.refsHelp))
      .child(field(this.nameInput))
      .child(chips("kind", ["auto", "app", "game"], l.kind, this.form.kind, v => { this.form.kind = v; }))
      .child(chips("mode", ["auto", "promote", "review"], l.mode, this.form.mode, v => { this.form.mode = v; }))
      .child(div().text_size(11).text_color(t.muted).child(l.modeHelp[this.form.mode]))
      .child(h_flex().gap(8).items_center()
        .child(this.button("replica", `${this.form.replica ? "✓ " : ""}${l.replica.use}`, cx => { this.form.replica = !this.form.replica; cx.notify(); }, t, { primary: Boolean(this.form.replica) }))
        .when(Boolean(this.data.replica?.version), el => el.child(div().text_size(10).text_color(t.dim).child(this.data.replica.version))))
      .when(Boolean(this.form.replica), el => el.child(div().id("replica-help").text_size(11).text_color(this.data.replica?.installed === false ? t.blocked : t.muted)
        .child(this.data.replica?.installed === false ? l.replica.missing : l.replica.help)))
      .child(this.teamForm(t, l))
      .child(h_flex().gap(8)
        .child(this.button("start", hasKey ? l.start : l.startNoKey, cx => this.create(cx), t, { primary: true }))
        .child(this.button("cancel", l.cancel, cx => { this.form = null; cx.notify(); }, t)));
  }

  /** The Replica skills of one stage: each with where it stands, why it was not needed or what the
   *  conductor's check said, and the files it leaves (lit when they exist). */
  replicaSteps(steps, rec, t, l) {
    const r = l.replica, tint = status => status === "done" ? t.done : status === "failed" ? t.blocked : status === "running" ? t.working : t.muted;
    return v_flex().id("replica").gap(5).p(8).rounded(8).bg(t.surface).border_1().border_color(steps.some(x => x.status === "failed") ? t.blocked : t.border)
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(11).font_semibold().child(r.title))
        .when(Boolean(rec.replica?.version), el => el.child(div().text_size(10).text_color(t.dim).child(String(rec.replica.version).slice(0, 7)))))
      .children(steps.map((x, i) => {
        const bad = x.checks.find(c => !c.ok), said = x.reason ?? bad?.detail ?? x.checks.find(c => c.detail)?.detail ?? null;
        return v_flex().id(`replica-step-${i}`).gap(3)
          .child(h_flex().gap(6).items_center()
            .child(div().w(150).flex_none().text_size(11).font_semibold().truncate().child(x.skill ? `${x.skill.replace("replica-", "")}${x.part ? ` (${x.part})` : ""}` : r.none))
            .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).truncate().child(lang() === "ko" ? x.ko : ""))
            .when(x.sample != null, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(r.sample.replace("{n}", x.sample))))
            .child(div().id(`replica-status-${i}`).flex_none().px(6).py(1).rounded(8).text_size(10).bg(t.raised).text_color(tint(x.status)).child(r.status[x.status] ?? x.status)))
          .when(Boolean(said), el => el.child(div().id(`replica-said-${i}`).pl(8).text_size(10).text_color(bad ? t.blocked : t.dim).child(String(said))))
          .when(x.files.length > 0, el => el.child(h_flex().gap(4).flex_wrap().pl(8).children(x.files.map((file, n) =>
            div().id(`replica-file-${i}-${n}`).px(5).rounded(4).text_size(10).bg(t.raised).text_color(file.exists ? t.accent : t.dim).child(file.path)))));
      }));
  }

  /** One role's cast as a row of chips: which agent, its model, how many at once, who reviews.
   *  `value` is { agent, model, count, review, split }; `set` gets what a click changes. */
  teamRow(key, stage, value, set, t, l, selected = false) {
    const agents = (this.catalog?.agents ?? []).filter(a => a.installed), chosen = agents.find(a => a.name === value.agent);
    const chip = (id, label, onClick, { active = false, tint = null } = {}) => div().id(id).px(7).py(2).rounded(5).flex_none().text_size(11).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? t.accent_foreground : tint ?? t.muted).hover(s => s.opacity(0.85))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const reviewers = ["none", ...agents.map(a => a.name)], current = String(value.review ?? "none");
    return h_flex().id(`${key}-${stage.id}`).gap(5).px(6).py(3).rounded(6).items_center().flex_wrap().bg(selected ? t.selected : t.surface)
      .child(div().w(84).flex_none().text_size(12).font_semibold().text_color(t[HUE[stage.id]] ?? t.accent).truncate().child(roleName(stage)))
      .children(agents.map(a => chip(`${key}-${stage.id}-agent-${a.name}`, a.name, cx => set({ agent: a.name, model: null }, cx), { active: a.name === value.agent })))
      .when(Boolean(chosen?.model), el => el.child(chip(`${key}-${stage.id}-model`, `${l.model}: ${value.model ?? l.unset}`,
        cx => set({ model: after([null, ...chosen.models], value.model ?? null) }, cx), { tint: value.model ? t.foreground : null })))
      .when(Boolean(value.split), el => el.child(chip(`${key}-${stage.id}-count`, `×${value.count}`,
        cx => set({ count: value.count >= (this.catalog?.maxWorkers ?? 4) ? 1 : value.count + 1 }, cx), { tint: value.count > 1 ? t.foreground : null })))
      .child(chip(`${key}-${stage.id}-review`, `${l.review}: ${current === "none" ? l.none : current}`,
        cx => set({ review: after(reviewers, reviewers.includes(current.split(":")[0]) ? current.split(":")[0] : "none") }, cx), { tint: current === "none" ? null : t.done }));
  }

  /** The team section of the new-app form: every role, cast before the start. */
  teamForm(t, l) {
    const box = v_flex().id("team-form").gap(3).p(8).rounded(8).border_1().border_color(t.border)
      .child(div().font_semibold().text_size(12).child(l.team));
    if (!this.catalog) return box.child(div().id("team-loading").text_size(11).text_color(t.dim).child(l.teamLoading));
    return box
      .child(div().text_size(11).text_color(t.dim).child(l.teamHelp))
      .children(this.data.stages.map(stage => this.teamRow("team", stage, this.teamOf(stage.id), patch => this.setTeam(stage.id, patch), t, l, this.teamStage === stage.id)))
      .child(h_flex().h(26).px(8).rounded(6).bg(t.raised).items_center().child(Input.new(this.modelInput).w_full().h_full().text_size(12).text_color(t.foreground)));
  }

  /** The office: every teammate at a desk. The one working bobs at a glowing screen with its latest
   *  note in a speech bubble, a finished one passes an envelope to the next desk, one that needs you
   *  waves an exclamation mark, and those whose turn hasn't come doze. Click a desk to look closer. */
  canvas(app, t, l) {
    const s = app.state, now = Date.now(), stages = this.data.stages, PX = 4;
    const lastHandoff = [...app.feed].reverse().find(e => e.kind === "handoff");
    const fresh = lastHandoff && now - Date.parse(lastHandoff.at) < 9000 ? lastHandoff.from : null;
    const shownId = this.focus ?? s.gate?.stage ?? s.stage;
    const lastNote = id => { const e = [...app.feed].reverse().find(e => e.from === id && (e.kind === "note" || e.kind === "start")); return e ? (l.feed[e.code] ?? e.text) : ""; };
    const desk = (stage, index) => {
      const rec = s.stages[stage.id] ?? { status: "pending" }, key = this.stateOf(app, stage.id), cast = app.team?.[stage.id];
      // Only an agent that is really working bobs at a lit screen. One that went quiet, or whose
      // run stalled, sits still under a red mark, like one that needs you.
      const working = key === "working", stuck = key === "quiet" || key === "stalled", needs = key === "needs" || stuck;
      const done = key === "done", failed = key === "failed", asleep = key === "pending";
      const shown = shownId === stage.id, color = t[HUE[stage.id]] ?? t.accent;
      const colors = { h: HAIR[index % HAIR.length], s: "#f1c9a5", e: "#1b1b1f", b: color, d: "#3a3550" };
      const person = sprite(asleep ? ASLEEP : PERSON, colors, PX);
      const bubbleText = working ? (lastNote(stage.id) || l.state.working) : stuck ? l.state[key] : needs ? "!" : failed ? "✕" : done ? "✓" : "";
      const bubble = div().h(20).max_w(150).px(6).rounded(8).flex_none().flex().items_center().text_size(10).truncate()
        .bg(working ? t.raised : needs || failed ? t.blocked : done ? t.done : t.canvas)
        .text_color(working ? t.foreground : needs || failed || done ? t.background : t.dim);
      const screen = div().w(22).h(15).rounded(2).flex_none().bg(working ? color : needs ? t.blocked : t.raised);
      const people = (rec.members ?? []).filter(m => m.part !== "review").length || cast?.count || 1;
      return v_flex().id(`stage-${stage.id}`).w(156).h(172).pt(8).gap(4).rounded(12).flex_none().cursor_pointer().items_center()
        .bg(shown ? t.selected : t.canvas).border_1().border_color(needs ? t.blocked : working ? color : shown ? t.input : t.canvas)
        .hover(el => el.bg(t.hover))
        .on_click((_e, cx) => this.open(app, stage.id, cx))
        .child(asleep ? bubble.frames(["z", "zZ", "zZz", ""], 700)
          : needs ? bubble.child(bubbleText).loop("top", { from: 0, to: -5, period: 420 })
          : bubble.child(bubbleText))
        .child(h_flex().h(52).gap(5).items_end().flex_none()
          .child(working ? person.loop("top", { from: 0, to: -3, period: 360 }) : asleep ? person.opacity(0.55) : person)
          .child(v_flex().items_center().flex_none()
            .child(working ? screen.loop("opacity", { from: 0.45, to: 1, period: 300 }) : screen)
            .child(div().w(4).h(4).bg(t.border))))
        .child(div().w(112).h(6).rounded(2).flex_none().bg(working ? color : t.border))
        .child(h_flex().gap(5).items_center()
          .child(div().font_semibold().text_size(12).truncate().child(roleName(stage)))
          .child(div().px(4).rounded(4).text_size(9).bg(t.raised).text_color(color).child(`${rec.agent ?? cast?.agent ?? stage.agent ?? ""}${people > 1 ? ` ×${people}` : ""}`)))
        // The state as a filled badge, so working, waiting and done read at a glance.
        .child(div().id(`state-${stage.id}`).px(7).py(1).rounded(8).text_size(10).font_semibold().truncate()
          .bg(asleep ? t.raised : this.stateColor(key, t)).text_color(asleep ? t.muted : t.background)
          .child(`${l.state[key]}${rec.round > 1 ? ` · ${l.round} ${rec.round}` : ""}${rec.endedAt && done ? ` · ${ago(rec.endedAt, now)}` : ""}`));
    };
    // Between desks: a line that lights up once work has passed it, and an envelope flying across during a hand-off.
    const link = (from, passed) => {
      const flying = fresh === from;
      const line = div().w(34).h(2).flex_none().bg(flying ? t.accent : passed ? t.done : t.border);
      return v_flex().w(34).h(172).flex_none().justify_center().gap(4)
        .child(flying ? div().w(9).h(7).rounded(1).flex_none().bg(t.accent).loop("left", { from: 0, to: 25, period: 650 }) : div().h(7))
        .child(line);
    };
    const end = (id, label, lit, mark) => v_flex().id(id).w(56).h(172).gap(6).flex_none().items_center().justify_center()
      .child(div().w(34).h(34).rounded_full().flex().items_center().justify_center().bg(lit ? t.accent : t.raised).text_color(lit ? t.accent_foreground : t.muted).child(mark)
        .when(lit, el => el.loop("opacity", { from: 0.5, to: 1, period: 800 })))
      .child(div().text_size(11).text_color(lit ? t.foreground : t.muted).child(label));
    const row = [end("end-you", l.you, s.status === "waiting", "★")];
    stages.forEach((stage, i) => {
      row.push(link(i === 0 ? "person" : stages[i - 1].id, i === 0 || s.stages[stages[i - 1].id]?.status === "done"));
      row.push(desk(stage, i));
    });
    row.push(link("release", s.status === "done"), end("end-store", l.shipped, s.status === "done", "▲"));
    return div().id("team-canvas").h(CANVAS_H).w_full().flex_none().bg(t.canvas).border_b_1().border_color(t.border)
      .child(h_flex().id("team-row").size_full().px(14).items_center().overflow_x_scrollbar().children(row));
  }

  /** One line above the office: how many desks are working, waiting, done, and whether the run itself stalled. */
  summary(app, t, l) {
    const counts = Object.fromEntries(STATES.map(k => [k, 0]));
    for (const stage of this.data.stages) counts[this.stateOf(app, stage.id)]++;
    const stalled = this.stalled(app);
    return h_flex().id("state-summary").h(SUMMARY_H).w_full().flex_none().px(14).gap(12).items_center().text_size(11).bg(t.canvas)
      .children(STATES.filter(k => counts[k] > 0 || ["working", "pending", "done"].includes(k)).map(k => h_flex().id(`count-${k}`).gap(5).items_center().flex_none()
        .child(div().w(8).h(8).rounded_full().bg(k === "pending" ? t.muted : this.stateColor(k, t)))
        .child(div().text_color(counts[k] ? t.foreground : t.dim).child(`${l.state[k]} ${counts[k]}`))))
      .child(div().flex_1())
      .when(stalled, el => el
        .child(div().id("stalled-note").flex_none().text_color(t.blocked).truncate().child(l.stalled))
        .child(this.button("continue-stalled", l.resume, cx => cx.spawn(async cx => { await this.resume(app.id); this.load(cx); }), t, { primary: true })));
  }

  /** What they told each other: hand-offs, notes, questions for you. Yours sit on the right. */
  chat(app, t, l, height) {
    const now = Date.now();
    const who = id => id === "person" ? l.you : roleName(this.data.stages.find(x => x.id === id)) || id;
    const bubble = (e, i) => {
      const mine = e.from === "person";
      const tint = e.kind === "fail" || e.kind === "ask" ? t.blocked : e.kind === "handoff" || e.kind === "done" ? t.done : t.muted;
      const body = v_flex().max_w(520).gap(2).px(10).py(6).rounded(10).bg(mine ? t.selected : t.surface)
        .child(h_flex().gap(6).text_size(10).text_color(tint)
          .child(div().font_semibold().child(`${who(e.from)}${e.to ? ` → ${who(e.to)}` : ""}`))
          .child(div().text_color(t.dim).child(ago(e.at, now))))
        .child(div().text_size(12).text_color(t.foreground).child(l.feed[e.code] ? l.feed[e.code].replace("{arg}", e.arg ?? "") : String(e.text)));
      const face = this.avatar(e.from, this.data.stages.find(x => x.id === e.from)?.role ?? "", t, 24);
      return h_flex().id(`feed-${i}`).gap(8).items_start().when(mine, el => el.justify_end()).children(mine ? [body, face] : [face, body]);
    };
    return v_flex().id("team-chat").flex_1().min_w(0).h(height)
      .child(div().h(30).px(12).flex_none().flex().items_center().text_size(11).text_color(t.dim).child(l.chat))
      .child(v_flex().id("team-chat-list").w_full().h(Math.max(60, height - 70)).flex_none().px(12).gap(8).overflow_y_scrollbar().children(app.feed.slice(-30).map(bubble)))
      .child(h_flex().h(40).flex_none().px(12).gap(8).items_center().border_t_1().border_color(t.border)
        .child(h_flex().flex_1().h(28).px(8).rounded(6).bg(t.raised).items_center().child(Input.new(this.sayInput).w_full().h_full().text_size(12).text_color(t.foreground)))
        .child(this.button("say", l.send, cx => this.say(cx), t)));
  }

  /** The selected teammate: what it made, and whatever needs you. */
  detail(app, t, l, height) {
    const s = app.state, id = this.focus ?? s.gate?.stage ?? s.stage ?? this.data.stages.at(-1)?.id;
    const stage = this.data.stages.find(x => x.id === id), rec = s.stages[id] ?? {};
    const gate = s.gate?.stage === id ? s.gate : null;
    const picking = gate?.kind === "pick";
    const cards = (s.options?.[id] ?? []).map(o => {
      const chosen = s.choice?.[id] === o.id;
      const card = v_flex().id(`option-${o.id}`).w(190).p(8).gap(6).rounded(10).bg(t.surface).border_1().border_color(chosen ? t.accent : o.recommended ? t.done : t.border)
        .when(Boolean(o.preview), el => el.child(image(o.preview).w(174).h(232).rounded(6)))
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().font_semibold().text_size(12).truncate().child(o.title))
          .when(o.score != null, el => el.child(div().text_size(10).text_color(t.muted).child(`${l.score} ${o.score}`))))
        .child(div().text_size(11).text_color(t.muted).child(o.desc))
        .child(div().text_size(10).text_color(chosen ? t.accent : o.recommended ? t.done : t.dim).child(chosen ? l.chosen : o.recommended ? l.recommended : picking ? l.choose : ""));
      return picking ? card.cursor_pointer().hover(st => st.bg(t.hover)).on_click((_e, cx) => this.command(cx, ["pick", app.id, o.id], { resume: true })) : card;
    });
    const stalled = this.stalled(app), resting = ["idle", "paused", "stopped", "failed"].includes(s.status) || stalled;
    const key = this.stateOf(app, id), cast = app.team?.[id], live = this.liveTerminals(app, rec);
    // Everyone at this desk: the lead, the workers, the reviewer; each with its screen one click away.
    const members = (rec.members ?? []).map(m => {
      const there = m.terminal && live.includes(m.terminal), word = there ? app.live?.[m.terminal] : null;
      return h_flex().id(`member-${m.part}-${m.id || "one"}`).gap(8).px(8).py(4).rounded(6).items_center().bg(t.surface)
        .child(div().w(64).flex_none().text_size(11).font_semibold().child(`${l.part[m.part] ?? m.part}${m.id && m.part === "worker" ? ` ${m.id.replace("w", "")}` : ""}`))
        .child(div().px(5).rounded(4).text_size(10).bg(t.raised).text_color(t.accent).child(`${m.agent ?? ""}${m.model ? `:${m.model}` : ""}`))
        .child(div().flex_1().text_size(11).truncate().text_color(m.status === "done" ? t.done : m.status === "running" ? (word === "working" || word === "live" ? t.working : t.blocked) : t.muted)
          .child(m.status === "running" ? (word === "working" || word === "live" ? l.state.working : there ? l.state.quiet : l.state.stalled) : l.status[m.status] ?? m.status ?? ""))
        .when(Boolean(there), el => el
          .child(this.button(`peek-${m.part}-${m.id || "one"}`, l.peek, () => run("terminal.peek", { terminal: m.terminal }), t))
          .child(this.button(`keep-${m.part}-${m.id || "one"}`, l.keep, () => run("terminal.keep", { terminal: m.terminal, place: "tab" }), t)));
    });
    const conductorName = `pipe-${s.tag ?? app.id.slice(0, 20)}`, conductor = app.conducted ? terminals().find(x => x.name === conductorName)?.address : null;
    const recast = (patch, cx) => {
      const next = { agent: cast.agent, model: cast.model, count: cast.count, review: cast.review, ...patch };
      this.command(cx, ["cast", app.id, id, `${next.agent}${next.model ? `:${next.model}` : ""}*${next.count}`, "--review", next.review]);
    };
    return v_flex().id("detail").w(640).h(height).flex_none().p(12).gap(10).overflow_y_scrollbar().border_l_1().border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(this.avatar(id, stage?.role ?? "", t, 26))
        .child(div().font_semibold().text_size(13).child(roleName(stage)))
        .child(div().px(5).rounded(4).text_size(10).bg(t.raised).text_color(t.accent).child(`${rec.agent ?? cast?.agent ?? stage?.agent ?? ""}${cast?.model ? `:${cast.model}` : ""}`))
        .child(div().id("detail-state").px(7).py(1).rounded(8).text_size(10).font_semibold().bg(key === "pending" ? t.raised : this.stateColor(key, t)).text_color(key === "pending" ? t.muted : t.background).child(l.state[key]))
        .child(div().flex_1())
        .when(Boolean(conductor), el => el.child(this.button("conductor", l.conductor, () => run("terminal.peek", { terminal: conductor }), t)))
        .when(live.length > 0, el => el.child(this.button("watch", l.watch, () => run("terminal.peek", { terminal: live[0] }), t))))
      .when(stalled, el => el.child(v_flex().id("stalled").gap(6).p(10).rounded(10).bg(t.surface).border_1().border_color(t.blocked)
        .child(div().text_size(12).text_color(t.blocked).child(l.stalled))
        .child(h_flex().child(this.button("continue-stalled-detail", l.resume, cx => cx.spawn(async cx => { await this.resume(app.id); this.load(cx); }), t, { primary: true })))))
      .when(key === "quiet", el => el.child(div().id("quiet").text_size(12).text_color(t.blocked).child(l.quiet)))
      .when(members.length > 0, el => el.child(v_flex().id("members").gap(4).children(members)))
      .when(Boolean(app.replica?.[id]?.length), el => el.child(this.replicaSteps(app.replica[id], rec, t, l)))
      .when(rec.status === "pending" && Boolean(cast) && Boolean(this.catalog) && Boolean(stage), el => el.child(
        this.teamRow("cast", stage, { ...cast, split: Boolean(this.catalog.team?.[id]?.split) }, recast, t, l)))
      .when(picking, el => el.child(div().font_semibold().text_color(t.blocked).child(l.pick)))
      .when(gate?.kind === "approve", el => el.child(v_flex().gap(6).p(10).rounded(10).bg(t.surface).border_1().border_color(t.blocked)
        .child(div().text_size(12).child(l.approveHelp))
        .child(h_flex().child(this.button("approve", l.approve, cx => this.command(cx, ["approve", app.id], { resume: true }), t, { primary: true })))))
      .when(gate?.kind === "key", el => el.child(this.keyDrop(t, l)))
      .when(gate?.kind === "blocked", el => el.child(v_flex().gap(6)
        .child(div().text_color(t.blocked).child(l.blocked))
        .child(h_flex().child(this.button("continue-blocked", l.resume, cx => cx.spawn(async cx => { await this.resume(app.id); this.load(cx); }), t, { primary: true })))))
      .when(Boolean(rec.error), el => el.child(div().text_size(12).text_color(t.blocked).child(String(rec.error))))
      .when(Boolean(rec.summary) && !rec.error, el => el.child(div().text_size(12).child(String(rec.summary))))
      .when(cards.length > 0, el => el.child(h_flex().gap(10).flex_wrap().children(cards)))
      .child(div().h(1).flex_none().bg(t.border))
      .child(h_flex().gap(4).items_center().children(["auto", "promote", "review"].map(m => this.button(`mode-${m}`, l.mode[m], cx => this.command(cx, ["mode", app.id, m], { resume: m !== "review" && s.gate?.kind === "pick" }), t, { active: s.mode === m }))))
      .child(div().text_size(11).text_color(t.muted).child(l.modeHelp[s.mode] ?? ""))
      .child(h_flex().gap(6).flex_wrap()
        .when(resting, el => el.child(this.button("resume", s.status === "failed" ? l.retry : l.resume,
          cx => s.status === "failed" ? this.command(cx, ["retry", app.id], { resume: true }) : cx.spawn(async cx => { await this.resume(app.id); this.load(cx); }), t, { primary: true })))
        .when(rec.status === "done", el => el.child(this.button("retry-stage", `${l.retry}: ${roleName(stage)}`, cx => this.command(cx, ["retry", app.id, id], { resume: true }), t)))
        .when(s.status === "running" || s.status === "waiting", el => el.child(this.button("stop", l.stop, cx => this.command(cx, ["stop", app.id]), t, { danger: true })))
        .when(s.status !== "running", el => el.child(this.button("remove", l.remove, cx => { this.selected = null; this.command(cx, ["remove", app.id]); }, t))))
      .child(div().text_size(10).text_color(t.dim).truncate().child(`${[s.engine, s.package].filter(Boolean).join(" · ")}${s.engine || s.package ? " · " : ""}${app.dir}`));
  }

  render() {
    const t = theme(), l = copy(), app = this.app();
    const body = Math.max(220, (this.size?.height ?? 900) - TOP_H - SUMMARY_H - CANVAS_H - (this.note ? NOTE_H : 0));
    return v_flex().id("nv-pipeline").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_drop((e, cx) => this.dropKey(e.paths, cx))
      .child(this.topBar(t, l))
      .when(Boolean(this.note), el => el.child(div().id("note").h(NOTE_H).px(12).flex_none().flex().items_center().text_size(11).text_color(t.muted).bg(t.surface).child(String(this.note))))
      .when(Boolean(this.form), el => el.child(this.newForm(t, l)))
      .when(!app && !this.form, el => el.child(v_flex().flex_1().items_center().justify_center().gap(14).p(24)
        .child(div().text_color(t.muted).child(l.empty))
        .when(!this.data.key.present, x => x.child(this.keyDrop(t, l)))
        .child(this.button("new-app-empty", l.add, cx => { this.form = { kind: "auto", mode: "promote" }; cx.notify(); }, t, { primary: true }))))
      .when(Boolean(app) && !this.form, el => el
        .child(this.summary(app, t, l))
        .child(this.canvas(app, t, l))
        .child(h_flex().w_full().h(body).flex_none().child(this.chat(app, t, l, body)).child(this.detail(app, t, l, body))));
  }
}
