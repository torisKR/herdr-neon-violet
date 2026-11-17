// Devices — Android devices and emulators (adb) and iOS simulators and devices,
// read from this computer and from every connected machine. So the devices plugged
// into your Mac show up even when the window runs on another computer.
//
// Opens as a dialog (mod.open:devices). Click a stopped emulator or simulator to boot it.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { checking, closeOverlay, exec, machines, props, theme, window } from "herdr";

// GUI and remote shells may not inherit Android Studio's SDK paths.
const SDK_PATH =
  'for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "$HOME/Android/sdk"; do if [ -n "$sdk" ]; then PATH="$PATH:$sdk/platform-tools:$sdk/emulator"; fi; done; export PATH; ';
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;

function serverPort(command) {
  if (!/\b(?:fork-server\s+server|nodaemon\s+server|server\s+nodaemon)\b/.test(command)) return null;
  const socket = command.match(/(?:^|\s)-L\s+["']?([^\s"']+)/)?.[1];
  if (socket) return socket.startsWith("tcp:") ? socket.match(/:(\d+)$/)?.[1] ?? null : null;
  return command.match(/(?:^|\s)-P\s+(\d+)/)?.[1] ?? "5037";
}

function unixTool(name, args, background = false) {
  const variable = name === "adb" ? "NV_ADB" : name === "emulator" ? "NV_EMULATOR" : null;
  const select = variable ? `nv_tool="\${${variable}:-${name}}"; ` : `nv_tool=${quote(name)}; `;
  const launch = `${background ? "nohup " : ""}"$nv_tool" ${args.map(quote).join(" ")}`;
  return SDK_PATH + select + (background ? `command -v "$nv_tool" >/dev/null 2>&1 || exit 127; ${launch} >/dev/null 2>&1 &` : launch);
}

function windowsTool(name, args, background = false) {
  const sub = name === "adb" ? "platform-tools" : "emulator";
  const variable = name === "adb" ? "NV_ADB" : "NV_EMULATOR";
  return `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ` +
    `$bins=@($env:${variable}); $found=Get-Command ${psQuote(name + ".exe")} -ErrorAction SilentlyContinue; if ($found) { $bins+= $found.Source }; ` +
    `$roots=@($env:ANDROID_HOME,$env:ANDROID_SDK_ROOT); foreach ($scope in @('User','Machine')) { foreach ($key in @('ANDROID_HOME','ANDROID_SDK_ROOT')) { $roots+=[Environment]::GetEnvironmentVariable($key,$scope) } }; ` +
    `if ($env:LOCALAPPDATA) { $roots+=(Join-Path $env:LOCALAPPDATA 'Android\\Sdk') }; ` +
    `foreach ($root in $roots) { if ($root) { $bins+=(Join-Path $root ${psQuote(sub + "\\" + name + ".exe")}) } }; ` +
    `foreach ($scope in @('User','Machine')) { foreach ($dir in ([Environment]::GetEnvironmentVariable('Path',$scope) -split ';')) { if ($dir) { $bins+=(Join-Path ([Environment]::ExpandEnvironmentVariables($dir.Trim('"'))) ${psQuote(name + ".exe")}) } } }; ` +
    `foreach ($bin in $bins) { if ($bin -and (Test-Path -LiteralPath $bin -PathType Leaf)) { ` +
    (background ? `try { Start-Process -FilePath $bin -ArgumentList @(${args.map(psQuote).join(",")}) -ErrorAction Stop | Out-Null; exit 0 } catch { Write-Error $_; exit 1 }`
      : `& $bin ${args.map(psQuote).join(" ")}; exit $LASTEXITCODE`) + ` } }; exit 127`;
}

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
    this.wifiInput = InputState.new();
    this.wifiInput.on("change", (_e, cx) => cx.notify());
    if (checking()) return;
    cx.timer.every(4000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Each row keeps its machine; SDK discovery also runs on that machine.
  async tool(m, name, args, timeout = 10000) {
    const on = m.machine;
    if (m.unix) {
      return tryExec("sh", ["-c", unixTool(name, args)], { on, timeout });
    }
    if (name === "adb" || name === "emulator") return tryExec("powershell", ["-NoProfile", "-Command", windowsTool(name, args)], { on, timeout });
    return tryExec(name, args, { on, timeout });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const names = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
        const order = [...new Set(names)];
        this.groups = order.map(machine => this.groups.find(g => g.machine === machine) ?? { machine, sections: [], loading: true });
        await Promise.all(order.map(async machine => {
          const group = await this.scan(machine);
          this.groups = this.groups.map(g => g.machine === machine ? group : g);
          cx.notify();
        }));
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
      if (uname !== null) this.kinds.set(machine, { unix: true, mac: uname.trim() === "Darwin" });
    }
    const m = { machine, unix: false, mac: false, ...this.kinds.get(machine) };
    const [android, sims] = await Promise.all([this.android(m), this.simulators(m)]);
    const stopped = await this.avds(m, android.rows);
    const tag = (rows) => rows.map((r) => ({ ...r, m }));
    return {
      machine,
      adbMissing: android.missing,
      sections: [
        { title: "Android devices · ADB", rows: tag(android.rows.filter(r => !r.emulator)) },
        { title: "Android emulators · running", rows: tag(android.rows.filter(r => r.emulator)) },
        { title: "iOS simulators · running", rows: tag(sims.filter((s) => s.state === "online")) },
        { title: "Android emulators · not running", rows: tag(stopped) },
        { title: "iOS simulators · not running", rows: tag(sims.filter((s) => s.state !== "online")) },
      ].filter((s) => s.rows.length),
    };
  }

  async adbPorts(m) {
    let servers = [];
    if (m.unix) {
      const listeners = new Map();
      const out = await tryExec("lsof", ["-nP", "-a", "-c", "/^adb$/", "-iTCP", "-sTCP:LISTEN", "-Fn"], { on: m.machine, timeout: 8000 });
      const add = (pid, port) => { if (pid && port) listeners.set(pid, [...(listeners.get(pid) ?? []), port]); };
      if (out !== null) {
        let pid;
        for (const line of out.split(/\r?\n/)) {
          if (/^p\d+$/.test(line)) pid = line.slice(1);
          else if (line.startsWith("n")) add(pid, line.match(/:(\d+)$/)?.[1]);
        }
      }
      else {
        const sockets = await tryExec("ss", ["-H", "-lntp"], { on: m.machine, timeout: 8000 });
        for (const line of (sockets ?? "").split(/\r?\n/).filter(line => line.includes('"adb"'))) add(line.match(/pid=(\d+)/)?.[1], line.trim().split(/\s+/)[3]?.match(/:(\d+)$/)?.[1]);
      }
      if (listeners.size) {
        const commands = await tryExec("ps", ["-p", [...listeners.keys()].join(","), "-o", "pid=,args="], { on: m.machine, timeout: 8000 });
        for (const line of (commands ?? "").split(/\r?\n/)) {
          const match = line.match(/^\s*(\d+)\s+(.*)$/);
          if (match) servers.push({ command: match[2], ports: listeners.get(match[1]) ?? [] });
        }
      }
    } else {
      const script = "$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue); $servers=@(foreach ($p in (Get-CimInstance Win32_Process -Filter \"Name='adb.exe'\" -ErrorAction SilentlyContinue)) { [pscustomobject]@{ command=$p.CommandLine; ports=@($listeners | Where-Object { $_.OwningProcess -eq $p.ProcessId } | Select-Object -ExpandProperty LocalPort) } }); ConvertTo-Json -InputObject $servers -Depth 3 -Compress";
      const out = await tryExec("powershell", ["-NoProfile", "-Command", script], { on: m.machine, timeout: 8000 });
      try { const parsed = JSON.parse(out ?? "[]"); if (Array.isArray(parsed)) servers = parsed; } catch {}
    }
    // adb also owns app forwarding sockets. Only query the socket named by its server command.
    return [...new Set(servers.map(s => ({ ...s, port: serverPort(String(s.command ?? "")) }))
      .filter(s => /^\d+$/.test(s.port ?? "") && Number(s.port) > 0 && Number(s.port) <= 65535 && s.ports?.map(String).includes(s.port)).map(s => s.port))];
  }

  async android(m) {
    // Query only existing local listeners, including dedicated ADB servers used by other tools.
    const ports = [null, ...await this.adbPorts(m)];
    const results = await Promise.all(ports.map(async port => ({ port,
      out: await this.tool(m, "adb", [...(port ? ["-P", port] : []), "devices", "-l"]),
    })));
    const devices = new Map();
    for (const { port, out } of results) {
      if (out === null) continue;
      for (const line of out.split(/\r?\n/)) {
        const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)(?:\s+(.*))?$/);
        if (!match) continue;
        const model = (match[3] || "").split(/\s+/).find((p) => p.startsWith("model:"));
        const row = {
        kind: "android",
        id: match[1],
        state: match[2] === "device" ? "online" : match[2],
        name: (model ? model.slice(6) : match[1]).replace(/_/g, " "),
        emulator: match[1].startsWith("emulator-"),
        connection: /(?:^|\s)usb:/.test(match[3] ?? "") ? "USB" : /:\d+$|\._adb(?:-tls-connect)?\._tcp\.?$/.test(match[1]) ? "Wi-Fi" : "physical device",
        adbPort: port,
        detail: "",
        };
        const current = devices.get(row.id);
        if (!current || current.state !== "online" && row.state === "online") devices.set(row.id, row);
      }
    }
    const rows = [...devices.values()];
    await Promise.all(
      rows
        .filter((r) => r.state === "online")
        .map(async (r) => {
          const [version, avd] = await Promise.all([
            this.tool(m, "adb", [...(r.adbPort ? ["-P", r.adbPort] : []), "-s", r.id, "shell", "getprop", "ro.build.version.release"]),
            r.emulator ? this.tool(m, "adb", [...(r.adbPort ? ["-P", r.adbPort] : []), "-s", r.id, "emu", "avd", "name"]) : null,
          ]);
          if (avd) {
            r.avd = avd.split(/\r?\n/)[0].trim();
            if (r.avd) r.name = r.avd.replace(/_/g, " ");
          }
          r.detail = `Android ${version ? version.trim() : "?"} · ${r.emulator ? "emulator" : r.connection}${r.adbPort ? ` · ADB ${r.adbPort}` : ""}`;
        }),
    );
    return { missing: results.every(r => r.out === null), rows };
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

  connectWifi(cx) {
    if (this.wifiBusy) return;
    const address = this.wifiInput.value().trim();
    const endpoint = address.match(/^(?:[a-z0-9][a-z0-9._-]*|\[[0-9a-f:.]+(?:%[a-z0-9_.-]+)?\]):(\d{1,5})$/i);
    if (!endpoint || Number(endpoint[1]) < 1 || Number(endpoint[1]) > 65535) {
      this.note = "Enter the Wireless debugging connection address as IP:port";
      this.noteError = true; cx.notify(); return;
    }
    this.wifiBusy = true; this.noteError = false;
    this.note = `Connecting to ${address}…`; cx.notify();
    cx.spawn(async cx => {
      try {
        const out = await this.tool({ machine: null, unix: window().platform !== "windows" }, "adb", ["connect", address], 15000);
        if (!out || !/^(?:already )?connected to\s/i.test(out.trim())) {
          this.note = out?.trim().slice(0, 180) || "Connection failed. Enable Wireless debugging and pair this computer first.";
          this.noteError = true;
        } else {
          this.note = `Wi-Fi connected · ${address}`;
          this.refresh(cx);
        }
      } catch (error) { this.note = `Connection failed: ${String(error.message ?? error).slice(0, 140)}`; this.noteError = true; }
      finally { this.wifiBusy = false; cx.notify(); }
    });
  }

  boot(row, cx) {
    if (row.state !== "stopped") return;
    this.note = `Booting ${row.name}…`;
    this.noteError = false;
    cx.notify();
    cx.spawn(async (cx) => {
      if (row.kind === "avd") {
        const options = { on: row.m.machine, timeout: 8000 };
        const result = row.m.unix
          ? await tryExec("sh", ["-c", unixTool("emulator", ["-avd", row.id], true)], options)
          : await tryExec("powershell", ["-NoProfile", "-Command", windowsTool("emulator", ["-avd", row.id], true)], options);
        if (result === null) { this.note = `Could not start ${row.name}`; this.noteError = true; }
      } else if (row.kind === "sim") {
        await this.tool(row.m, "xcrun", ["simctl", "boot", row.id], 60000);
        await this.tool(row.m, "open", ["-a", "Simulator"]);
      }
      this.refresh(cx);
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const all = this.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));
    const total = all.length;
    const online = all.filter((r) => r.state === "online").length;
    const physical = all.filter(r => r.kind === "android" && !r.emulator).length;
    const where = (machine) => machine ?? "This computer";
    // Put every machine's connected hardware above the potentially long AVD catalog.
    const ordered = [false, true].flatMap(stopped => this.groups.map(g => ({ ...g,
      sections: g.sections.map(s => ({ ...s, rows: s.rows.filter(r => (r.state === "stopped") === stopped) })).filter(s => s.rows.length),
    })).filter(g => g.sections.length || !stopped));
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
          .child(div().text_color(t.muted).child(this.loading ? "scanning…" : `${physical} Android connections · ${online} online · ${total - online} not connected`))
          .child(div().flex_1())
          .child(div().id("devices-refresh").px(8).py(2).rounded(6).cursor_pointer().text_color(t.muted)
            .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx)).child("Refresh"))
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
      .child(h_flex().flex_none().h(34).gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.muted).child("Wi-Fi ADB · This computer"))
        .child(div().id("devices-wifi-address").relative().flex_1().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
          .when(!this.wifiInput.value(), el => el.child(div().absolute().left(8).text_color(t.dim).text_size(12).child("IP:port · 192.168.1.20:37123")))
          .child(Input.new(this.wifiInput).w_full().h_full()))
        .child(div().id("devices-wifi-connect").flex_none().px(10).py(5).rounded(6).bg(t.raised).cursor_pointer()
          .on_click((_e, cx) => this.connectWifi(cx)).child(this.wifiBusy ? "Connecting…" : "Connect")))
      .child(div().flex_none().text_size(10).text_color(t.dim).child("Use the connection port from Android Wireless debugging. Pair with this computer first."))
      .child(
        v_flex()
          .id("devices-list")
          .flex_1()
          .gap(2)
          .overflow_y_scrollbar()
          .children(
            ordered.flatMap((g) => [
              div().pt(10).font_semibold().text_size(14).text_color(t.foreground).child(where(g.machine)),
              ...(g.sections.length || !g.adbMissing || g.loading ? [] : [div().px(8).text_color(t.dim).child("ADB unavailable · check platform-tools / ANDROID_HOME")]),
              ...(g.sections.length || g.adbMissing ? [] : [div().px(8).text_color(t.dim).child(g.loading ? "scanning…" : "No connected devices reported by ADB")]),
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
      .when(Boolean(this.note), (el) => el.child(div().text_color(this.noteError ? t.blocked : t.done).child(this.note)));
  }
}
