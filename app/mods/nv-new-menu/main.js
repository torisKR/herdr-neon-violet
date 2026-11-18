import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, theme, spaces, panes, focused, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared, settings } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";
const TEXT = {
  en: { terminal: "Terminal", start: "Start an agent", missing: "not installed", failed: "Could not check installed agents", checking: "Checking installed agents…", space: "New space", worktree: "New worktree…", openWorktree: "Open worktree…", tools: "Tools", agents: "ALL agents", devices: "Devices", prs: "Pull requests", focus: "Focus a terminal", browser: "Browser", opening: "Opening Browser…", code: "Code highlighting", shortcuts: "Keyboard shortcuts", usage: "AI usage" },
  ja: { terminal: "ターミナル", start: "エージェントを起動", missing: "未インストール", failed: "エージェントを確認できません", checking: "エージェントを確認中…", space: "新しいスペース", worktree: "作業ツリーを作成…", openWorktree: "作業ツリーを開く…", tools: "ツール", agents: "全エージェント", devices: "デバイス", prs: "プルリクエスト", focus: "ターミナルを選択", browser: "ブラウザー", opening: "ブラウザーを起動中…", code: "コードハイライト", shortcuts: "ショートカット一覧", usage: "AI使用量" },
  zh: { terminal: "终端", start: "启动智能体", missing: "未安装", failed: "无法检查已安装的智能体", checking: "正在检查智能体…", space: "新建空间", worktree: "新建工作树…", openWorktree: "打开工作树…", tools: "工具", agents: "全部智能体", devices: "设备", prs: "拉取请求", focus: "请选择终端", browser: "浏览器", opening: "正在打开浏览器…", code: "代码高亮", shortcuts: "快捷键列表", usage: "AI用量" },
  ko: { terminal: "터미널", start: "에이전트 시작", missing: "미설치", failed: "설치된 에이전트를 확인하지 못했습니다", checking: "설치된 에이전트 확인 중…", space: "새 공간", worktree: "새 작업 트리…", openWorktree: "작업 트리 열기…", tools: "도구", agents: "전체 에이전트", devices: "기기 목록", prs: "풀 리퀘스트", focus: "터미널을 선택하세요", browser: "브라우저", opening: "브라우저 여는 중…", code: "코드 하이라이팅", shortcuts: "단축키 모음", usage: "AI 사용량" },
};
const language = value => {
  const key = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(TEXT, key) ? key : null;
};
const copy = () => TEXT[language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en"];

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
    this.agents = (shared(KNOWN)?.[where] ?? []).filter(a => a.key !== "herdr-web-browser");
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async cx => {
      try {
        this.agents = (await knownAgents({ on: machine })).filter(a => a.key !== "herdr-web-browser");
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

  browser() {
    closeOverlay(props().overlay);
    // Same as the shortcut: Chromium on this computer (a live view on Windows), opened or closed.
    openOverlay({ mod: "nv-browser", kind: "dialog", width: 460, height: 160 });
  }

  render() {
    const t = theme(), l = copy();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(680, 450 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), l.terminal, () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child(l.start))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : l.missing, a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? l.failed : l.checking))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), l.space, () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), l.worktree, () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), l.openWorktree, () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)))
      // neon-violet tools
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(div().px(9).pt(2).pb(4).text_size(11).text_color(t.dim).child(l.tools))
      .child(this.row("nv-all-agents", div().w(14).text_color(t.accent).child("▦"), l.agents, () => this.allAgents(), shortcut("mod.open:nv-toggle-agents") || shortcut("layout.switch:all-agents")))
      .child(this.row("nv-devices", div().w(14).text_color(t.done).child("▣"), l.devices, () => run("mod.open", { name: "devices" }), shortcut("mod.open:devices")))
      .child(this.row("nv-code", div().w(14).text_color(t.accent).child("⌘"), l.code, () => run("mod.open", { name: "nv-code" }), shortcut("mod.open:nv-code")))
      .child(this.row("nv-shortcuts", div().w(14).text_color(t.muted).child("⌨"), l.shortcuts, () => run("mod.open", { name: "nv-shortcuts" }), shortcut("mod.open:nv-shortcuts")))
      .child(this.row("nv-usage", div().w(14).text_color(t.done).child("◔"), l.usage, () => run("mod.open", { name: "nv-usage" }), shortcut("mod.open:nv-usage")))
      .child(this.row("nv-prs", div().w(14).text_color(t.working).child("⇄"), l.prs,
        () => this.launch({ mod: "prs", props: { cwd: this.source.cwd, on: this.source.on } }), this.source.cwd ? shortcut("mod.open:nv-toggle-prs") : l.focus, Boolean(this.source.cwd)))
      .child(this.row("nv-browser", div().w(14).text_color(t.idle).child("◎"), this.browserBusy ? l.opening : l.browser,
        cx => this.browser(cx), shortcut("mod.open:nv-browser"), !this.browserBusy && Boolean(this.source.pane || this.source.space), false))
      .when(Boolean(this.browserError), el => el.child(div().px(9).py(6).text_color(t.blocked).child(this.browserError)));
  }
}
