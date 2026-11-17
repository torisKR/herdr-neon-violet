import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const plain = value => JSON.parse(JSON.stringify(value));
const ok = value => ({ code: 0, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" });
const sha = "a".repeat(40), newerSha = "b".repeat(40);
const pr = number => ({ number, state: "OPEN", mergeable: "MERGEABLE", headRefOid: sha, isDraft: false });

function element() {
  const data = { items: [], events: {}, styles: {} };
  let proxy;
  proxy = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    if (key === "id") return id => { data.name = id; return proxy; };
    if (key === "child") return child => { data.items.push(child); return proxy; };
    if (key === "children") return children => { data.items.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key.startsWith("on_")) return fn => { data.events[key] = fn; return proxy; };
    return (...args) => { data.styles[key] = args; return proxy; };
  } });
  return proxy;
}
const find = (node, id) => node && typeof node === "object"
  ? node.name === id ? node : node.items?.map(child => find(child, id)).find(Boolean) : null;
const textOf = node => typeof node === "string" ? node : node?.items?.map(textOf).join("\n") ?? "";

for (const [locale, title] of [["ko-KR", "AI 사용량"], ["en-US", "AI usage"], ["ja", "AI使用量"], ["zh-CN", "AI用量"]]) {
  test(`usage panel and launcher follow ${locale}`, () => {
    const overrides = { settings: () => ({ language: locale }) };
    const menu = harness("nv-new-menu", overrides), usage = harness("nv-usage", overrides);
    assert.ok(textOf(usage.view.render()).includes(title));
    const item = find(menu.view.render(), "nv-usage");
    assert.ok(textOf(item).includes(title));
    item.events.on_click({}, menu.cx);
    assert.deepEqual(menu.calls, [{ name: "mod.open", args: { name: "nv-usage" } }]);
  });
}

test("usage reports unavailable quotas and unknown prices without fabricated zeroes", () => {
  const h = harness("nv-usage", { settings: () => ({ language: "ko" }) });
  h.view.groups = [{ machine: null, data: { days: 1, timezone: "Asia/Seoul", history: {
    available: true, providers: [{ agent: "codex", total: 150, costUsd: null, models: [{ name: "unpriced", input: 50, output: 100, cache: 0, costUsd: null }] }],
  }, quotas: { claude: { available: false, error: "Sign-in unavailable" } } } }];
  const text = textOf(h.view.render());
  assert.ok(text.includes("150 토큰"));
  assert.ok(text.includes("API 환산 추정 USD —"));
  assert.ok(text.includes("Sign-in unavailable"));
  assert.ok(!text.includes("0% 남음"));
  assert.ok(!text.includes("$0.00"));
});

test("changing usage periods discards stale scans and reuses fresh account quotas", async () => {
  const first = deferred(), state = new Map(), scans = [];
  const report = days => ({ version: 1, days, timezone: "Asia/Seoul", history: { available: true, noRecords: true }, quotas: { codex: { available: true, windows: [] } } });
  const h = harness("nv-usage", {
    shared: k => state.get(k), setShared: (k, v) => state.set(k, v),
    readTextFile: async () => "// collector source",
    exec: async (_cmd, args) => {
      if (args[0] === "-p") return ok("Asia/Seoul");
      scans.push(args.at(-1));
      return scans.length === 1 ? first.promise : ok(report(7));
    },
  });
  h.view.refresh(h.cx); await h.settle();
  h.view.selectDays(7, h.cx);
  assert.equal(h.view.groups.length, 0);
  first.resolve(ok(report(1))); await h.settle();
  assert.equal(scans.length, 2);
  assert.ok(scans[1].includes('"days":7'));
  assert.ok(scans[1].includes('"skipQuotas":true'));
  assert.equal(h.view.groups[0].data.days, 7);
  assert.equal(h.view.groups[0].data.quotas.codex.available, true);
});

test("usage scans every connected machine and supports a private Unix runtime", async () => {
  const calls = [];
  const h = harness("nv-usage", {
    machines: () => [{ name: "server" }, { name: "offline", layout: "unavailable" }, { name: "server" }],
    readTextFile: async () => "// collector source",
    exec: async (cmd, args, opts) => {
      if (args[0] === "-p") return ok("UTC");
      calls.push({ cmd, args, opts });
      if (cmd === "node" && opts.on === "server") throw new Error("`herdr.exec`: cannot start node: No such file or directory (os error 2)");
      return ok({ version: 1, days: 1, history: { available: true, noRecords: true }, quotas: {} });
    },
  });
  h.view.refresh(h.cx); await h.settle();
  assert.deepEqual(plain(h.view.groups.map(g => g.machine)), [null, "server"]);
  const fallback = calls.find(c => c.cmd === "sh");
  assert.equal(fallback.opts.on, "server");
  assert.ok(fallback.args[1].includes('exec "$nv_usage_node" "$@"'));
  assert.equal(h.view.groups[1].error, undefined);
});

