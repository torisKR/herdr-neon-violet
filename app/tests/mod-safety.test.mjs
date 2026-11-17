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
  const data = { items: [], events: {} };
  let proxy;
  proxy = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    if (key === "id") return id => { data.name = id; return proxy; };
    if (key === "child") return child => { data.items.push(child); return proxy; };
    if (key === "children") return children => { data.items.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key.startsWith("on_")) return fn => { data.events[key] = fn; return proxy; };
    return () => proxy;
  } });
  return proxy;
}
const find = (node, id) => node && typeof node === "object"
  ? node.name === id ? node : node.items?.map(child => find(child, id)).find(Boolean) : null;
const textOf = node => typeof node === "string" ? node : node?.items?.map(textOf).join("\n") ?? "";

function harness(name, overrides = {}, storage = new Map()) {
  const tasks = [], failures = [], calls = [], overlays = [];
  const cx = {
    notify() {}, stop_propagation() {},
    focus_handle: () => ({ focus() {} }), timer: { every() {} },
    spawn(fn) { const task = fn(cx); tasks.push(task); task.catch(error => failures.push(error)); },
  };
  class State {
    constructor(options) { this.text = options?.value ?? ""; this.handlers = {}; }
    value() { return this.text; }
    on(event, fn) { this.handlers[event] = fn; }
    set_value(text) { this.text = text; this.handlers.change?.({}, cx); }
    release() {} focus() {}
  }
  const native = {
    checking: () => true,
    props: () => ({}), theme: () => ({}), settings: () => ({}),
    spaces: () => [{ id: "s", active: true, machine: null, folder: "/repo", tabs: [] }],
    panes: () => [{ pane: "p", tab: "tab", terminal: "t", cwd: "/repo" }],
    focused: () => ({ space: "s", tab: "tab", pane: "p", terminal: "t", cwd: "/repo" }),
    window: () => ({ platform: "macos" }), appHome: () => "/local/herdr-app",
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
      TextView: { markdown: element }, ScrollHandle: { new: () => ({ scroll_to_item() {} }) } },
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
  return { view, cx, calls, overlays, native, async settle() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.deepEqual(failures, []);
  } };
}

const todoCopy = [
  ["ko-KR", "할 일", "할 일 추가", "완료 처리", "다시 열기", "완료 1개 지우기", "직접 추가함", "초", "할 일 완료"],
  ["en-US", "To-do", "Add a to-do", "Mark done", "Reopen", "Clear 1 done", "added by you", "s", "To-do done"],
  ["ja_JP", "やること", "やることを追加", "完了にする", "再開", "完了 1件を削除", "自分で追加", "秒", "やることが完了"],
  ["zh-CN", "待办", "添加待办事项", "标为完成", "重新打开", "清除 1项已完成", "自己添加", "秒", "待办已完成"],
];

for (const [locale, title, placeholder, done, reopen, clear, added, seconds, completed] of todoCopy) {
  test(`To-do follows Herdr ${locale} for labels, details, elapsed time and completion alerts`, async () => {
    const notifications = [];
    const item = { id: "one", source: "codex", text: "original headline", detail: "original instruction", created: 1000, done: false };
    const h = harness("todos", {
      settings: () => ({ language: locale }), machines: () => [], notify: value => notifications.push(value),
      exec: async () => ok({ items: [item] }),
    });
    let tree = h.view.render();
    assert.ok(textOf(tree).includes(title));
    assert.equal(textOf(find(tree, "todos-placeholder")), placeholder);
    h.view.items = [item]; h.view.open = "local-one";
    tree = h.view.render();
    assert.equal(textOf(find(tree, "todo-toggle-local-one")), done);
    assert.ok(textOf(tree).includes("original instruction"));

    h.view.items = [{ ...item, source: "me", done: true, done_at: 1045 }];
    tree = h.view.render();
    assert.equal(textOf(find(tree, "todo-toggle-local-one")), reopen);
    assert.equal(textOf(find(tree, "todos-clear")), clear);
    assert.ok(textOf(tree).includes(added));
    assert.ok(textOf(tree).includes(`45${seconds}`));

    await h.view.refresh(h.cx); await h.settle();
    item.done = true; item.done_at = 1045;
    h.view.refresh(h.cx); await h.settle();
    assert.deepEqual(plain(notifications), [{ title: completed, body: "original headline", level: "success", timeout: 6000 }]);
  });
}

