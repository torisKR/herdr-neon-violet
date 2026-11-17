// Devices — Android devices and emulators (adb) and iOS simulators and devices,
// read from this computer and from every connected machine. So the devices plugged
// into your Mac show up even when the window runs on another computer.
//
// Opens as a dialog (mod.open:devices). Click a stopped emulator or simulator to boot it.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, closeOverlay, exec, home, machines, props, theme } from "herdr";

// Android Studio's default SDK folders, added to PATH on macOS and Linux.
const SDK_PATH =
  'PATH="$PATH:$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$HOME/Android/Sdk/platform-tools:$HOME/Android/Sdk/emulator"; ';

async function tryExec(command, args, options) {
  try {
    const r = await exec(command, args, options);
    return r.code === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

export default class Devices extends View {
  init(_props, cx) {
    this.groups = []; // one per machine: { machine, sections, adbMissing }
    this.note = "";
    this.loading = true;
    this.kinds = new Map(); // machine -> { unix, mac }
    if (checking()) return;
    cx.timer.every(4000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Runs a tool on the shown space's machine; through sh on macOS/Linux so the SDK folders are on PATH.
  async tool(m, name, args, timeout = 10000) {
    const on = m.machine;
    if (m.unix) {
      const quoted = [name, ...args].map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ");
      return tryExec("sh", ["-c", SDK_PATH + quoted], { on, timeout });
    }
    const direct = await tryExec(name, args, { on, timeout });
    if (direct !== null || on) return direct;
    // Windows, this computer: Android Studio's default SDK folder
    const sub = name === "adb" ? "platform-tools" : "emulator";
    return tryExec(`${home()}\\AppData\\Local\\Android\\Sdk\\${sub}\\${name}.exe`, args, { timeout });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const names = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
        this.groups = await Promise.all([...new Set(names)].map((machine) => this.scan(machine)));
      } finally {
        this.loading = false;
        this.busy = false;
        cx.notify();
      }
    });
  }

  async scan(machine) {
    if (!this.kinds.has(machine)) {
      const uname = await tryExec("uname", ["-s"], { on: machine, timeout: 8000 });
      this.kinds.set(machine, { unix: uname !== null, mac: (uname ?? "").trim() === "Darwin" });
    }
    const m = { machine, ...this.kinds.get(machine) };
    const [android, sims] = await Promise.all([this.android(m), this.simulators(m)]);
    const stopped = await this.avds(m, android.rows);
    const tag = (rows) => rows.map((r) => ({ ...r, m }));
    return {
      machine,
      adbMissing: android.missing,
      sections: [
        { title: "Android · connected", rows: tag(android.rows) },
        { title: "iOS simulators · running", rows: tag(sims.filter((s) => s.state === "online")) },
        { title: "Android emulators · not running", rows: tag(stopped) },
        { title: "iOS simulators · not running", rows: tag(sims.filter((s) => s.state !== "online")) },
      ].filter((s) => s.rows.length),
    };
  }

  async android(m) {
    const out = await this.tool(m, "adb", ["devices", "-l"]);
    if (out === null) return { missing: true, rows: [] };
    const rows = [];
    for (const line of out.split(/\r?\n/).slice(1)) {
      const m = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions.*?)(?:\s+(.*))?$/);
      if (!m) continue;
      const model = (m[3] || "").split(/\s+/).find((p) => p.startsWith("model:"));
      rows.push({
        kind: "android",
        id: m[1],
        state: m[2] === "device" ? "online" : m[2],
        name: (model ? model.slice(6) : m[1]).replace(/_/g, " "),
        emulator: m[1].startsWith("emulator-"),
        detail: "",
      });
    }
    await Promise.all(
      rows
        .filter((r) => r.state === "online")
        .map(async (r) => {
          const [version, avd] = await Promise.all([
            this.tool(m, "adb", ["-s", r.id, "shell", "getprop", "ro.build.version.release"]),
            r.emulator ? this.tool(m, "adb", ["-s", r.id, "emu", "avd", "name"]) : null,
          ]);
          if (avd) {
            r.avd = avd.split(/\r?\n/)[0].trim();
            if (r.avd) r.name = r.avd.replace(/_/g, " ");
          }
          r.detail = `Android ${version ? version.trim() : "?"} · ${r.emulator ? "emulator" : "device"}`;
        }),
    );
    return { missing: false, rows };
  }

  async avds(m, running) {
    const out = await this.tool(m, "emulator", ["-list-avds"]);
    if (out === null) return [];
    const live = new Set(running.map((r) => r.avd).filter(Boolean));
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/\s/.test(l) && !live.has(l))
      .map((name) => ({ kind: "avd", id: name, name: name.replace(/_/g, " "), state: "stopped", detail: "Android emulator" }));
  }

  async simulators(m) {
    if (!m.mac) return [];
    const out = await this.tool(m, "xcrun", ["simctl", "list", "devices", "available", "--json"], 15000);
    if (!out) return [];
    let data;
    try {
      data = JSON.parse(out);
    } catch {
      return [];
    }
    const rows = [];
    for (const [runtime, list] of Object.entries(data.devices || {})) {
      const os = runtime.split(".").pop().replace(/^([A-Za-z]+)-/, "$1 ").replace(/-/g, ".");
      for (const d of list)
        rows.push({ kind: "sim", id: d.udid, name: d.name, state: d.state === "Booted" ? "online" : "stopped", detail: `${os} · simulator` });
    }
    return rows;
  }

  boot(row, cx) {
    if (row.state !== "stopped") return;
    this.note = `Booting ${row.name}…`;
    cx.notify();
    cx.spawn(async (cx) => {
      if (row.kind === "avd") {
        if (row.m.unix) await tryExec("sh", ["-c", `${SDK_PATH}nohup emulator -avd '${row.id}' >/dev/null 2>&1 &`], { on: row.m.machine, timeout: 8000 });
        else await tryExec("cmd", ["/c", "start", "", "emulator", "-avd", row.id], { timeout: 8000 });
      } else if (row.kind === "sim") {
        await this.tool(row.m, "xcrun", ["simctl", "boot", row.id], 60000);
        await this.tool(row.m, "open", ["-a", "Simulator"]);
      }
      this.refresh(cx);
    });
  }

  render() {
    const t = theme();
    const all = this.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));
    const total = all.length;
    const online = all.filter((r) => r.state === "online").length;
    const where = (machine) => machine ?? "This computer";
    const dot = (r) => (r.state === "online" ? t.done : r.state === "stopped" ? t.dim : t.blocked);
    return v_flex()
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .child(div().font_semibold().text_size(15).text_color(t.accent).child("Devices"))
          .child(div().text_color(t.muted).child(this.loading ? "scanning…" : `${online} connected · ${total - online} not connected`))
          .child(div().flex_1())
          .child(
            div()
              .id("devices-close")
              .px(8)
              .py(2)
              .rounded(6)
              .cursor_pointer()
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props().overlay))
              .child("Close"),
          ),
      )
      .child(
        v_flex()
          .id("devices-list")
          .flex_1()
          .gap(2)
          .overflow_y_scrollbar()
          .children(
            this.groups.flatMap((g) => [
              div().pt(10).font_semibold().text_size(14).text_color(t.foreground).child(where(g.machine)),
              ...(g.sections.length || !g.adbMissing ? [] : [div().px(8).text_color(t.dim).child("adb not found here")]),
              ...(g.sections.length || g.adbMissing ? [] : [div().px(8).text_color(t.dim).child("no devices")]),
              ...g.sections.flatMap((s) => [
              div().pt(6).pb(2).px(8).font_semibold().text_color(t.blocked).child(s.title),
              ...s.rows.map((r) =>
                h_flex()
                  .id(`device-${g.machine ?? "local"}-${r.kind}-${r.id}`)
                  .gap(10)
                  .px(8)
                  .py(4)
                  .rounded(6)
                  .items_center()
                  .when(r.state === "stopped", (el) => el.cursor_pointer())
                  .hover((el) => el.bg(t.hover))
                  .on_click((_e, cx) => this.boot(r, cx))
                  .child(div().flex_none().w(8).h(8).rounded_full().bg(dot(r)))
                  .child(div().w(230).flex_none().truncate().child(r.name))
                  .child(div().flex_1().truncate().text_color(t.idle).child(r.id))
                  .child(
                    div()
                      .flex_none()
                      .text_color(r.state === "online" || r.state === "stopped" ? t.muted : t.blocked)
                      .child(r.state === "online" ? r.detail : r.state === "stopped" ? `${r.detail} · click to boot` : r.state),
                  ),
              ),
              ]),
            ]),
          ),
      )
      .when(Boolean(this.note), (el) => el.child(div().text_color(t.done).child(this.note)));
  }
}