function harness(name, overrides = {}, storage = new Map()) {
  const tasks = [], failures = [], calls = [], overlays = [], scrolls = [];
  const cx = {
    notify() {}, stop_propagation() {},
    focus_handle: () => ({ focus() {} }), timer: { every() {} },
    spawn(fn) { const task = fn(cx); tasks.push(task); task.catch(error => failures.push(error)); },
  };
  class State {
    constructor(options) { this.text = options?.value ?? ""; this.options = options; this.handlers = {}; this.selection = { start: 0, end: 0 }; }
    value() { return this.text; }
    on(event, fn) { this.handlers[event] = fn; }
    set_value(text) { this.text = text; this.handlers.change?.({}, cx); }
    selected_range() { return this.selection; }
    set_selected_range(range) { this.selection = range; }
    release() {} focus() {}
  }
  const native = {
    checking: () => true,
    props: () => ({}), theme: () => ({}), settings: () => ({}),
    spaces: () => [{ id: "s", active: true, machine: null, folder: "/repo", tabs: [] }],
    panes: () => [{ pane: "p", tab: "tab", terminal: "t", cwd: "/repo" }],
    focused: () => ({ space: "s", tab: "tab", pane: "p", terminal: "t", cwd: "/repo" }),
    home: () => "/home/test", window: () => ({ platform: "macos" }), appHome: () => "/local/herdr-app",
    shared: () => null, setShared() {}, layout: () => null, keys: () => [],
    agents: () => [], machines: () => [], layouts: () => ["main", "neon-violet", "all-agents"], setAgentOrder() {},
    nextCommand: () => new Promise(() => {}),
    run: (name, args) => calls.push({ name, args: plain(args) }),
    openOverlay: spec => overlays.push(plain(spec)), closeOverlay() {},
    exec: async () => { throw new Error("Unexpected native exec"); },
    readTextFile: async () => { throw new Error("Unexpected native read"); },
    writeTextFile: async () => { throw new Error("Unexpected native write"); },
    ...overrides,
  };
  const modules = {
    "gpui-kit": { View: class {}, div: element, svg: element, image: element },
    "gpui-base": { h_flex: element, v_flex: element, EditorState: { new: options => new State(options) },
      InputState: { new: options => new State(options) }, Editor: { new: element }, Input: { new: element },
      TextView: {
        markdown: (id, value) => { const el = element(); el.previewKind = "markdown"; el.value = value; return el; },
        html: (id, value) => { const el = element(); el.previewKind = "html"; el.value = value; return el; },
      }, ScrollHandle: { new: () => ({ scroll_to_item(index) { scrolls.push(index); } }) } },
    herdr: native,
  };
  const source = readFileSync(new URL(`../mods/${name}/main.js`, import.meta.url), "utf8")
    .replace(/^import \{(.*?)\} from "(.*?)";/gm, (_line, names, module) =>
      `const {${names.replace(/\bas\b/g, ":")}} = modules[${JSON.stringify(module)}];`)
    .replace("export default class ", "globalThis.Mod = class ");
  const sandbox = { modules, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } };
  vm.runInNewContext(source, sandbox, { filename: `app/mods/${name}/main.js` });
  const view = new sandbox.Mod();
  view.init({}, cx);
  return { view, cx, calls, overlays, native, scrolls, async settle() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.deepEqual(failures, []);
  } };
}


for (const [locale, codeTitle, shortcutsTitle] of [
  ["en-US", "Code highlighting", "Keyboard shortcuts"], ["ja-JP", "コードハイライト", "キーボードショートカット"],
  ["zh-CN", "代码高亮", "键盘快捷键"], ["ko-KR", "코드 하이라이팅", "단축키 모음"],
]) {
  test(`code, shortcuts and + tools follow Herdr ${locale}`, () => {
    const bindings = [
      { section: "global", keys: "cmd-shift-h", action: "mod.open:nv-code" },
      { section: "global", keys: "cmd-shift-k", action: "mod.open:nv-shortcuts" },
    ];
    const overrides = { settings: () => ({ language: locale }), keys: () => bindings };
    const code = harness("nv-code", overrides), shortcuts = harness("nv-shortcuts", overrides), menu = harness("nv-new-menu", overrides);
    assert.ok(textOf(code.view.render()).includes(codeTitle));
    assert.ok(textOf(shortcuts.view.render()).includes(shortcutsTitle));
    assert.equal(shortcuts.view.entries().length, 2);
    assert.ok(textOf(find(menu.view.render(), "nv-code")).includes(codeTitle));
    const tree = menu.view.render();
    find(tree, "nv-code").events.on_click({}, menu.cx);
    find(tree, "nv-shortcuts").events.on_click({}, menu.cx);
    assert.deepEqual(menu.calls, [
      { name: "mod.open", args: { name: "nv-code" } }, { name: "mod.open", args: { name: "nv-shortcuts" } },
    ]);
  });
}

test("syntax and wrapping changes preserve the draft and selection without running commands", async () => {
  const storage = new Map();
  const h = harness("nv-code", { checking: () => false }, storage);
  h.view.state.set_value("const answer = 42;\n");
  h.view.state.set_selected_range({ start: 6, end: 12 });
  h.view.selectGrammar("rs", h.cx);
  assert.equal(h.view.state.options.language, "rs");
  assert.deepEqual(h.view.state.selected_range(), { start: 6, end: 12 });
  h.view.toggle("wrap", h.cx);
  assert.equal(h.view.state.options.soft_wrap, true);
  h.view.toggle("highlight", h.cx);
  assert.equal(h.view.state.options.language, "txt");
  assert.equal(h.view.state.value(), "const answer = 42;\n");
  assert.equal(storage.get("code"), "const answer = 42;\n");
  const reopened = harness("nv-code", {}, storage);
  assert.equal(reopened.view.state.value(), "const answer = 42;\n");
  assert.equal(reopened.view.grammar, "rs");
  assert.equal(reopened.view.highlight, false);
  assert.deepEqual(h.calls, []);
  await h.settle();
});

