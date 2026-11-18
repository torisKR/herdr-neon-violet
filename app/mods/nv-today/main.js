// Today: what to pick up now, and where each project was left.
//   - two places at the top: one main project and one maintenance project
//   - each project shows the one next action, the state it was left in, why it stopped, where to
//     continue (machine, folder, branch) and whether what was verified still holds
//   - Continue opens the project's space (or makes it); "with an agent" also starts an agent that
//     is given the note; Leave a note records where you stop
// bin/nv-today.mjs keeps the notes and reads git (no tokens). This mod runs it on this computer and
// on every connected machine, so each project is listed where it lives.
// Open it as a tab: tab.new { mod: "nv-today" } (Ctrl+Shift+J).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, checking, exec, focused, knownAgents, machines, pickFolder, readTextFile, run, settings, shared, spaces, terminals, theme } from "herdr";

const POLL_MS = 60000, TOP_H = 40;
const FIELDS = ["next", "state", "why", "hold", "verified"];
const TEXT = {
  en: { title: "Today", all: "All", personal: "Personal", work: "Work", refresh: "Refresh", add: "+ Folder", addHere: "+ This folder", loading: "Reading projects…", local: "This computer",
    main: "Main work", maint: "Maintenance", emptyMain: "Pick the one project you work on today: press “Main” on a project below.", emptyMaint: "Nothing urgent to maintain. Press “Maintenance” on a project when something is.",
    empty: "No project yet. Add the folders you want to come back to.", others: "All projects", show: "show", hide: "hide",
    next: "Next action", state: "Where it stands", why: "Why it stopped", hold: "Decisions on hold", verified: "Verified", where: "Continue at",
    noNext: "No next action written yet. Leave a note before you stop.", noVerified: "Nothing recorded as verified.",
    fresh: "still holds", stale: "the code changed since: check again", staleBy: "{commits} commit(s), {files} file(s) changed", moved: "the branch or commit moved since the note",
    reasons: { missing: "folder is missing", stopped: "stopped for a reason", stale: "verification is out of date", dirty: "has uncommitted changes", nonote: "no next action" },
    resume: "Continue", resumeAgent: "Continue with an agent", note: "Leave a note", changes: "Last changes", askAgent: "Ask the agent to write it",
    setMain: "Main", setMaint: "Maintenance", unfocus: "Unpin", remove: "Remove", save: "Save", cancel: "Cancel", fromGit: "Draft from git", recheck: "Checked again now",
    ph: { next: "The one thing to do next", state: "What is done, what is not checked yet", why: "Why you stop here (a failing test, a missing setting, waiting for someone); empty if nothing", hold: "A decision you put off; empty if none", verified: "What you really ran and saw; empty if nothing" },
    uncommitted: "uncommitted", noGit: "no git repository", noAgent: "No agent is installed on that machine.", sent: "Asked the agent in {to}.", ago: "ago" },
  ko: { title: "오늘 · 이어하기", all: "전체", personal: "개인", work: "회사", refresh: "새로고침", add: "+ 폴더 추가", addHere: "+ 지금 폴더", loading: "프로젝트를 읽는 중…", local: "이 컴퓨터",
    main: "주요 작업", maint: "유지보수", emptyMain: "오늘 집중할 프로젝트 하나를 고르세요. 아래 프로젝트에서 「주요」를 누르면 됩니다.", emptyMaint: "급한 유지보수가 없습니다. 생기면 프로젝트에서 「유지보수」를 누르세요.",
    empty: "아직 프로젝트가 없습니다. 다시 돌아올 폴더를 추가하세요.", others: "전체 프로젝트", show: "펼치기", hide: "접기",
    next: "다음 행동", state: "현재 상태", why: "멈춘 이유", hold: "보류한 결정", verified: "검증", where: "이어갈 곳",
    noNext: "다음 행동이 아직 없습니다. 멈추기 전에 기록을 남기세요.", noVerified: "검증했다고 남긴 기록이 없습니다.",
    fresh: "그대로 유효", stale: "이후 코드가 바뀜: 다시 확인", staleBy: "커밋 {commits}개, 파일 {files}개 변경", moved: "기록 이후 브랜치나 커밋이 바뀜",
    reasons: { missing: "폴더가 없음", stopped: "이유가 있어 멈춤", stale: "검증이 오래됨", dirty: "커밋 안 된 변경", nonote: "다음 행동 없음" },
    resume: "이어하기", resumeAgent: "에이전트와 이어하기", note: "멈춤 기록", changes: "마지막 변경", askAgent: "에이전트에게 기록 맡기기",
    setMain: "주요", setMaint: "유지보수", unfocus: "고정 해제", remove: "빼기", save: "저장", cancel: "취소", fromGit: "Git 에서 초안", recheck: "지금 다시 확인함",
    ph: { next: "다음에 할 한 가지", state: "끝낸 것과 아직 확인하지 않은 것", why: "여기서 멈추는 이유(테스트 실패, 설정 미완료, 응답 대기). 없으면 비움", hold: "미뤄 둔 결정. 없으면 비움", verified: "실제로 실행해서 본 것. 없으면 비움" },
    uncommitted: "커밋 안 됨", noGit: "git 저장소 아님", noAgent: "그 머신에 설치된 에이전트가 없습니다.", sent: "{to} 의 에이전트에게 요청했습니다.", ago: "전" },
};
const language = value => { const k = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0]; return Object.hasOwn(TEXT, k) ? k : null; };
const lang = () => language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en";
const copy = () => TEXT[lang()];
const norm = path => String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const keyOf = (machine, id) => `${machine ?? ""}/${id}`;