test("To-do language menu persists Korean, preserves drafts and returns to live Herdr settings", () => {
  const storage = new Map();
  let locale = "en";
  const overrides = { settings: () => ({ locale }) };
  const h = harness("todos", overrides, storage);
  const input = h.view.input;
  input.set_value("작성 중인 할 일");
  find(h.view.render(), "todos-language").events.on_click({}, h.cx);
  const menu = h.view.render();
  for (const code of ["auto", "ko", "en", "ja", "zh"]) assert.ok(find(menu, `todos-language-${code}`));
  find(menu, "todos-language-ko").events.on_click({}, h.cx);
  assert.equal(storage.get("language"), "ko");
  assert.equal(h.view.locale(), "ko");
  assert.equal(h.view.languageMenu, false);
  assert.equal(h.view.input, input);
  assert.equal(h.view.input.value(), "작성 중인 할 일");
  assert.equal(find(h.view.render(), "todos-placeholder"), undefined);

  locale = "ja";
  assert.equal(h.view.locale(), "ko");
  const reloaded = harness("todos", overrides, storage);
  assert.equal(reloaded.view.locale(), "ko");
  reloaded.view.setLanguage("auto", reloaded.cx);
  assert.equal(reloaded.view.locale(), "ja");
  locale = "zh-Hans-CN";
  assert.equal(reloaded.view.locale(), "zh");
  assert.equal(harness("todos", overrides, storage).view.locale(), "zh");
});

test("To-do safely falls back for absent, unsupported and malformed language preferences", () => {
  for (const value of [null, "", "fr-FR", "constructor", "toString", {}, 123]) {
    const storage = new Map([["language", value]]);
    const h = harness("todos", { settings: () => ({ language: value }) }, storage);
    assert.equal(h.view.locale(), "en");
    assert.doesNotThrow(() => h.view.render());
    h.view.setLanguage("invalid", h.cx);
    assert.equal(storage.get("language"), value);
  }
  const h = harness("todos", { settings: () => ({ language: "system", locale: " KO_kr " }) });
  assert.equal(h.view.locale(), "ko");
});

test("To-do language selection remains available while folded and does not change list actions", () => {
  const h = harness("todos", { settings: () => ({ language: "ko" }) });
  h.view.collapsed = true;
  find(h.view.render(), "todos-language").events.on_click({}, h.cx);
  find(h.view.render(), "todos-language-ja").events.on_click({}, h.cx);
  assert.equal(h.view.collapsed, true);
  const changes = [];
  h.view.change = (_cx, args, on) => changes.push(plain({ args, on }));
  h.view.items = [{ id: "remote-item", source: "me", text: "keep this", on: "remote", done: true, created: 1000, done_at: 1060 }];
  h.view.open = "remote-remote-item"; h.view.collapsed = false;
  const tree = h.view.render();
  find(tree, "todo-toggle-remote-remote-item").events.on_click({}, h.cx);
  find(tree, "todos-clear").events.on_click({}, h.cx);
  h.view.input.set_value("日本語で入力"); h.view.add(h.cx);
  assert.deepEqual(changes, [
    { args: ["toggle", "remote-item"], on: "remote" },
    { args: ["clear-done"], on: "remote" },
    { args: ["add", "--source", "me", "日本語で入力"], on: null },
  ]);
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

test("remote Unix Browser uses the target path and the original pane", async () => {
  const requests = [];
  const h = harness("nv-new-menu", {
    props: () => ({ source: { on: "remote", pane: "remote/p", space: "remote/s", cwd: "/repo" } }),
    window: () => ({ platform: "windows" }),
    exec: async (command, args, options) => { requests.push({ command, args, options }); return ok("/home/other/.config/herdr-app/bin/nv"); },
  });
  h.view.browser(h.cx); await h.settle();
  assert.equal(requests[0].options.on, "remote");
  assert.deepEqual(h.calls[0].args.argv, ["/home/other/.config/herdr-app/bin/nv", "browse"]);
  assert.equal(h.calls[0].args.pane, "remote/p");
});

test("remote Windows Browser resolves nv.exe with PowerShell on that machine", async () => {
  const requests = [];
  const h = harness("nv-new-menu", {
    props: () => ({ source: { on: "windows", pane: "windows/p" } }),
    exec: async (command, _args, options) => {
      requests.push({ command, options });
      if (command === "sh") throw new Error("cannot start sh: program not found");
      return ok("C:\\Users\\remote\\.config\\herdr-app\\bin\\nv.exe");
    },
  });
  h.view.browser(h.cx); await h.settle();
  assert.deepEqual(requests.map(r => [r.command, r.options.on]), [["sh", "windows"], ["powershell", "windows"]]);
  assert.deepEqual(h.calls[0].args.argv, ["C:\\Users\\remote\\.config\\herdr-app\\bin\\nv.exe", "browse"]);
});

test("failed remote Browser lookup never falls back to a local launch", async () => {
  const h = harness("nv-new-menu", { props: () => ({ source: { on: "remote", pane: "remote/p" } }),
    exec: async () => ({ code: 1, stdout: "", stderr: "missing" }) });
  h.view.browser(h.cx); await h.settle();
  assert.equal(h.calls.length, 0); assert.match(h.view.browserError, /not installed/);
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