test("an empty code draft stays empty and language switches never rewrite it", () => {
  const storage = new Map([["code", ""]]), state = new Map();
  const shared = key => state.get(key), setShared = (key, value) => state.set(key, value);
  const h = harness("nv-code", { shared, setShared, settings: () => ({ locale: "zh-TW" }) }, storage);
  const shortcuts = harness("nv-shortcuts", { shared, setShared });
  h.view.setLanguage("ko");
  assert.ok(textOf(h.view.render()).includes("코드 하이라이팅"));
  assert.ok(textOf(shortcuts.view.render()).includes("단축키 모음"));
  h.view.setLanguage("ja");
  assert.ok(textOf(h.view.render()).includes("コードハイライト"));
  assert.equal(h.view.state.value(), "");
  h.view.setLanguage("auto");
  assert.ok(textOf(h.view.render()).includes("代码高亮"));
  h.view.setLanguage("constructor");
  assert.equal(state.get("nv.language"), "auto");
});

test("shortcut search uses live bindings, localized descriptions and actual contexts", () => {
  let bindings = [
    { section: "global", keys: "cmd-shift-h", action: "mod.open:nv-code" },
    { section: "mod:editor", keys: "cmd-s", action: "editor.save" },
    { section: "global", keys: "", action: "unbound" },
  ];
  const h = harness("nv-shortcuts", { keys: () => bindings, settings: () => ({ language: "ko" }) });
  assert.equal(h.view.entries().length, 2);
  h.view.input.set_value("파일 저장");
  assert.equal(h.view.entries()[0].action, "editor.save");
  assert.equal(h.view.entries()[0].context, "패널 · editor");
  h.view.input.set_value("global");
  assert.equal(h.view.entries().length, 1);
  bindings = [{ section: "global", keys: "ctrl-alt-x", action: "my.custom.command" }];
  h.view.input.set_value("my.custom");
  assert.equal(h.view.entries()[0].keys, "ctrl-alt-x");
  h.view.input.set_value("not a key");
  assert.ok(textOf(h.view.render()).includes("일치하는 단축키가 없습니다"));
});

test("shortcut labels distinguish Command, Control, modifier keys and a minus key", () => {
  const bindings = [{ section: "global", keys: "cmd--", action: "app.zoom_out" }];
  const mac = harness("nv-shortcuts", { keys: () => bindings });
  assert.ok(textOf(mac.view.render()).includes("⌘−"));
  assert.ok(!textOf(mac.view.render()).includes("⌘−−"));
  const win = harness("nv-shortcuts", { keys: () => [{ section: "global", keys: "ctrl-shift-k", action: "mod.open:nv-shortcuts" }], window: () => ({ platform: "windows" }) });
  assert.ok(textOf(win.view.render()).includes("Ctrl+Shift+K"));
});

test("tool hotkeys are declared and shipped layouts no longer contain the retired floating list", () => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const bindings = read("../keys.json");
  assert.equal(bindings.global["ctrl-shift-h"], "mod.open:nv-code");
  assert.equal(bindings.global["ctrl-shift-k"], "mod.open:nv-shortcuts");
  for (const name of ["neon-violet", "all-agents"]) assert.ok(!JSON.stringify(read(`../layouts/${name}.json`)).includes('"todos"'));
});

function editor(overrides) {
  const h = harness("editor", { props: () => ({ file: "/repo/file.txt" }), ...overrides });
  h.view.original = "disk";
  h.view.build("disk", h.cx);
  return h;
}

test("dirty reload needs confirmation and preserves edits typed during the read", async () => {
  const read = deferred(); let reads = 0;
  const h = editor({ readTextFile: () => { reads++; return read.promise; } });
  h.view.state.set_value("unsaved");
  h.view.reload(h.cx);
  assert.equal(reads, 0);
  h.view.state.set_value("changed after confirmation");
  h.view.reload(h.cx);
  assert.equal(reads, 0);
  h.view.reload(h.cx);
  assert.equal(reads, 1);
  h.view.state.set_value("typed while reading");
  read.resolve("disk"); await h.settle();
  assert.equal(h.view.state.value(), "typed while reading");
  assert.equal(h.view.dirty, true);
  assert.equal(h.view.original, "disk");
});

test("confirmed reload replaces an unchanged draft; obsolete reads cannot win", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const h = editor({ readTextFile: () => ++reads === 1 ? first.promise : second.promise });
  h.view.state.set_value("discard this"); h.view.reload(h.cx); h.view.reload(h.cx);
  second.resolve("latest disk");
  h.view.load(h.cx); await h.settle();
  first.resolve("old disk"); await h.settle();
  assert.equal(h.view.state.value(), "latest disk");
  assert.equal(h.view.dirty, false);
});

test("saving invalidates a pending reload and retains the expected disk snapshot", async () => {
  const read = deferred(), write = deferred(); const writes = [];
  const h = editor({ readTextFile: () => read.promise, writeTextFile: (...args) => { writes.push(args); return write.promise; } });
  h.view.reload(h.cx); h.view.state.set_value("save me"); h.view.save(h.cx);
  h.view.reload(h.cx); read.resolve("disk"); await h.settle();
  assert.equal(h.view.state.value(), "save me");
  assert.deepEqual(writes, [["/repo/file.txt", "save me", "disk"]]);
  write.resolve(null); await h.settle();
  assert.equal(h.view.original, "save me"); assert.equal(h.view.dirty, false);
});