/** "3m", "2h", "5d": how long ago, short. */
function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

/** How an agent is told to leave the next note. */
const noteCommand = (tool, id, ko) => ko
  ? `node "${tool}" note ${id} --state "<끝낸 것과 확인 안 한 것>" --next "<다음 한 가지>" --why "<멈춘 이유, 없으면 빈 문자열>" --verified "<실제로 확인한 것>"`
  : `node "${tool}" note ${id} --state "<what is done, what is not checked>" --next "<the one next thing>" --why "<why it stops, or empty>" --verified "<what you really checked>"`;

/** What an agent is told when it picks a project up: the note, whether the verification still holds, and how to leave the next note. */
function handoff(p, tool, ko) {
  const n = p.note ?? {}, v = p.verification ?? {};
  const lines = ko ? [
    `"${p.name}" 프로젝트를 이어서 작업합니다. 아래는 지난번에 멈출 때 남긴 기록입니다.`,
    n.state ? `현재 상태: ${n.state}` : null,
    n.next ? `다음 행동: ${n.next}` : "다음 행동이 적혀 있지 않습니다. 먼저 git 상태를 보고 무엇이 남았는지 정리해 알려 주세요.",
    n.why ? `멈춘 이유: ${n.why}` : null,
    n.hold ? `보류한 결정(마음대로 정하지 말고 물어볼 것): ${n.hold}` : null,
    v.state === "fresh" ? `검증된 것(그대로 유효): ${v.text}` : v.state === "stale" ? `지난 검증: ${v.text}. 그 뒤로 코드가 바뀌었으니 이 검증은 믿지 말고 다시 확인하세요.` : "검증했다고 남긴 기록은 없습니다.",
    "다음 행동부터 시작하세요. 끝내거나 멈출 때는 아래 명령으로 기록을 남기세요(실제로 실행해 확인한 것만 --verified 에 적습니다):",
    noteCommand(tool, p.id, true),
  ] : [
    `You are picking up the project "${p.name}". This is the note left when work stopped.`,
    n.state ? `Where it stands: ${n.state}` : null,
    n.next ? `Next action: ${n.next}` : "No next action was written. First look at the git state and say what is left.",
    n.why ? `Why it stopped: ${n.why}` : null,
    n.hold ? `Decisions on hold (ask, do not decide yourself): ${n.hold}` : null,
    v.state === "fresh" ? `Verified (still holds): ${v.text}` : v.state === "stale" ? `Last verification: ${v.text}. The code changed since, so do not rely on it: check again.` : "Nothing was recorded as verified.",
    "Start with the next action. When you finish or stop, leave a note with this command (put only what you really ran and saw in --verified):",
    noteCommand(tool, p.id, false),
  ];
  return lines.filter(Boolean).join("\n");
}

