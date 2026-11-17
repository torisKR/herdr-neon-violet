// To-do — what you asked your agents to do, and whether it is done yet.
//
// A floating block (top right by default; drag it anywhere). Items come from the shared
// list that `nv todo` keeps on each machine: Claude Code adds one per instruction and checks
// it when the turn ends, Codex checks its own, and you can add, check and remove items here.
// The list of every connected machine is shown, so work running on your Mac shows up
// in a window on another computer.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, checking, exec, machines, notify, theme, window as win } from "herdr";

const WIDTHS = [260, 340, 440, 560];
const HEIGHTS = [140, 240, 380, 560];
const quote = (a) => `'${String(a).replace(/'/g, `'\\''`)}'`;
const stored = (key, fallback) => {
  const n = Number(localStorage.getItem(key));
  return Number.isInteger(n) && n >= 0 && n < 4 && localStorage.getItem(key) !== null ? n : fallback;
};

export default class Todos extends View {
  init(_props, cx) {
    this.items = [];
    this.known = null; // id -> done, to notice changes between refreshes
    this.missing = false;
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

  chip(id, text, t, onClick) {
    return div().id(id).px(6).py(1).rounded(5).text_size(11).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .child(text);
  }

  row(it, t) {
    const key = `${it.on ?? "local"}-${it.id}`;
    const color = it.source === "claude" ? t.accent : it.source === "codex" ? t.idle : t.muted;
    return h_flex().id(`todo-${key}`).gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.change(cx, ["toggle", it.id], it.on))
      .child(div().flex_none().w(14).h(14).rounded(4).border_1().border_color(it.done ? t.done : t.input)
        .when(it.done, (e) => e.bg(t.done)).flex().items_center().justify_center()
        .text_size(10).text_color(t.background).child(it.done ? "✓" : ""))
      .child(div().flex_1().min_w(0).truncate().text_color(it.done ? t.dim : t.foreground).child(it.text))
      .child(div().flex_none().text_size(10).text_color(color).child(it.on ? `${it.source} · ${it.on}` : it.source))
      .child(div().id(`todo-rm-${key}`).flex_none().px(4).rounded(4).text_color(t.dim).hover((s) => s.bg(t.raised).text_color(t.blocked))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.change(cx, ["rm", it.id], it.on); })
        .child("×"));
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