test("explicit PR source stays pinned after focus moves to another repository", async () => {
  const requests = [];
  const h = harness("prs", { props: () => ({ cwd: "/repo-b", on: "remote" }),
    exec: async (command, args, options) => { requests.push({ command, args, options }); return ok([]); } });
  h.view.refresh(h.cx); await h.settle();
  assert.equal(requests[0].options.cwd, "/repo-b"); assert.equal(requests[0].options.on, "remote");
  h.view.render(h.cx);
  assert.equal(h.view.cwd, "/repo-b");
});

test("direct PR opens capture terminal focus or require an unambiguous sibling context", () => {
  const available = harness("prs");
  assert.equal(available.view.cwd, "/repo");
  const focused = () => ({ space: "s", tab: "tab", pane: "prs", terminal: null, cwd: null });
  const panes = () => [
    { pane: "a", tab: "tab", terminal: "a", cwd: "/repo-a" },
    { pane: "b", tab: "tab", terminal: "b", cwd: "/repo-b" },
  ];
  const ambiguous = harness("prs", { focused, panes });
  assert.equal(ambiguous.view.cwd, null);
  assert.match(ambiguous.view.error, /safely/);
  ambiguous.view.refresh(ambiguous.cx);
  assert.equal(ambiguous.view.loading, undefined);
  const same = harness("prs", { focused, panes: () => panes().map(p => ({ ...p, cwd: "/same" })) });
  assert.equal(same.view.cwd, "/same");
});

test("the + menu captures cwd/machine before overlay focus and passes explicit PR props", () => {
  const focused = () => ({ space: "remote/s", tab: "remote/tab", pane: "remote/p2", terminal: "remote/t2", cwd: "/repo-b" });
  const tabs = harness("nv-tabs", { focused });
  find(tabs.view.render(), "tab-new").events.on_click({}, tabs.cx);
  const source = tabs.overlays[0].props.source;
  assert.deepEqual(source, { cwd: "/repo-b", on: "remote", pane: "remote/p2", space: "remote/s" });
  const menu = harness("nv-new-menu", { props: () => ({ source }) });
  find(menu.view.render(), "nv-prs").events.on_click({}, menu.cx);
  assert.deepEqual(menu.calls[0], { name: "pane.split", args: { direction: "right", pane: "remote/p2", mod: "prs", props: { cwd: "/repo-b", on: "remote" } } });
});

for (const origin of ["neon-violet", "custom-layout"]) {
  test(`All agents returns to ${origin} so the + menu keeps its tools`, () => {
    const values = new Map([["layout", origin]]);
    const sharedState = {
      shared: key => values.get(key),
      setShared: (key, value) => values.set(key, value),
      layouts: () => ["main", "neon-violet", "all-agents", "custom-layout"],
    };
    const menu = harness("nv-new-menu", sharedState);
    find(menu.view.render(), "nv-all-agents").events.on_click({}, menu.cx);
    assert.equal(values.get("all-agents.return-layout"), origin);
    assert.deepEqual(menu.calls, [{ name: "layout.switch", args: { name: "all-agents" } }]);
    values.set("layout", "all-agents");

    const card = harness("all-agents", { ...sharedState, props: () => ({ cell: "remote/t7" }) });
    find(card.view.render(), "open-remote_t7").events.on_click({}, card.cx);
    assert.deepEqual(card.calls, [
      { name: "layout.switch", args: { name: origin } },
      { name: "agent.focus", args: { terminal: "remote/t7" } },
    ]);
    const board = harness("all-agents", sharedState);
    find(board.view.render(), "back-to-main").events.on_click({}, board.cx);
    assert.deepEqual(board.calls, [{ name: "layout.switch", args: { name: origin } }]);

    values.set("layout", origin);
    const tabs = harness("nv-tabs", sharedState);
    find(tabs.view.render(), "tab-new").events.on_click({}, tabs.cx);
    assert.equal(tabs.overlays[0].mod, "nv-new-menu");
    const returnedMenu = harness("nv-new-menu", { ...sharedState, props: () => tabs.overlays[0].props });
    for (const id of ["nv-all-agents", "nv-devices", "nv-prs", "nv-browser"]) {
      assert.ok(find(returnedMenu.view.render(), id));
    }
  });
}

test("All agents uses the pack layout for direct entry and deleted return layouts", () => {
  for (const remembered of [undefined, "removed-layout", "all-agents", {}]) {
    const h = harness("all-agents", {
      shared: key => key === "all-agents.return-layout" ? remembered : null,
    });
    find(h.view.render(), "back-to-main").events.on_click({}, h.cx);
    assert.deepEqual(h.calls, [{ name: "layout.switch", args: { name: "neon-violet" } }]);
  }
  const standalone = harness("all-agents", { layouts: () => ["main", "all-agents"] });
  find(standalone.view.render(), "back-to-main").events.on_click({}, standalone.cx);
  assert.deepEqual(standalone.calls, [{ name: "layout.switch", args: { name: "main" } }]);
});

