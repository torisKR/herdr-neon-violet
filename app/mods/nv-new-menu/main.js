import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, theme, spaces, panes, focused, knownAgents, exec, run, openOverlay, closeOverlay, props, window, keys, shared, setShared, appHome } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const space = spaces().find(s => s.active), f = focused();
    this.source = props()?.source ?? { cwd: f?.cwd ?? null, pane: f?.pane ?? null, space: f?.space ?? space?.id,
      on: f?.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null };
    const machine = this.source.on;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true, close = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click((_e, cx) => { if (enabled) { if (close) closeOverlay(props().overlay); action(cx); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }

  allAgents() {
    const origin = shared("layout");
    if (typeof origin === "string" && origin !== "all-agents") setShared("all-agents.return-layout", origin);
    run("layout.switch", { name: "all-agents" });
  }

  launch(options) {
    if (this.source.pane) run("pane.split", { direction: "right", pane: this.source.pane, ...options });
    else if (this.source.space) run("tab.new", { space: this.source.space, ...options });
  }

  browser(cx) {
    if (this.browserBusy) return;
    this.browserBusy = true; this.browserError = null;
    cx.spawn(async cx => {
      try {
        let path = `${appHome()}/bin/nv${window()?.platform === "windows" ? ".exe" : ""}`;
        if (this.source.on) {
          const options = { on: this.source.on, timeout: 10000 };
          let r;
          try {
            r = await exec("sh", ["-c", 'p="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/bin/nv"; test -x "$p" && printf "%s" "$p"'], options);
          } catch (e) {
            if (!String(e).includes("cannot start sh: program not found")) throw e;
            r = await exec("powershell", ["-NoProfile", "-Command", '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $root = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config/herdr-app" }; $p = Join-Path $root "bin/nv.exe"; if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { exit 1 }; [Console]::Write($p)'], options);
          }
          if (r.code !== 0 || !r.stdout.trim()) throw new Error("nv is not installed on this machine");
          path = r.stdout.trim();
        }
        closeOverlay(props().overlay);
        this.launch({ argv: [path, "browse"] });
      } catch (e) { this.browserError = `Cannot open Browser: ${e.message ?? e}`; }
      finally { this.browserBusy = false; cx.notify(); }
    });
    cx.notify();
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(680, 356 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)))
      // neon-violet tools
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(div().px(9).pt(2).pb(4).text_size(11).text_color(t.dim).child("Tools"))
      .child(this.row("nv-all-agents", div().w(14).text_color(t.accent).child("▦"), "ALL agents", () => this.allAgents(), shortcut("layout.switch:all-agents")))
      .child(this.row("nv-devices", div().w(14).text_color(t.done).child("▣"), "Devices", () => run("mod.open", { name: "devices" }), shortcut("mod.open:devices")))
      .child(this.row("nv-prs", div().w(14).text_color(t.working).child("⇄"), "Pull requests",
        () => this.launch({ mod: "prs", props: { cwd: this.source.cwd, on: this.source.on } }), this.source.cwd ? "" : "Focus a terminal", Boolean(this.source.cwd)))
      .child(this.row("nv-browser", div().w(14).text_color(t.idle).child("◎"), this.browserBusy ? "Opening Browser…" : "Browser",
        cx => this.browser(cx), "", !this.browserBusy && Boolean(this.source.pane || this.source.space), false))
      .when(Boolean(this.browserError), el => el.child(div().px(9).py(6).text_color(t.blocked).child(this.browserError)));
  }
}
