// The Pull requests shortcut as a toggle (mod.open:nv-toggle-prs): opens the PR pane beside the
// focused terminal, and closes it when this tab already shows one. A 1px popup that closes itself.
import { View, div } from "gpui-kit";
import { checking, closeOverlay, focused, panes, props, run, spaces } from "herdr";

/** The command for a press, given what has focus and the panes of every tab. */
function toggle(f, all, activeSpace) {
  const tab = f?.tab;
  const open = tab ? all.find(p => p.tab === tab && p.mod === "prs") : null;
  if (open) return { name: "pane.close", args: { pane: open.pane } };
  const machine = f?.terminal?.includes("/") ? f.terminal.split("/")[0] : activeSpace?.machine ?? null;
  const props = { cwd: f?.cwd ?? null, on: machine };
  if (f?.pane) return { name: "pane.split", args: { direction: "right", pane: f.pane, mod: "prs", props } };
  if (activeSpace) return { name: "tab.new", args: { space: activeSpace.id, mod: "prs", props } };
  return null;
}

export default class TogglePrs extends View {
  init() {
    // Read focus first: the popup itself must not count as the place to split.
    const f = focused(), all = panes(), space = spaces().find(s => s.active);
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    if (checking()) return;
    const step = toggle(f, all, space);
    if (step) run(step.name, step.args);
  }
  render() { return div(); }
}