test("reopening All agents never overwrites the original return layout", () => {
  const values = new Map([["layout", "all-agents"], ["all-agents.return-layout", "neon-violet"]]);
  const h = harness("nv-new-menu", {
    shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
  });
  find(h.view.render(), "nv-all-agents").events.on_click({}, h.cx);
  assert.equal(values.get("all-agents.return-layout"), "neon-violet");
});

function pullRequests(exec = async () => ok([])) {
  const h = harness("prs", { exec });
  h.view.select(1); h.view.pr = pr(1);
  h.view.refresh = () => {};
  return h;
}

test("merge submits the confirmed exact head SHA lease", async () => {
  const requests = [];
  const h = pullRequests(async (_command, args) => { requests.push(plain(args)); return ok(""); });
  h.view.merge(h.cx); assert.equal(requests.length, 0);
  h.view.merge(h.cx); await h.settle();
  assert.deepEqual(requests, [["pr", "merge", "1", "--squash", "--match-head-commit", sha]]);
});

test("changed heads require fresh confirmation; missing heads cannot merge", async () => {
  const requests = [];
  const h = pullRequests(async (_command, args) => { requests.push(args); return ok(pr(1)); });
  h.view.merge(h.cx); h.view.pr.headRefOid = newerSha; h.view.merge(h.cx);
  assert.equal(requests.length, 0); assert.equal(h.view.confirm.head, newerSha);
  h.view.pr.headRefOid = null; h.view.merge(h.cx); await h.settle();
  assert.equal(requests.length, 0);
});

test("a rejected SHA lease leaves the PR open and requires confirmation again", async () => {
  const h = pullRequests(async () => ({ code: 1, stdout: "", stderr: "head changed" }));
  h.view.merge(h.cx); h.view.merge(h.cx); await h.settle();
  assert.equal(h.view.open, 1); assert.equal(h.view.confirm, false);
  assert.match(h.view.note, /head changed/);
});

test("selecting another PR never carries the previous PR draft", async () => {
  const comments = [];
  const h = pullRequests(async (_command, args) => {
    if (args[1] === "comment") { comments.push(args); return ok(""); }
    return ok(pr(Number(args[2])));
  });
  h.view.input.set_value("draft for A"); h.view.pick(2, h.cx); await h.settle();
  assert.equal(h.view.comment, ""); h.view.sendComment(h.cx); assert.equal(comments.length, 0);
  h.view.input.set_value("draft for B"); h.view.pick(1, h.cx); await h.settle();
  assert.equal(h.view.comment, "draft for A");
  h.view.pick(2, h.cx); await h.settle(); assert.equal(h.view.comment, "draft for B");
});

test("post completion preserves a newer draft in the same PR", async () => {
  const post = deferred(); const h = pullRequests(() => post.promise);
  h.view.input.set_value("submitted"); h.view.sendComment(h.cx);
  h.view.input.set_value("next comment"); post.resolve(ok("")); await h.settle();
  assert.equal(h.view.input.value(), "next comment"); assert.equal(h.view.comment, "next comment");
});

test("post completion clears only its own unchanged draft after PR navigation", async () => {
  const post = deferred();
  const h = pullRequests(async (_command, args) => args[1] === "comment" ? post.promise : ok(pr(Number(args[2]))));
  h.view.input.set_value("submitted A"); h.view.sendComment(h.cx);
  h.view.pick(2, h.cx); await h.settle(); h.view.input.set_value("new draft B");
  post.resolve(ok("")); await h.settle(); assert.equal(h.view.comment, "new draft B");
  h.view.pick(1, h.cx); await h.settle(); assert.equal(h.view.comment, "");
  h.view.pick(2, h.cx); await h.settle(); assert.equal(h.view.comment, "new draft B");
});

test("Browser opens a local graphical view without requiring nv on a remote machine", async () => {
  const requests = [];
  const h = harness("nv-new-menu", {
    props: () => ({ source: { on: "remote", pane: "remote/p", space: "remote/s", cwd: "/repo" } }),
    exec: async (...args) => { requests.push(args); throw new Error("no remote binary"); },
  });
  h.view.browser(h.cx); await h.settle();
  assert.equal(requests.length, 0);
  assert.equal(h.overlays[0].mod, "nv-browser");
});

test("native Windows keeps the existing text-browser launcher", () => {
  const h = harness("nv-new-menu", { window: () => ({ platform: "windows" }) });
  h.view.browser();
  assert.deepEqual(h.calls[0].args.argv, ["/local/herdr-app/bin/nv.exe", "browse"]);
});

test("the Chromium program is not duplicated among coding agents", async () => {
  const h = harness("nv-new-menu", { checking: () => false,
    knownAgents: async () => [{ key: "herdr-web-browser", installed: true }, { key: "claude", installed: true }],
  });
  await h.settle();
  assert.deepEqual(plain(h.view.agents.map(a => a.key)), ["claude"]);
});

