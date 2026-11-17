// To-do — what you asked your agents to do, and whether it is done yet.
//
// A floating block (top right by default; drag it anywhere). Items come from the shared
// list that `nv todo` keeps on each machine: Claude Code and Codex add one per instruction
// and check it when the turn ends, and you can add, check and remove items here.
// Each row shows a short headline; click it for the details: the whole instruction,
// where it runs, when it started and finished, and a button that takes you to the agent.
// The list of every connected machine is shown, so work running on your Mac shows up
// in a window on another computer.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { appHome, checking, exec, machines, nextCommand, notify, panes, run, settings, theme, window as win } from "herdr";

const WIDTHS = [260, 340, 440, 560];
const HEIGHTS = [160, 280, 420, 600];
const priority = (item) => Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 3 ? item.priority : 2;
const compare = (a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done))
  || (a.done ? (b.done_at ?? b.created) - (a.done_at ?? a.created) : priority(a) - priority(b) || b.created - a.created);
const LANGUAGES = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
const language = (value) => {
  const code = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGES, code) ? code : null;
};
const TEXT = {
  en: {
    title: "To-do", add: "Add a to-do", completed: "To-do done",
    auto: "Follow Herdr", open: (n) => `${n} open`, clear: (n) => `Clear ${n} done`,
    missing: "nv is not installed here yet. Run the installer of herdr-neon-violet.",
    empty: "Nothing yet. Tell Claude or Codex what to do, or add one below.",
    you: "you", added: "added by you", asked: (agent) => `asked ${agent}`, on: (name) => ` on ${name}`,
    agent: (title) => `agent is on: ${title}`, go: "Go to agent", reopen: "Reopen", done: "Mark done", remove: "Remove",
    finished: (start, end, duration) => `${start} → ${end} · took ${duration}`,
    started: (start, duration) => `started ${start} · ${duration} so far`,
    units: ["s", "m", "h"],
    priority: "Priority", priorities: ["Urgent", "High", "Normal", "Low"], autoPriority: "Auto", failed: "Could not update to-do",
  },
  ko: {
    title: "할 일", add: "할 일 추가", completed: "할 일 완료",
    auto: "Herdr 설정 따르기", open: (n) => `진행 ${n}개`, clear: (n) => `완료 ${n}개 지우기`,
    missing: "nv가 설치되어 있지 않습니다. herdr-neon-violet 설치 프로그램을 실행하세요.",
    empty: "아직 할 일이 없습니다. Claude나 Codex에게 작업을 요청하거나 아래에서 추가하세요.",
    you: "나", added: "직접 추가함", asked: (agent) => `${agent}에게 요청함`, on: (name) => ` · ${name}에서`,
    agent: (title) => `에이전트 위치: ${title}`, go: "에이전트로 이동", reopen: "다시 열기", done: "완료 처리", remove: "삭제",
    finished: (start, end, duration) => `${start} → ${end} · ${duration} 소요`,
    started: (start, duration) => `${start} 시작 · ${duration} 경과`,
    units: ["초", "분", "시간"],
    priority: "우선순위", priorities: ["긴급", "높음", "보통", "낮음"], autoPriority: "자동", failed: "할 일을 변경하지 못했습니다",
  },
  ja: {
    title: "やること", add: "やることを追加", completed: "やることが完了",
    auto: "Herdrの設定に従う", open: (n) => `未完了 ${n}件`, clear: (n) => `完了 ${n}件を削除`,
    missing: "nvがまだインストールされていません。herdr-neon-violetのインストーラーを実行してください。",
    empty: "まだありません。ClaudeやCodexに作業を依頼するか、下から追加してください。",
    you: "自分", added: "自分で追加", asked: (agent) => `${agent}に依頼`, on: (name) => ` · ${name}で実行`,
    agent: (title) => `エージェントの場所: ${title}`, go: "エージェントへ", reopen: "再開", done: "完了にする", remove: "削除",
    finished: (start, end, duration) => `${start} → ${end} · 所要時間 ${duration}`,
    started: (start, duration) => `${start} 開始 · ${duration} 経過`,
    units: ["秒", "分", "時間"],
    priority: "優先度", priorities: ["緊急", "高", "通常", "低"], autoPriority: "自動", failed: "やることを更新できませんでした",
  },
  zh: {
    title: "待办", add: "添加待办事项", completed: "待办已完成",
    auto: "跟随 Herdr 设置", open: (n) => `待办 ${n}项`, clear: (n) => `清除 ${n}项已完成`,
    missing: "尚未安装 nv。请运行 herdr-neon-violet 安装程序。",
    empty: "暂无待办事项。请让 Claude 或 Codex 执行任务，或在下方添加。",
    you: "我", added: "自己添加", asked: (agent) => `已委托 ${agent}`, on: (name) => ` · 在 ${name} 上运行`,
    agent: (title) => `智能体位置：${title}`, go: "前往智能体", reopen: "重新打开", done: "标为完成", remove: "删除",
    finished: (start, end, duration) => `${start} → ${end} · 用时 ${duration}`,
    started: (start, duration) => `${start} 开始 · 已过 ${duration}`,
    units: ["秒", "分", "小时"],
    priority: "优先级", priorities: ["紧急", "高", "普通", "低"], autoPriority: "自动", failed: "无法更新待办事项",
  },
};
const quote = (a) => `'${String(a).replace(/'/g, `'\\''`)}'`;
const stored = (key, fallback) => {
  const raw = localStorage.getItem(key), n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 0 && n < 4 ? n : fallback;
};
const same = (a, b) => {
  const norm = (s) => String(s ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
};
const clock = (secs) => {
  if (!secs) return "";
  const d = new Date(secs * 1000), pad = (n) => String(n).padStart(2, "0");
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const span = (secs, l) => {
  const [s, m, h] = l.units;
  if (secs < 60) return `${Math.max(1, Math.round(secs))}${s}`;
  if (secs < 3600) return `${Math.round(secs / 60)}${m}`;
  return `${Math.floor(secs / 3600)}${h} ${Math.round((secs % 3600) / 60)}${m}`;
};

export default class Todos extends View {
  init(_props, cx) {
    this.items = [];
    this.known = null; // id -> done, to notice changes between refreshes
    this.missing = false;
    this.open = null; // the row whose details are shown
    this.text = "";
    this.w = stored("w", 1);
    this.h = stored("h", 1);
    this.collapsed = localStorage.getItem("collapsed") === "1";
    this.language = language(localStorage.getItem("language")) ?? "auto";
    this.languageMenu = false;
    this.localizing = new Set();
    this.localized = new Set();
    this.localizationRetry = new Map();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new();
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.add(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (checking()) return;
    // keys.json: "todos.details" opens (or closes) the details of the newest open item, "todos.fold" folds the list
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("language:")) {
          this.setLanguage(command.slice("language:".length), cx);
        } else if (command === "details") {
          const first = this.items.find((it) => !it.done) ?? this.items[0];
          const key = first ? `${first.on ?? "local"}-${first.id}` : null;
          this.open = this.open === key ? null : key;
        } else if (command === "fold") {
          this.collapsed = !this.collapsed;
          localStorage.setItem("collapsed", this.collapsed ? "1" : "0");
        } else if (command === "top" || command === "bottom") {
          this.jump(command === "bottom", cx);
        }
        cx.notify();
      }
    });
    cx.timer.every(4000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  locale() {
    const s = settings();
    return language(this.language) ?? language(s.language) ?? language(s.locale) ?? "en";
  }

  setLanguage(value, cx) {
    if (value !== "auto" && !Object.hasOwn(LANGUAGES, value)) return;
    this.language = value;
    this.languageMenu = false;
    this.localized.clear();
    localStorage.setItem("language", value);
    if (!checking()) this.refresh(cx);
    cx.notify();
  }

  headline(it) {
    const title = it.source !== "me" ? it.titles?.[this.locale()] : null;
    return typeof title === "string" && title.trim() ? title : it.text;
  }

  // Runs `nv todo ...` here, or on another machine through its shell.
  nv(args, on, timeout = 15000) {
    if (on) return exec("sh", ["-c", `"$HOME/.config/herdr-app/bin/nv" todo ${args.map(quote).join(" ")}`], { on, timeout });
    return exec(`${appHome()}/bin/nv${win().platform === "windows" ? ".exe" : ""}`, ["todo", ...args], { timeout });
  }

  localize(cx, on) {
    if (checking()) return;
    const locale = this.locale(), key = JSON.stringify([on, locale]);
    const missing = this.items.some(it => (it.on ?? null) === on && it.source !== "me"
      && (typeof it.titles?.[locale] !== "string" || !it.titles[locale].trim()));
    if (this.localizing.has(key) || Date.now() < (this.localizationRetry.get(key) ?? 0) || (this.localized.has(key) && !missing)) return;
    this.localizing.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await this.nv(["localize", locale], on, 120000);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        const result = JSON.parse(r.stdout);
        this.localized.add(key);
        if (result.disabled || (missing && !result.translated && !result.busy)) this.localizationRetry.set(key, Date.now() + 60000);
        if (result.translated) this.refresh(cx);
      } catch (error) {
        this.localizationRetry.set(key, Date.now() + 60000);
        notify({ title: TEXT[this.locale()].failed, body: String(error.message ?? error), level: "error" });
      } finally {
        this.localizing.delete(key);
        cx.notify();
      }
    });
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const names = [...new Set([null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)])];
        const lists = await Promise.all(names.map(async (on) => {
          try {
            const r = await this.nv(["list", "--json"], on);
            if (r.code !== 0) throw new Error(r.stderr);
            return JSON.parse(r.stdout).items.map((item) => ({ ...item, on }));
          } catch {
            if (on === null) this.missing = true;
            return null;
          }
        }));
        if (lists[0] !== null) this.missing = false;
        const items = lists.flatMap((l) => l ?? []);
        // Tell the person when an agent's item gets checked.
        if (this.known) {
          for (const it of items) {
            if (it.done && this.known.get(`${it.on}/${it.id}`) === false && it.source !== "me") {
              notify({ title: TEXT[this.locale()].completed, body: this.headline(it), level: "success", timeout: 6000 });
            }
          }
        }
        this.known = new Map(items.map((it) => [`${it.on}/${it.id}`, Boolean(it.done)]));
        this.items = items.sort(compare);
        const locale = this.locale();
        if (this.titleLanguage !== locale) { this.titleLanguage = locale; this.localized.clear(); }
        names.forEach((on, i) => { if (lists[i] !== null) this.localize(cx, on); });
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  change(cx, args, on) {
    cx.spawn(async (cx) => {
      try {
        const result = await this.nv(args, on);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      } catch (error) {
        notify({ title: TEXT[this.locale()].failed, body: String(error.message ?? error), level: "error" });
      }
      this.refresh(cx);
    });
  }

  jump(bottom, cx) {
    if (this.items.length) this.scroll.scroll_to_item(bottom ? this.items.length - 1 : 0);
    cx.notify();
  }

  priorityColor(it, t) {
    return it.done ? t.dim : [t.blocked, t.working, t.muted, t.dim][priority(it)];
  }

  add(cx) {
    const text = this.text.trim();
    if (!text) return;
    this.text = "";
    this.input.set_value("");
    this.change(cx, ["add", "--source", "me", text], null);
  }

  resize(key, cx) {
    this[key] = (this[key] + 1) % 4;
    localStorage.setItem(key, String(this[key]));
    cx.notify();
  }

  // The agent terminal an item came from: an agent pane in the same folder on the same machine.
  agentOf(it) {
    if (it.source === "me" || !it.cwd) return null;
    const machine = (terminal) => (terminal?.includes("/") ? terminal.split("/")[0] : null);
    return panes().find((p) => p.terminal && p.program?.agent && machine(p.terminal) === (it.on ?? null) && same(p.cwd, it.cwd)) ?? null;
  }

  chip(id, text, t, onClick, color) {
    return div().id(id).flex_none().px(6).py(1).rounded(5).text_size(11).text_color(color ?? t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(text);
  }

  details(it, key, t) {
    const l = TEXT[this.locale()];
    const pane = this.agentOf(it);
    const folder = it.cwd ? String(it.cwd).replace(/\\/g, "/").replace(/\/+$/, "").split("/").slice(-2).join("/") : "";
    const when = it.done && it.done_at
      ? l.finished(clock(it.created), clock(it.done_at), span(it.done_at - it.created, l))
      : l.started(clock(it.created), span(Date.now() / 1000 - it.created, l));
    const full = it.detail && it.detail !== it.text ? it.detail : it.text;
    return v_flex().flex_none().mx(6).mb(4).p(8).gap(6).rounded(6).bg(t.surface).border_1().border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().id(`todo-full-${key}`).flex_none().max_h(180).overflow_y_scrollbar().text_size(12).text_color(t.foreground).child(full))
      .child(v_flex().gap(2).text_size(10).text_color(t.dim)
        .child(div().child(`${it.source === "me" ? l.added : l.asked(it.source)}${it.on ? l.on(it.on) : ""}${folder ? ` · ${folder}` : ""}`))
        .child(div().child(when))
        .when(Boolean(pane?.title), (e) => e.child(div().truncate().child(l.agent(pane.title)))))
      .child(v_flex().flex_none().gap(3)
        .child(div().text_size(10).text_color(t.muted).child(l.priority))
        .child(h_flex().flex_wrap().gap(3)
          .children(l.priorities.map((label, p) => this.chip(`todo-priority-${key}-${p}`, `${priority(it) === p ? "✓ " : ""}P${p} ${label}`, t,
            (cx) => this.change(cx, ["priority", it.id, String(p)], it.on), priority(it) === p ? this.priorityColor(it, t) : t.muted)))
          .child(this.chip(`todo-priority-${key}-auto`, `${it.priority_auto !== false ? "✓ " : ""}${l.autoPriority}`, t,
            (cx) => this.change(cx, ["priority", it.id, "auto"], it.on)))))
      .child(h_flex().gap(4)
        .when(Boolean(pane), (e) => e.child(this.chip(`todo-go-${key}`, l.go, t, () => run("agent.focus", { terminal: pane.terminal }), t.accent)))
        .child(this.chip(`todo-toggle-${key}`, it.done ? l.reopen : l.done, t, (cx) => this.change(cx, ["toggle", it.id], it.on), it.done ? t.muted : t.done))
        .child(div().flex_1())
        .child(this.chip(`todo-remove-${key}`, l.remove, t, (cx) => { this.open = null; this.change(cx, ["rm", it.id], it.on); }, t.blocked)));
  }

  row(it, t) {
    const source = it.source === "me" ? TEXT[this.locale()].you : it.source;
    const key = `${it.on ?? "local"}-${it.id}`;
    const color = it.source === "claude" ? t.accent : it.source === "codex" ? t.idle : t.muted;
    const opened = this.open === key;
    const important = !it.done && priority(it) < 2;
    const line = h_flex().id(`todo-${key}`).flex_none().h(30).gap(6).px(6).py(4).rounded(6).items_center().cursor_pointer()
      .when(important, (e) => e.border_l(2).border_color(this.priorityColor(it, t)))
      .when(opened, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.open = opened ? null : key; cx.notify(); })
      // the box checks the item; the rest of the row opens its details
      .child(div().id(`todo-box-${key}`).flex_none().w(14).h(14).rounded(4).border_1().border_color(it.done ? t.done : t.input)
        .when(it.done, (e) => e.bg(t.done)).flex().items_center().justify_center()
        .text_size(10).text_color(t.background)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.change(cx, ["toggle", it.id], it.on); })
        .child(it.done ? "✓" : ""))
      .child(this.chip(`todo-priority-${key}`, `P${priority(it)}`, t,
        (cx) => this.change(cx, ["priority", it.id, String((priority(it) + 3) % 4)], it.on), this.priorityColor(it, t)))
      .child(div().flex_1().min_w(0).truncate().when(important, (e) => e.font_semibold())
        .text_color(important ? this.priorityColor(it, t) : it.done ? t.dim : t.foreground).child(this.headline(it)))
      .child(div().flex_none().max_w(80).truncate().text_size(10).text_color(color).child(it.on ? `${source} · ${it.on}` : source))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(opened ? "▾" : "▸"));
    return opened ? v_flex().flex_none().gap(2).child(line).child(this.details(it, key, t)) : line;
  }

  render() {
    const t = theme();
    const locale = this.locale(), l = TEXT[locale];
    const open = this.items.filter((it) => !it.done).length;
    const done = this.items.length - open;
    return v_flex().w(WIDTHS[this.w]).p(10).gap(6).text_size(12).text_color(t.foreground)
      .child(h_flex().gap(4).items_center()
        .child(div().font_semibold().text_size(13).text_color(t.accent).child(l.title))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(open ? t.working : t.border).text_size(10)
          .text_color(open ? t.working : t.muted).child(l.open(open)))
        .child(div().flex_1())
        .child(this.chip("todos-language", "文", t, (cx) => {
          this.languageMenu = !this.languageMenu;
          cx.notify();
        }))
        .child(this.chip("todos-w", "↔", t, (cx) => this.resize("w", cx)))
        .child(this.chip("todos-h", "↕", t, (cx) => this.resize("h", cx)))
        .child(this.chip("todos-fold", this.collapsed ? "+" : "–", t, (cx) => {
          this.collapsed = !this.collapsed;
          localStorage.setItem("collapsed", this.collapsed ? "1" : "0");
          cx.notify();
        })))
      .when(this.languageMenu, (el) => el.child(v_flex().gap(2)
        .children([["auto", l.auto], ...Object.entries(LANGUAGES)].map(([code, label]) =>
          this.chip(`todos-language-${code}`, `${this.language === code ? "✓ " : ""}${label}`, t,
            (cx) => this.setLanguage(code, cx), this.language === code ? t.accent : t.muted)))))
      .when(!this.collapsed, (el) => el
        .child(v_flex().id("todos-list").flex_none().min_h(0).h(HEIGHTS[this.h]).overflow_y_scrollbar().track_scroll(this.scroll).gap(1)
          .children(this.items.map((it) => this.row(it, t)))
          .when(!this.items.length, (e) => e.child(div().px(6).py(8).text_color(t.dim)
            .child(this.missing ? l.missing : l.empty))))
        .child(h_flex().gap(6).items_center()
          .child(this.chip("todos-top", "↑", t, (cx) => this.jump(false, cx)))
          .child(this.chip("todos-bottom", "↓", t, (cx) => this.jump(true, cx)))
          .child(div().id("todos-input").relative().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1()
            .border_color(this.typing ? t.accent : t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .when(!this.text, (e) => e.child(div().id("todos-placeholder").absolute().left(8).text_color(t.dim).child(l.add)))
            .child(Input.new(this.input).w_full().h_full().text_size(12).text_color(t.foreground)))
          .when(done > 0, (e) => e.child(this.chip("todos-clear", l.clear(done), t, (cx) => {
            for (const on of new Set(this.items.filter((it) => it.done).map((it) => it.on))) this.change(cx, ["clear-done"], on);
          })))));
  }
}
