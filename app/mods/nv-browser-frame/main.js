import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, closeOverlay, exec, props, shared, theme } from "herdr";

export default class BrowserFrame extends View {
  init() { this.terminal = props()?.terminal; }
  async close() {
    if (!checking() && props()?.owned === true && /^t[0-9a-z]+$/.test(this.terminal ?? "")) await exec("hc", ["kill", this.terminal]).catch(() => {});
  }
  render() {
    const t = theme();
    return h_flex().size_full().px(10).gap(10).items_center().bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(div().font_semibold().child("Browser"))
      .child(div().flex_1().text_color(t.muted).text_size(10).child(`herdr-web-browser --owner ${this.terminal ?? "…"} snapshot`))
      .child(div().id("browser-window-close").px(8).py(3).rounded(4).cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => { const id = shared(`nv.browser.${this.terminal}`); if (id) closeOverlay(id); }).child("×"));
  }
}