test("folder navigation cancels old recursive watches without restarting them", async () => {
  let cwd = "/repo-0", cancelled = 0, present = true; const active = new Set();
  const h = harness("nv-files", {
    spaces: () => present ? [{ id: "s", active: true, machine: null, folder: cwd }] : [],
    focused: () => ({ space: "s", tab: "tab", pane: "p", terminal: "t", cwd }), panes: () => [],
    exec: async (command, args, options) => ok(command === "git" && args[0] === "rev-parse" ? options.cwd : ""),
    watchFolder: root => {
      const d = deferred(); active.add(root);
      d.promise.cancel = () => { cancelled++; active.delete(root); d.resolve([]); };
      return d.promise;
    },
  });
  await h.settle(); assert.equal(active.size, 1);
  for (let i = 1; i <= 70; i++) {
    cwd = `/repo-${i}`; h.view.refresh(h.cx); await h.settle();
    assert.deepEqual([...active], [cwd]);
  }
  assert.equal(cancelled, 70);
  cwd = null; present = false; h.view.refresh(h.cx); await h.settle();
  assert.equal(active.size, 0); assert.equal(cancelled, 71);
});

for (const file of ["/repo/.env", "/repo/.env.local", "/repo/.env.production.local", "/repo/config.env"]) {
  test(`dotenv file ${file} uses shell highlighting`, () => {
    const h = harness("editor", { props: () => ({ file }) });
    h.view.build('export API_URL="http://localhost:3000"\n# local config\nENABLED=true', h.cx);
    assert.equal(h.view.state.options.language, "sh");
  });
}

for (const [grammar, body, kind] of [["md", "# Unsaved title\n**bold**", "markdown"], ["html", "<h1>Unsaved title</h1>", "html"]]) {
  test(`code popup ${grammar} preview renders the current unsaved draft and can return to source`, () => {
    const h = harness("nv-code");
    h.view.selectGrammar(grammar, h.cx);
    h.view.state.set_value(body);
    const state = h.view.state;
    find(h.view.render(), "code-preview").events.on_click({}, h.cx);
    assert.equal(h.view.preview, true);
    const preview = find(h.view.render(), "code-document-preview").items[0];
    assert.equal(preview.previewKind, kind);
    assert.equal(preview.value, body);
    find(h.view.render(), "code-preview").events.on_click({}, h.cx);
    assert.equal(h.view.state, state);
    assert.equal(h.view.state.value(), body);
  });
}

test("graphical Browser terminal runs locally even from a remote space", async () => {
  const commands = [];
  const h = harness("nv-browser", {
    exec: async (command, args, options) => { commands.push({ command, args, options }); return ok(command === "hc" ? { address: "t9" } : "herdr-web-browser 1.3.2"); },
  });
  h.view.open(h.cx); await h.settle();
  const launch = commands.find(c => c.command === "hc");
  assert.equal(launch.args.includes("--on"), false);
  assert.equal(launch.args.at(-2), "/local/herdr-app/bin/nv-browser-view");
  assert.equal(h.overlays[0].layout.children[1].content.terminal, "t9");
});

for (const mod of ["editor", "nv-code"]) {
  test(`${mod} transfers large HTML drafts through a private input file`, async () => {
    const commands = [], writes = [], input = "/local/herdr-app/previews/input-test.json";
    const h = harness(mod, {
      props: () => ({ file: "/repo/index.html" }),
      exec: async (command, args) => {
        commands.push({ command, args });
        return ok(args[1] === "reserve" ? { input } : args[1] === "render" ? { url: "file:///preview.html" } : {});
      },
      writeTextFile: async (...args) => writes.push(args),
    });
    if (mod === "nv-code") h.view.selectGrammar("html", h.cx);
    else h.view.build("", h.cx);
    const html = `<h1>${"한글".repeat(100000)}</h1>`;
    h.view.state.set_value(html);
    h.view.browserPreview(h.cx); await h.settle();
    assert.equal(commands.length, 3);
    assert.equal(commands.some(c => c.args.some(arg => arg.length > 1000)), false);
    assert.equal(writes[0][0], input);
    assert.equal(writes[0][2], "");
    assert.equal(JSON.parse(writes[0][1]).html, html);
    assert.equal(h.overlays[0].props.url, "file:///preview.html");
    assert.equal(h.view.state.value(), html);
  });
}

test("ADB inventory includes USB and Wi-Fi physical devices separately from running emulators", async () => {
  const h = harness("devices");
  h.view.tool = async (_m, _name, args) => args[0] === "devices" ?
    "List of devices attached\r\n  USB123 device usb:1-2 product:phone model:Galaxy_Test transport_id:1\r\n192.168.1.7:37123 device model:Pixel_9\r\nemulator-5554 device model:sdk_gphone\r\nLOCKED unauthorized usb:1-3\r\nOLD offline\r\nDENIED no permissions (user is not in the plugdev group)\r\n" :
    args.includes("getprop") ? "16\n" : args.includes("emu") ? "qa_avd\nOK\n" : "";
  const android = await h.view.android({ machine: null, unix: true });
  assert.equal(android.missing, false);
  assert.equal(android.rows.length, 6);
  assert.equal(android.rows[0].name, "Galaxy Test");
  assert.equal(android.rows[0].detail, "Android 16 · USB");
  assert.equal(android.rows[1].detail, "Android 16 · Wi-Fi");
  assert.equal(android.rows[2].emulator, true);
  assert.equal(android.rows[2].name, "qa avd");
  assert.deepEqual(plain(android.rows.slice(3).map(r => r.state)), ["unauthorized", "offline", "no permissions"]);
  h.view.kinds.set(null, { unix: true, mac: false });
  h.view.avds = async () => [];
  const group = await h.view.scan(null);
  assert.equal(group.sections[0].title, "Android devices · ADB");
  assert.equal(group.sections[0].rows.length, 5);
  assert.equal(group.sections[1].rows[0].id, "emulator-5554");
});

