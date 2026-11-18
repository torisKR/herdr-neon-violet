import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, home, openOverlay, props, setShared, shared, theme, window } from "herdr";

// The open Browser window, whichever kind: pressing the shortcut again closes it.
const OPEN = { web: "nv.web.window", view: "nv.browser.open" };

export default class Browser extends View {
  init(_props, cx) {
    if (checking()) return;
    for (const key of Object.values(OPEN)) {
      const id = shared(key);
      if (typeof id === "string" && id) {
        setShared(key, null);
        closeOverlay(id);
        closeOverlay(props().overlay);
        return;
      }
    }
    this.open(cx);
  }

  /** Windows (and Unix without the herdr-web-browser runtime): a real Chrome/Edge, drawn live in a
   *  terminal by `nv-web view`, with the address bar above and Inspect beside it. */
  async openWeb() {
    const tool = `${appHome()}/bin/nv-web.mjs`;
    // Start Chrome and the person's tab without moving it (the view itself never starts a browser).
    const ready = await exec("node", [tool, ...(props()?.url ? ["open", props().url] : ["ensure"]), "--owner", "person", "--json"], { timeout: 30000 });
    if (ready.code !== 0) throw new Error(ready.stderr || ready.stdout);
    const r = await exec("hc", ["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", "browser-view", "--cwd", home(), "--", "node", tool, "view", "--owner", "person"], { timeout: 20000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout);
    const terminal = JSON.parse(r.stdout).address;
    if (typeof terminal !== "string" || !/^t[0-9a-z]+$/.test(terminal)) throw new Error("Herdr Core did not return a local browser terminal");
    try {
      setShared(`nv.web.view.${terminal}`, { owner: "person", mode: "use" });
      const id = openOverlay({ kind: "window", key: "nv-web", width: 1280, height: 820,
        layout: { type: "column", children: [
          { type: "block", size: { px: 36 }, content: { mod: "nv-web", props: { part: "bar", terminal } } },
          { type: "row", children: [
            { type: "block", content: { terminal } },
            { type: "block", size: { px: 300 }, content: { mod: "nv-web", props: { part: "side", terminal } } },
          ] },
        ] } });
      setShared(OPEN.web, id);
    } catch (error) {
      await exec("hc", ["kill", terminal]).catch(() => {});
      throw error;
    }
    closeOverlay(props().overlay);
  }

  open(cx) {
    if (this.busy) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      let terminal;
      try {
        if (window().platform === "windows") { await this.openWeb(); return; }
        const installed = await exec(`${appHome()}/bin/herdr-web-browser`, ["--version"]).catch(() => ({ code: 1 }));
        if (installed.code !== 0) { await this.openWeb(); return; }
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
        setShared(OPEN.view, id);
        closeOverlay(props().overlay);
      } catch (error) {
        if (terminal) await exec("hc", ["kill", terminal]).catch(() => {});
        this.error = String(error.message ?? error);
      } finally {
        this.busy = false; cx.notify();
      }
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
