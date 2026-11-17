// ALL agents — every agent's live terminal on one screen, for the Herdr app.
//
// One mod, three roles (chosen by props):
//   {}            the top bar: counts, filter chips; it also keeps the grid in sync
//   { cell: t }   the header drawn above one agent's terminal
//   { empty: 1 }  the message shown when the filter matches nothing
//
// The bar rebuilds the layout's "grid" node with one terminal block per agent
// whenever the agents or the filter change (layout.set).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, layout, layouts, nextCommand, props, run, setAgentOrder, setShared, shared, theme } from "herdr";

const LAYOUT = "all-agents";
const FILTERS = ["all", "blocked", "working", "done", "idle"];
const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };
const LABEL = { all: "All", blocked: "Blocked", working: "Working", done: "Done", idle: "Idle" };
const KEY = { all: "ctrl+a", blocked: "ctrl+b", working: "ctrl+w", done: "ctrl+d", idle: "ctrl+i" };

// Cache of the grid last written, shared by copies so a restarted bar does not rewrite it.
let lastSig = null;

const currentFilter = () => (FILTERS.includes(shared("all-agents.filter")) ? shared("all-agents.filter") : "all");
const returnLayout = () => {
  const available = layouts(), origin = shared("all-agents.return-layout");
  return origin !== LAYOUT && available.includes(origin) ? origin : available.includes("neon-violet") ? "neon-violet" : "main";
};

function visibleAgents() {
  const f = currentFilter();
  return agents()
    .filter((a) => f === "all" || a.status === f)
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || Number(b.pinned) - Number(a.pinned));
}

const nodeId = (address) => address.replace(/[^A-Za-z0-9]/g, "_");

function gridChildren(list) {
  if (!list.length) return [{ id: "all-agents-empty", type: "block", content: { mod: "all-agents", props: { empty: true } } }];
  const cols = list.length === 1 ? 1 : list.length <= 4 ? 2 : list.length <= 9 ? 3 : 4;
  const rows = [];
  for (let i = 0; i < list.length; i += cols) {
    const cells = list.slice(i, i + cols).map((a) => ({
      id: `cell-${nodeId(a.address)}`,
      type: "column",
      radius: 8,
      background: "background",
      border: { width: 1, color: "border" },
      focus: { border: { width: 1, color: "accent" } },
      resizable: false,
      children: [
        { id: `head-${nodeId(a.address)}`, type: "block", size: { px: 30 }, content: { mod: "all-agents", props: { cell: a.address } } },
        { id: `term-${nodeId(a.address)}`, type: "block", content: { terminal: a.address } },
      ],
    }));
    // keep the last row's cells the same width as the others
    while (cells.length < cols) cells.push({ id: `pad-${i}-${cells.length}`, type: "block", content: { mod: "all-agents", props: { pad: true } } });
    rows.push({ id: `row-${i / cols}`, type: "row", gap: 8, children: cells });
  }
  return rows;
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

function syncGrid(list) {
  if (shared("layout") !== LAYOUT) return;
  const sig = `${currentFilter()}|${list.map((a) => a.address).join(",")}`;
  if (sig === lastSig) return;
  const tree = JSON.parse(JSON.stringify(layout() ?? null));
  const grid = findNode(tree, "grid");
  if (!grid) return;
  lastSig = sig;
  grid.children = gridChildren(list);
  run("layout.set", { layout: tree });
}

export default class AllAgents extends View {
  init(_props, cx) {
    if (props()?.cell || props()?.empty || props()?.pad) return;
    // keys.json: "ctrl-d": "all-agents.done" and friends
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (FILTERS.includes(command)) setShared("all-agents.filter", command);
        cx.notify();
      }
    });
  }

  render() {
    const p = props() ?? {};
    if (p.pad) return div().size_full();
    if (p.empty) return this.empty();
    if (p.cell) return this.header(p.cell);
    return this.bar();
  }

  bar() {
    const t = theme();
    const all = agents();
    const list = visibleAgents();
    setAgentOrder(list.map((a) => a.address));
    syncGrid(list);
    const filter = currentFilter();
    const count = (f) => (f === "all" ? all.length : all.filter((a) => a.status === f).length);
    const color = (f) => (f === "all" ? t.accent : t[f]);
    return h_flex()
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .text_size(13)
      .child(div().font_semibold().text_color(t.accent).child("ALL agents"))
      .children(
        FILTERS.map((f) =>
          h_flex()
            .id(`filter-${f}`)
            .gap(6)
            .px(10)
            .py(3)
            .rounded(6)
            .items_center()
            .cursor_pointer()
            .border_1()
            .border_color(filter === f ? color(f) : t.border)
            .bg(filter === f ? t.selected : t.chrome)
            .hover((s) => s.bg(t.hover))
            .on_click(() => setShared("all-agents.filter", f))
            .child(div().w(8).h(8).rounded_full().bg(color(f)))
            .child(div().text_color(filter === f ? t.foreground : t.muted).child(`${LABEL[f]} ${count(f)}`))
            .child(div().text_size(11).text_color(t.dim).child(KEY[f])),
        ),
      )
      .child(div().flex_1())
      .child(
        div()
          .id("back-to-main")
          .px(10)
          .py(3)
          .rounded(6)
          .cursor_pointer()
          .text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("layout.switch", { name: returnLayout() }))
          .child("Back to Herdr"),
      );
  }

  header(address) {
    const t = theme();
    const a = agents().find((x) => x.address === address);
    const status = a?.status ?? "idle";
    return h_flex()
      .id(`open-${nodeId(address)}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .text_size(12)
      .bg(t.surface)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        run("layout.switch", { name: returnLayout() });
        run("agent.focus", { terminal: address });
      })
      .child(div().flex_none().w(8).h(8).rounded_full().bg(t[status] ?? t.dim))
      .child(div().flex_none().font_semibold().text_color(t.accent).child(a?.program?.name ?? "agent"))
      .child(div().flex_none().text_color(t.muted).child(a ? `${a.space_name} / ${a.tab_name}` : address))
      .child(div().flex_1().truncate().text_color(t.dim).child(a?.title ?? ""))
      .child(div().flex_none().font_semibold().text_color(t[status] ?? t.dim).child(status.toUpperCase()));
  }

  empty() {
    const t = theme();
    const filter = currentFilter();
    const text = agents().length
      ? `No ${filter} agents right now. Press ctrl+a to show all.`
      : "No agents yet. Start an agent in any space and it shows up here.";
    return v_flex().size_full().items_center().justify_center().text_size(14).text_color(t.muted).child(text);
  }
}