test("ADB inventory does not discard a first device line when the header is absent", async () => {
  const h = harness("devices");
  h.view.tool = async (_m, _name, args) => args[0] === "devices" ? "USB123 unauthorized\n" : "";
  assert.equal((await h.view.android({})).rows[0].id, "USB123");
});

test("remote Windows SDK discovery stays on that machine and handles quoted arguments as data", async () => {
  const commands = [];
  const h = harness("devices", { exec: async (command, args, options) => { commands.push({ command, args, options }); return ok("List of devices attached\nUSB123 device model:Phone\n"); } });
  await h.view.tool({ machine: "windows", unix: false }, "adb", ["-s", "phone's-id", "get-state"]);
  assert.equal(commands[0].command, "powershell");
  assert.equal(commands[0].options.on, "windows");
  const script = commands[0].args.at(-1);
  assert.ok(script.includes("$env:ANDROID_HOME"));
  assert.ok(script.includes("$env:LOCALAPPDATA"));
  assert.ok(script.includes("'platform-tools\\adb.exe'"));
  assert.ok(script.includes("'phone''s-id'"));
});

test("a remote physical device is rendered above the local stopped emulator catalog", () => {
  const h = harness("devices");
  h.view.groups = [
    { machine: null, sections: [{ title: "Android emulators · not running", rows: [{ kind: "avd", id: "catalog", name: "Stopped catalog", state: "stopped" }] }] },
    { machine: "windows", sections: [{ title: "Android devices · ADB", rows: [{ kind: "android", id: "USB123", name: "Connected phone", state: "online" }] }] },
  ];
  const text = textOf(h.view.render());
  assert.ok(text.indexOf("Connected phone") < text.indexOf("Stopped catalog"));
  assert.ok(find(h.view.render(), "devices-refresh"));
});

test("a slow remote machine does not hide the completed local ADB inventory", async () => {
  const slow = deferred(), h = harness("devices", { machines: () => [{ name: "slow", layout: "ready" }] });
  h.view.scan = machine => machine ? slow.promise : Promise.resolve({ machine: null, sections: [{ title: "ADB", rows: [{ id: "USB123", state: "online" }] }] });
  h.view.refresh(h.cx); await h.settle();
  assert.equal(h.view.groups[0].sections[0].rows[0].id, "USB123");
  assert.equal(h.view.groups[1].loading, true);
  slow.resolve({ machine: "slow", sections: [] }); await h.settle();
  assert.equal(h.view.busy, false);
});

