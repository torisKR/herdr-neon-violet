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

function harness(name, overrides = {}) {
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
  const sandbox = { modules, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(source, sandbox, { filename: `app/mods/${name}/main.js` });
  const view = new sandbox.Mod();
  view.init({}, cx);
  return { view, cx, calls, overlays, native, async settle() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.deepEqual(failures, []);
  } };
}

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