export default class Today extends View {
  init(_props, cx) {
    this.groups = [];          // one per machine: { machine, tool, projects, error }
    this.filter = ["all", "personal", "work"].includes(localStorage.getItem("filter")) ? localStorage.getItem("filter") : "all";
    this.showAll = localStorage.getItem("all") !== "0";
    this.opened = {};          // projects whose last changes are shown
    this.editing = null;       // { machine, id, verified, recheck } while the note form is open
    this.note = null;
    this.inputs = Object.fromEntries(FIELDS.map(f => [f, InputState.new({ placeholder: copy().ph[f] })]));
    this.inputs.next.on("submit", (_e, cx) => this.saveNote(cx));
    if (checking()) return;
    cx.timer.every(POLL_MS, cx => this.load(cx));
    this.load(cx);
  }

  /** Runs one nv-today command on a machine (null: this computer) and returns what it answered. */
  async call(machine, request) {
    if (!this.source) {
      this.source = await readTextFile(`${appHome()}/bin/nv-today.mjs`);
      if (!this.source) throw new Error("bin/nv-today.mjs is missing: install this pack again");
    }
    const script = `${this.source}\ntry { console.log(JSON.stringify(run(${JSON.stringify(request)}))); } catch (e) { console.log(JSON.stringify({ error: String(e && e.message || e) })); }`;
    const r = await exec("node", ["--input-type=module", "-e", script], { on: machine, timeout: 30000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "node failed").trim().slice(0, 200));
    const data = JSON.parse(r.stdout);
    if (data.error) throw new Error(data.error);
    return data;
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      const names = [...new Set([null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)])];
      const groups = await Promise.all(names.map(async machine => {
        try { const data = await this.call(machine, { command: "list" }); return { machine, tool: data.tool, projects: data.projects }; }
        // A machine without Node or without this pack is left out quietly; this computer says why.
        catch (error) { return { machine, tool: null, projects: [], error: machine ? null : String(error.message ?? error) }; }
      }));
      this.groups = groups; this.loaded = true; this.loading = false;
      const failed = groups.find(g => g.error);
      if (failed) this.note = failed.error;
      cx.notify();
    });
  }

  /** Runs a command that changes something, then reads everything again. */
  act(cx, machine, request, after = null) {
    cx.spawn(async cx => {
      try { const result = await this.call(machine, request); this.note = null; after?.(result); }
      catch (error) { this.note = String(error.message ?? error); }
      this.loading = false;
      this.load(cx);
      cx.notify();
    });
  }

  /** Every project with the machine it is on, the filter applied. */
  rows() {
    return this.groups.flatMap(g => g.projects.map(p => ({ p, machine: g.machine, tool: g.tool })))
      .filter(r => this.filter === "all" || r.p.kind === this.filter);
  }

  /** The folder the focused terminal is in, and its machine: what "+ This folder" adds. */
  here() {
    const f = focused();
    if (!f?.cwd) return null;
    return { dir: f.cwd, machine: f.terminal?.includes("/") ? f.terminal.split("/")[0] : null };
  }

  /** What the agent that continues a project is told. */
  handoffOf(row) { return handoff(row.p, row.tool, lang() === "ko"); }

  /** Opens the project's space, or makes one in its folder on its machine. With an agent, the agent
   *  starts there and is told the note. */
  resume(row, withAgent, cx) {
    const { p, machine } = row;
    const space = spaces().find(s => (s.machine ?? null) === machine && norm(s.folder) === norm(p.dir));
    const where = machine ? { machine } : {};
    if (!withAgent) {
      if (space) run("space.select", { id: space.id }); else run("space.new", { name: p.name, folder: p.dir, ...where });
      return;
    }
    cx.spawn(async cx => {
      try {
        const known = (await knownAgents({ on: machine })).filter(a => a.installed && a.key !== "herdr-web-browser");
        const agent = known.find(a => /claude/i.test(a.key)) ?? known[0];
        if (!agent) { this.note = copy().noAgent; cx.notify(); return; }
        const task = this.handoffOf(row);
        if (space) { run("space.select", { id: space.id }); run("tab.new", { name: agent.name, space: space.id, argv: agent.run, task }); }
        else run("space.new", { name: p.name, folder: p.dir, argv: agent.run, task, ...where });
      } catch (error) { this.note = String(error.message ?? error); cx.notify(); }
    });
  }

  /** An agent that is already working in the project's folder, to ask for the note. */
  agentIn(row) {
    const dir = norm(row.p.dir), prefix = row.machine ? `${row.machine}/` : "";
    return terminals().find(t => t.status && t.state !== "finished" && String(t.address ?? "").startsWith(prefix) && (prefix || !String(t.address).includes("/"))
      && (norm(t.cwd) === dir || norm(t.cwd).startsWith(`${dir}/`))) ?? null;
  }
  askAgent(row, agent, cx) {
    const ko = lang() === "ko";
    const text = `${ko ? "지금까지 한 일을 멈춤 기록으로 남겨 주세요. 실제로 실행해 확인한 것만 --verified 에 적고, 다음 행동은 한 가지만 적습니다:" : "Leave a note of where this work stands. Put only what you really ran and saw in --verified, and exactly one next action:"}\n${noteCommand(row.tool, row.p.id, ko)}`;
    cx.spawn(async cx => {
      try { await exec("hc", ["send", agent.address, text], { timeout: 20000 }); this.note = copy().sent.replace("{to}", agent.address); }
      catch (error) { this.note = String(error.message ?? error); }
      cx.notify();
    });
  }

  edit(row, cx) {
    const n = row.p.note ?? {};
    this.editing = { machine: row.machine, id: row.p.id, verified: n.verified?.text ?? "", recheck: false };
    for (const f of FIELDS) this.inputs[f].set_value(f === "verified" ? n.verified?.text ?? "" : n[f] ?? "");
    cx.notify();
  }
  saveNote(cx) {
    const e = this.editing;
    if (!e) return;
    const flags = Object.fromEntries(FIELDS.filter(f => f !== "verified").map(f => [f, this.inputs[f].value().trim()]));
    // A verification is stamped against the code as it is now, so it is sent only when its text
    // changed or the person says they checked again: saving a note must not renew an old check.
    const verified = this.inputs.verified.value().trim();
    if (verified !== e.verified || e.recheck) flags.verified = verified;
    this.editing = null;
    this.act(cx, e.machine, { command: "note", args: [e.id], flags });
  }

  // ------------------------------------------------------------------ drawing

  button(id, label, onClick, t, { primary = false, active = false, danger = false, small = false } = {}) {
    return div().id(id).px(small ? 7 : 10).py(small ? 2 : 4).rounded(6).flex_none().text_size(small ? 11 : 12).cursor_pointer()
      .bg(primary ? t.accent : active ? t.selected : t.raised).text_color(primary ? t.accent_foreground : danger ? t.blocked : active ? t.foreground : t.muted)
      .hover(s => s.opacity(0.85)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
  }

  topBar(t, l) {
    const here = this.here();
    const set = value => { this.filter = value; localStorage.setItem("filter", value); };
    const kind = () => this.filter === "work" ? { kind: "work" } : {};
    return h_flex().id("today-top").h(TOP_H).flex_none().px(12).gap(8).items_center().bg(t.chrome).border_b_1().border_color(t.border)
      .child(div().font_semibold().text_size(13).flex_none().child(l.title))
      .children(["all", "personal", "work"].map(f => this.button(`filter-${f}`, l[f], () => set(f), t, { active: this.filter === f, small: true })))
      .child(div().flex_1())
      .when(Boolean(here), el => el.child(this.button("add-here", l.addHere, cx => this.act(cx, here.machine, { command: "add", args: [here.dir], flags: kind() }), t)))
      .child(this.button("add", l.add, cx => cx.spawn(async cx => {
        const dir = await pickFolder({ prompt: l.add }).catch(() => null);
        if (dir) this.act(cx, null, { command: "add", args: [dir], flags: kind() });
      }), t, { primary: true }))
      .child(this.button("refresh", l.refresh, cx => { this.loading = false; this.load(cx); }, t));
  }

  /** One labelled line of a card. */
  line(id, label, text, t, { strong = false, tint = null } = {}) {
    return h_flex().id(id).gap(10).items_start()
      .child(div().w(84).flex_none().text_size(11).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(strong ? 14 : 12).when(strong, el => el.font_semibold()).text_color(tint ?? t.foreground).child(String(text)));
  }

  card(row, t, l, big) {
    const { p, machine } = row, n = p.note ?? {}, v = p.verification ?? { state: "none" }, g = p.git ?? {}, k = keyOf(machine, p.id), now = Date.now();
    const where = `${machine ?? l.local} · ${p.dir}${g.repo ? ` · ${g.branch}@${g.head}${g.dirty ? ` (${l.uncommitted} ${g.dirty})` : ""}` : g.missing ? ` · ${l.reasons.missing}` : ` · ${l.noGit}`}`;
    const check = v.state === "none" ? l.noVerified
      : `${v.text} · ${ago(v.at, now)} ${l.ago} · ${v.state === "fresh" ? l.fresh : `${l.stale} (${l.staleBy.replace("{commits}", v.commits ?? 0).replace("{files}", v.files ?? 0)})`}`;
    const agent = this.agentIn(row), editing = Boolean(this.editing) && keyOf(this.editing.machine, this.editing.id) === k;
    const chips = (p.reasons ?? []).filter(r => r !== "nonote").map(r => div().id(`reason-${k}-${r}`).px(6).py(1).rounded(8).flex_none().text_size(10)
      .bg(t.raised).text_color(r === "dirty" ? t.muted : t.blocked).child(l.reasons[r]));
    return v_flex().id(`project-${k}`).p(big ? 14 : 10).gap(big ? 8 : 5).rounded(10).bg(t.surface).border_1()
      .border_color(v.state === "stale" || n.why ? t.blocked : p.focus === "main" ? t.accent : t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().font_semibold().text_size(big ? 15 : 13).truncate().child(p.name))
        .child(div().id(`kind-${k}`).px(6).py(1).rounded(8).flex_none().text_size(10).cursor_pointer().bg(t.raised).text_color(t.muted)
          .on_click((_e, cx) => this.act(cx, machine, { command: "kind", args: [p.id, p.kind === "work" ? "personal" : "work"] })).child(l[p.kind] ?? p.kind))
        .children(chips)
        .child(div().flex_1())
        .when(Boolean(n.at), el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(`${ago(n.at, now)} ${l.ago}`))))
      .child(this.line(`next-${k}`, l.next, n.next || l.noNext, t, { strong: true, tint: n.next ? t.accent : t.dim }))
      .when(Boolean(n.state), el => el.child(this.line(`state-${k}`, l.state, n.state, t)))
      .when(Boolean(n.why), el => el.child(this.line(`why-${k}`, l.why, n.why, t, { tint: t.blocked })))
      .when(Boolean(n.hold), el => el.child(this.line(`hold-${k}`, l.hold, n.hold, t)))
      .child(this.line(`verified-${k}`, l.verified, check, t, { tint: v.state === "stale" ? t.blocked : v.state === "fresh" ? t.done : t.dim }))
      .child(this.line(`where-${k}`, l.where, `${where}${p.moved ? ` · ${l.moved}` : ""}`, t, { tint: t.muted }))
      .when(Boolean(this.opened[k]) && Boolean(g.repo), el => el.child(v_flex().id(`changes-${k}`).gap(2).p(8).rounded(6).bg(t.raised).text_size(11)
        .children((g.commits ?? []).map((c, i) => h_flex().id(`commit-${k}-${i}`).gap(8)
          .child(div().w(56).flex_none().text_color(t.accent).child(c.hash)).child(div().w(34).flex_none().text_color(t.dim).child(ago(c.at, now))).child(div().flex_1().min_w(0).truncate().child(c.subject))))
        .children((g.files ?? []).map((f, i) => div().id(`file-${k}-${i}`).text_color(t.muted).truncate().child(`${l.uncommitted}: ${f}`)))))
      .when(editing, el => el.child(this.form(row, t, l)))
      .when(!editing, el => el.child(h_flex().gap(6).flex_wrap().items_center()
        .child(this.button(`resume-${k}`, l.resume, cx => this.resume(row, false, cx), t, { primary: true }))
        .child(this.button(`resume-agent-${k}`, l.resumeAgent, cx => this.resume(row, true, cx), t))
        .child(this.button(`note-${k}`, l.note, cx => this.edit(row, cx), t))
        .when(Boolean(agent), x => x.child(this.button(`ask-${k}`, l.askAgent, cx => this.askAgent(row, agent, cx), t)))
        .when(Boolean(g.repo), x => x.child(this.button(`toggle-changes-${k}`, l.changes, () => { this.opened = { ...this.opened, [k]: !this.opened[k] }; }, t, { active: Boolean(this.opened[k]) })))
        .child(div().flex_1())
        .when(p.focus !== "main", x => x.child(this.button(`main-${k}`, l.setMain, cx => this.act(cx, machine, { command: "focus", args: [p.id, "main"] }), t, { small: true })))
        .when(p.focus !== "maint", x => x.child(this.button(`maint-${k}`, l.setMaint, cx => this.act(cx, machine, { command: "focus", args: [p.id, "maint"] }), t, { small: true })))
        .when(Boolean(p.focus), x => x.child(this.button(`unfocus-${k}`, l.unfocus, cx => this.act(cx, machine, { command: "focus", args: [p.id, "none"] }), t, { small: true })))
        .when(!p.focus, x => x.child(this.button(`remove-${k}`, l.remove, cx => this.act(cx, machine, { command: "remove", args: [p.id] }), t, { small: true, danger: true })))));
  }

  /** The note form: short fields, the next action first. */
  form(row, t, l) {
    const k = keyOf(row.machine, row.p.id), e = this.editing;
    const field = f => h_flex().id(`field-${f}`).gap(10).items_center()
      .child(div().w(84).flex_none().text_size(11).text_color(t.dim).child(l[f]))
      .child(h_flex().flex_1().h(28).px(8).rounded(6).bg(t.raised).items_center().child(Input.new(this.inputs[f]).w_full().h_full().text_size(12).text_color(t.foreground)));
    return v_flex().id(`form-${k}`).gap(6).p(10).rounded(8).border_1().border_color(t.accent)
      .children(FIELDS.map(field))
      .child(h_flex().gap(6).items_center()
        .child(this.button("save-note", l.save, cx => this.saveNote(cx), t, { primary: true }))
        .child(this.button("draft-note", l.fromGit, cx => this.act(cx, row.machine, { command: "draft", args: [row.p.id] }, d => { if (d.state) this.inputs.state.set_value(d.state); }), t))
        .when(Boolean(e.verified), el => el.child(this.button("recheck", l.recheck, () => { e.recheck = !e.recheck; }, t, { active: e.recheck })))
        .child(this.button("cancel-note", l.cancel, () => { this.editing = null; }, t)));
  }

  render() {
    const t = theme(), l = copy(), rows = this.rows();
    const slot = where => {
      const mine = rows.filter(r => r.p.focus === where);
      return v_flex().id(`slot-${where}`).flex_1().min_w(0).gap(6)
        .child(div().text_size(11).font_semibold().text_color(where === "main" ? t.accent : t.muted).child(l[where]))
        .children(mine.map(r => this.card(r, t, l, true)))
        .when(mine.length === 0, el => el.child(div().id(`empty-${where}`).p(14).rounded(10).border_1().border_color(t.border).text_size(12).text_color(t.dim)
          .child(where === "main" ? l.emptyMain : l.emptyMaint)));
    };
    const others = rows.filter(r => !r.p.focus), total = this.groups.reduce((n, g) => n + g.projects.length, 0);
    return v_flex().id("nv-today").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12)
      .child(this.topBar(t, l))
      .when(Boolean(this.note), el => el.child(div().id("note").px(12).py(5).flex_none().text_size(11).text_color(t.muted).bg(t.surface).child(String(this.note))))
      .when(!this.loaded, el => el.child(div().id("loading").p(24).text_color(t.dim).child(l.loading)))
      .when(Boolean(this.loaded) && total === 0, el => el.child(v_flex().id("empty").flex_1().items_center().justify_center().gap(12).p(24).child(div().text_color(t.muted).child(l.empty))))
      .when(Boolean(this.loaded) && total > 0, el => el.child(v_flex().id("today-body").flex_1().min_h(0).p(12).gap(14).overflow_y_scrollbar()
        .child(h_flex().gap(12).items_start().child(slot("main")).child(slot("maint")))
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(11).font_semibold().text_color(t.muted).child(`${l.others} ${others.length}`))
          .child(this.button("toggle-all", this.showAll ? l.hide : l.show, () => { this.showAll = !this.showAll; localStorage.setItem("all", this.showAll ? "1" : "0"); }, t, { small: true })))
        .when(this.showAll, x => x.child(v_flex().id("others").gap(8).children(others.map(r => this.card(r, t, l, false)))))));
  }
}