test("Unix ADB discovery executes custom SDK and NV_ADB paths with spaces and quotes", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nv-adb-"));
  try {
    const sdk = path.join(root, "SDK's folder"), bin = path.join(sdk, "platform-tools", "adb");
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    for (const override of [false, true]) {
      const h = harness("devices", { exec: async (command, args) => {
        const env = { PATH: "/usr/bin:/bin", HOME: root, ANDROID_HOME: override ? "" : sdk, NV_ADB: override ? bin : "" };
        const r = spawnSync(command, args, { env, encoding: "utf8" });
        return { code: r.status, stdout: r.stdout, stderr: r.stderr };
      } });
      const result = await h.view.tool({ machine: null, unix: true }, "adb", ["-s", "phone's-id", "get-state"]);
      assert.equal(result, "-s\nphone's-id\nget-state\n");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("booting a remote Windows AVD uses that machine and its discovered emulator", async () => {
  const commands = [], h = harness("devices", { exec: async (command, args, options) => { commands.push({ command, args, options }); return ok(""); } });
  h.view.refresh = () => {};
  h.view.boot({ kind: "avd", state: "stopped", id: "Remote_AVD", name: "Remote AVD", m: { machine: "windows", unix: false } }, h.cx);
  await h.settle();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].options.on, "windows");
  assert.equal(commands[0].command, "powershell");
  const script = commands[0].args.at(-1);
  assert.ok(script.includes("$env:NV_EMULATOR"));
  assert.ok(script.includes("'emulator\\emulator.exe'"));
  assert.ok(script.includes("Start-Process -FilePath $bin"));
  assert.ok(script.includes("@('-avd','Remote_AVD')"));
});

test("an unavailable discovered emulator reports a boot failure", async () => {
  const h = harness("devices", { exec: async () => ({ code: 127, stdout: "", stderr: "missing emulator" }) });
  h.view.refresh = () => {};
  h.view.boot({ kind: "avd", state: "stopped", id: "QA", name: "QA", m: { machine: null, unix: true } }, h.cx);
  await h.settle();
  assert.equal(h.view.noteError, true);
  assert.equal(h.view.note, "Could not start QA");
});

test("Unix AVD boot executes NV_EMULATOR with a quoted SDK path", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nv-emulator-"));
  try {
    const bin = path.join(root, "emulator's file"), log = path.join(root, "args");
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > "$NV_DEVICE_BOOT_LOG"\n', { mode: 0o755 });
    const h = harness("devices", { exec: async (command, args) => {
      const env = { PATH: "/usr/bin:/bin", HOME: root, NV_EMULATOR: bin, NV_DEVICE_BOOT_LOG: log };
      const r = spawnSync(command, args, { env, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    } });
    h.view.refresh = () => {};
    h.view.boot({ kind: "avd", state: "stopped", id: "QA's_AVD", name: "QA", m: { machine: "remote", unix: true } }, h.cx);
    await h.settle();
    let content;
    for (let i = 0; i < 100; i++) {
      try { content = readFileSync(log, "utf8"); if (content) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(content, "-avd\nQA's_AVD\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ADB listener discovery reads only existing server ports and removes duplicate sockets", async () => {
  const requests = [], h = harness("devices", { exec: async (command, args, options) => {
    requests.push({ command, args, options });
    return ok(command === "ps" ? "100 adb -L tcp:5037 fork-server server\n200 adb -L tcp:localhost:5043 fork-server server\n" :
      "p100\nf19\nn127.0.0.1:5037\nn127.0.0.1:9222\np200\nf15\nn127.0.0.1:5043\nn[::1]:5043\n");
  } });
  assert.deepEqual(plain(await h.view.adbPorts({ machine: "mac", unix: true })), ["5037", "5043"]);
  assert.equal(requests[0].command, "lsof");
  assert.equal(requests[0].options.on, "mac");
  assert.ok(requests[0].args.includes("/^adb$/"));
});

test("Windows ADB discovery excludes app forwarding ports owned by the server", async () => {
  const h = harness("devices", { exec: async () => ok([{ command: '"C:\\SDK folder\\adb.exe" -L tcp:5043 fork-server server', ports: [5043, 9222, 8080] }]) });
  assert.deepEqual(plain(await h.view.adbPorts({ machine: "windows", unix: false })), ["5043"]);
});

test("a Unix-socket ADB server's TCP forwards are never treated as ADB server endpoints", async () => {
  const h = harness("devices", { exec: async () => ok([{ command: 'adb -L localfilesystem:/tmp/adb.sock fork-server server', ports: [5037, 9222] }]) });
  assert.deepEqual(plain(await h.view.adbPorts({ machine: "windows", unix: false })), []);
});

test("Wi-Fi ADB connections include IPv6 and both secure and legacy mDNS names", async () => {
  const h = harness("devices");
  h.view.adbPorts = async () => [];
  h.view.tool = async (_m, _name, args) => args.includes("devices") ?
    "List of devices attached\n[fe80::1234%en0]:37123 device model:Phone\nadb-USB123-token._adb-tls-connect._tcp device model:Phone\nadb-USB456._adb._tcp. device model:Phone\n" : "16\n";
  const data = await h.view.android({ machine: null, unix: true });
  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every(r => !r.emulator && r.connection === "Wi-Fi" && r.detail.includes("Wi-Fi")));
});

test("Wi-Fi Connect uses this computer's adb and refreshes after a successful connection", async () => {
  const h = harness("devices"), calls = []; let refreshed = 0;
  h.view.tool = async (m, name, args) => { calls.push({ m, name, args }); return "connected to 192.168.0.19:37123\n"; };
  h.view.refresh = () => refreshed++;
  h.view.wifiInput.set_value("192.168.0.19:37123");
  find(h.view.render(), "devices-wifi-connect").events.on_click({}, h.cx);
  h.view.connectWifi(h.cx); // a repeated click while connecting cannot start another request
  await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m.machine, null);
  assert.equal(calls[0].m.unix, true);
  assert.deepEqual(plain(calls[0].args), ["connect", "192.168.0.19:37123"]);
  assert.equal(refreshed, 1);
  assert.equal(h.view.noteError, false);
});

test("Wi-Fi Connect rejects invalid addresses and does not treat adb's exit-zero failures as success", async () => {
  const h = harness("devices"); let calls = 0;
  h.view.tool = async () => { calls++; return "failed to connect to 192.168.0.19:37123"; };
  for (const address of ["", "192.168.0.19", "host:0", "host:65536", "host:5555; echo unsafe"]) {
    h.view.wifiInput.set_value(address); h.view.connectWifi(h.cx); await h.settle();
  }
  assert.equal(calls, 0);
  h.view.wifiInput.set_value("192.168.0.19:37123"); h.view.connectWifi(h.cx); await h.settle();
  assert.equal(calls, 1);
  assert.equal(h.view.noteError, true);
  assert.equal(h.view.wifiBusy, false);
});

test("a physical phone on a dedicated ADB server appears and metadata uses the same port", async () => {
  const h = harness("devices"), requests = [];
  h.view.adbPorts = async () => ["5037", "5043"];
  h.view.tool = async (_m, name, args) => {
    requests.push({ name, args });
    const port = args[0] === "-P" ? args[1] : null;
    if (args.includes("devices")) return port === "5043" ? "List of devices attached\nUSB123 device usb:1-1 model:Galaxy_Test\n" :
      "List of devices attached\nemulator-5554 device model:sdk_gphone\nUSB123 offline\n";
    if (args.includes("getprop")) return "16\n";
    if (args.includes("emu")) return "qa_avd\nOK\n";
    return "";
  };
  const data = await h.view.android({ machine: null, unix: true });
  assert.equal(data.rows.length, 2);
  const phone = data.rows.find(r => r.id === "USB123");
  assert.equal(phone.state, "online");
  assert.equal(phone.adbPort, "5043");
  assert.equal(phone.detail, "Android 16 · USB · ADB 5043");
  assert.ok(requests.some(r => r.args.join(" ") === "-P 5043 -s USB123 shell getprop ro.build.version.release"));
  assert.equal(data.missing, false);
});
