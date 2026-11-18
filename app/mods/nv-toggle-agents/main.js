// The ALL agents shortcut as a toggle: the first press shows the board, the second goes back to
// the layout it came from (mod.open:nv-toggle-agents). It opens as a 1px popup and closes itself.
import { View, div } from "gpui-kit";
import { checking, closeOverlay, layouts, props, run, setShared, shared } from "herdr";

const BOARD = "all-agents";

/** Where the board returns to: the remembered layout, else the pack's, else Herdr's main. */
function returnLayout(available, origin) {
  return origin !== BOARD && available.includes(origin) ? origin : available.includes("neon-violet") ? "neon-violet" : "main";
}

/** The command a press runs, recording where it came from on the way in. */
function toggle(current, available, remembered, remember) {
  if (current === BOARD) return { name: "layout.switch", args: { name: returnLayout(available, remembered) } };
  if (typeof current === "string") remember(current);
  return { name: "layout.switch", args: { name: BOARD } };
}

export default class ToggleAgents extends View {
  init() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    if (checking()) return;
    const step = toggle(shared("layout"), layouts(), shared("all-agents.return-layout"), origin => setShared("all-agents.return-layout", origin));
    run(step.name, step.args);
  }
  render() { return div(); }
}
