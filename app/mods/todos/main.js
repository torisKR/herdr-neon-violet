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
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, checking, exec, machines, nextCommand, notify, panes, run, theme, window as win } from "herdr";

const WIDTHS = [260, 340, 440, 560];
const HEIGHTS = [160, 280, 420, 600];
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
const span = (secs) => {
  if (secs < 60) return `${Math.max(1, Math.round(secs))}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
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
    this.input = InputState.new({ placeholder: "Add a to-do" });
    this.input.on("change", () => { this.text = this.input.value(); });
    this.input.on("submit", (_e, cx) => this.add(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (checking()) return;
    // keys.json: "todos.details" opens (or closes) the details of the newest open item
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "details") {
          const first = this.items.find((it) => !it.done) ?? this.items[0];
          const key = first ? `${first.on ?? "local"}-${first.id}` : null;
          this.open = this.open === key ? null : key;
          cx.notify();
        }
      }
    });
    cx.timer.every(4000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Runs `nv todo ...` here, or on another machine through its shell.
  nv(args, on) {
    if (on) return exec("sh", ["-c", `"$HOME/.config/herdr-app/bin/nv" todo ${args.map(quote).join(" ")}`], { on, timeout: 15000 });
    return exec(`${appHome()}/bin/nv${win().platform === "windows" ? ".exe" : ""}`, ["todo", ...args], { timeout: 15000 });
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const names = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
        const lists = await Promise.all([...new Set(names)].map(async (on) => {
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
              notify({ title: "To-do done", body: it.text, level: "success", timeout: 6000 });
            }
          }
        }
        this.known = new Map(items.map((it) => [`${it.on}/${it.id}`, Boolean(it.done)]));
        this.items = items.sort((a, b) => Number(a.done) - Number(b.done) || (b.done ? b.done_at - a.done_at : b.created - a.created));
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  change(cx, args, on) {
    cx.spawn(async (cx) => {
      try { await this.nv(args, on); } catch {}
      this.refresh(cx);
    });
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
    return div().id(id).px(6).py(1).rounded(5).text_size(11).text_color(color ?? t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(text);
  }

  details(it, key, t) {
    const pane = this.agentOf(it);
    const folder = it.cwd ? String(it.cwd).replace(/\\/g, "/").replace(/\/+$/, "").split("/").slice(-2).join("/") : "";
    const when = it.done && it.done_at
      ? `${clock(it.created)} → ${clock(it.done_at)} · took ${span(it.done_at - it.created)}`
      : `started ${clock(it.created)} · ${span(Date.now() / 1000 - it.created)} so far`;
    const full = it.detail && it.detail !== it.text ? it.detail : it.text;
    return v_flex().mx(6).mb(4).p(8).gap(6).rounded(6).bg(t.surface).border_1().border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().id(`todo-full-${key}`).max_h(180).overflow_y_scrollbar().text_size(12).text_color(t.foreground).child(full))
      .child(v_flex().gap(2).text_size(10).text_color(t.dim)
        .child(div().child(`${it.source === "me" ? "added by you" : `asked ${it.source}`}${it.on ? ` on ${it.on}` : ""}${folder ? ` · ${folder}` : ""}`))
        .child(div().child(when))
        .when(Boolean(pane?.title), (e) => e.child(div().truncate().child(`agent is on: ${pane.title}`))))
      .child(h_flex().gap(4)
        .when(Boolean(pane), (e) => e.child(this.chip(`todo-go-${key}`, "Go to agent", t, () => run("agent.focus", { terminal: pane.terminal }), t.accent)))
        .child(this.chip(`todo-toggle-${key}`, it.done ? "Reopen" : "Mark done", t, (cx) => this.change(cx, ["toggle", it.id], it.on), it.done ? t.muted : t.done))
        .child(div().flex_1())
        .child(this.chip(`todo-remove-${key}`, "Remove", t, (cx) => { this.open = null; this.change(cx, ["rm", it.id], it.on); }, t.blocked)));
  }

  row(it, t) {
    const key = `${it.on ?? "local"}-${it.id}`;
    const color = it.source === "claude" ? t.accent : it.source === "codex" ? t.idle : t.muted;
    const opened = this.open === key;
    const line = h_flex().id(`todo-${key}`).gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer()
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
      .child(div().flex_1().min_w(0).truncate().text_color(it.done ? t.dim : t.foreground).child(it.text))
      .child(div().flex_none().text_size(10).text_color(color).child(it.on ? `${it.source} · ${it.on}` : it.source))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(opened ? "▾" : "▸"));
    return opened ? v_flex().gap(2).child(line).child(this.details(it, key, t)) : line;
  }

  render() {
    const t = theme();
    const open = this.items.filter((it) => !it.done).length;
    const done = this.items.length - open;
    return v_flex().w(WIDTHS[this.w]).p(10).gap(6).text_size(12).text_color(t.foreground)
      .child(h_flex().gap(6).items_center()
        .child(div().font_semibold().text_size(13).text_color(t.accent).child("To-do"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(open ? t.working : t.border).text_size(10)
          .text_color(open ? t.working : t.muted).child(`${open} open`))
        .child(div().flex_1())
        .child(this.chip("todos-w", "↔", t, (cx) => this.resize("w", cx)))
        .child(this.chip("todos-h", "↕", t, (cx) => this.resize("h", cx)))
        .child(this.chip("todos-fold", this.collapsed ? "+" : "–", t, (cx) => {
          this.collapsed = !this.collapsed;
          localStorage.setItem("collapsed", this.collapsed ? "1" : "0");
          cx.notify();
        })))
      .when(!this.collapsed, (el) => el
        .child(v_flex().id("todos-list").max_h(HEIGHTS[this.h]).overflow_y_scrollbar().gap(1)
          .children(this.items.map((it) => this.row(it, t)))
          .when(!this.items.length, (e) => e.child(div().px(6).py(8).text_color(t.dim)
            .child(this.missing ? "nv is not installed here yet. Run the installer of herdr-neon-violet." : "Nothing yet. Tell Claude or Codex what to do, or add one below."))))
        .child(h_flex().gap(6).items_center()
          .child(div().id("todos-input").flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1()
            .border_color(this.typing ? t.accent : t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .when(done > 0, (e) => e.child(this.chip("todos-clear", `Clear ${done} done`, t, (cx) => {
            for (const on of new Set(this.items.filter((it) => it.done).map((it) => it.on))) this.change(cx, ["clear-done"], on);
          })))));
  }
}
