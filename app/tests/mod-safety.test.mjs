import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    agents: () => [], layouts: () => ["main", "neon-violet", "all-agents"], setAgentOrder() {},
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
