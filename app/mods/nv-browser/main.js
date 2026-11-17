import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, home, openOverlay, props, setShared, theme, window } from "herdr";

export default class Browser extends View {
  init(_props, cx) {
    if (!checking()) this.open(cx);
  }

  open(cx) {
    if (this.busy) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      let terminal;
      try {
        if (window().platform === "windows") throw new Error("Graphical Browser currently requires macOS or Linux. Use the terminal browser on Windows.");
        const installed = await exec(`${appHome()}/bin/herdr-web-browser`, ["--version"]);
        if (installed.code !== 0) throw new Error("Install the Browser runtime: ./scripts/install-browser.sh");
        const r = await exec("hc", ["run", "--bg", "--json", "--no-parent", "--no-notify", "--cwd", home(), "--", `${appHome()}/bin/nv-browser-view`, props()?.url || "about:blank"], { timeout: 20000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        const made = JSON.parse(r.stdout);
        terminal = made.address;
        if (typeof terminal !== "string" || !/^t[0-9a-z]+$/.test(terminal)) throw new Error("Herdr Core did not return a local browser terminal");
        const id = openOverlay({ kind: "window", key: `nv-browser-${terminal}`, width: 1150, height: 780,
          layout: { type: "column", children: [
            { type: "block", size: { px: 32 }, content: { mod: "nv-browser-frame", props: { terminal, owned: true } } },
            { type: "block", content: { terminal } },
          ] } });
        setShared(`nv.browser.${terminal}`, id);
        setShared("nv.browser.last", { terminal, window: id });
        closeOverlay(props().overlay);
      } catch (error) {
        if (terminal) await exec("hc", ["kill", terminal]).catch(() => {});
        this.error = String(error.message ?? error);
      }
      this.busy = false; cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().size_full().p(16).gap(10).bg(t.surface).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().child("Browser · Chromium"))
      .child(div().text_color(this.error ? t.blocked : t.muted).child(this.error || "Opening live browser…"))
      .when(Boolean(this.error), el => el.child(div().id("browser-retry").px(10).py(6).rounded(6).bg(t.raised).cursor_pointer()
        .on_click((_e, cx) => this.open(cx)).child("Retry")));
  }
}
