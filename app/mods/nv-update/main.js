// Update the pack from the + menu, and watch it happen.
//   {}                     what is new (commits waiting on the remote) and the Update button
//   { terminal, repo }     the update running: a pixel courier walks Download → Install → Done
//                          above the live terminal that is doing it (git pull, then the installer)
// The installer rewrites this very mod while it runs; the window comes back with the same props
// and keeps following the same terminal. Closing the window ends the terminal.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, openOverlay, props, readTextFile, settings, shared, theme, window } from "herdr";

const TEXT = {
  en: { title: "Update", checking: "Looking for updates…", upToDate: "You have the latest version.", behind: n => `${n} update${n === 1 ? "" : "s"} waiting`, update: "Update now", again: "Install again", close: "Close",
    noPack: "Run the installer once from the repository so Herdr knows where the pack lives.", offline: "Could not reach GitHub; this is what was known last time.", branch: "branch", dirty: "The repository has uncommitted changes; they are kept (updates only fast-forward).",
    steps: { pull: "Download", install: "Install", done: "Done" }, working: "Updating…", finished: "Updated. New mods are already loaded.", failed: "The update stopped. The terminal below says why." },
  ko: { title: "업데이트", checking: "업데이트 확인 중…", upToDate: "최신 버전입니다.", behind: n => `새 업데이트 ${n}개`, update: "지금 업데이트", again: "다시 설치", close: "닫기",
    noPack: "저장소에서 설치 스크립트를 한 번 실행해 주세요. 그래야 팩 위치를 알 수 있습니다.", offline: "GitHub 에 연결하지 못했습니다. 지난번에 확인한 내용입니다.", branch: "브랜치", dirty: "저장소에 커밋하지 않은 변경이 있습니다. 그대로 두고 진행합니다(빨리 감기만 함).",
    steps: { pull: "받기", install: "설치", done: "완료" }, working: "업데이트하는 중…", finished: "업데이트했습니다. 새 모드는 이미 적용됐습니다.", failed: "업데이트가 멈췄습니다. 아래 터미널에 이유가 있습니다." },
};
const language = value => { const k = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0]; return Object.hasOwn(TEXT, k) ? k : null; };
const copy = () => TEXT[language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en"];

// The person's login shell (as in bin/nv-pipeline.mjs): herdr-core lacks their PATH on macOS and Linux.
const LOGIN = 's="${SHELL:-}"; case "$s" in */zsh|*/bash|*/sh|*/dash|*/ksh) [ -x "$s" ] || s= ;; *) s= ;; esac; ' +
  'if [ -z "$s" ]; then if [ "$(uname)" = Darwin ] && [ -x /bin/zsh ]; then s=/bin/zsh; elif [ -x /bin/bash ]; then s=/bin/bash; else s=/bin/sh; fi; fi; ' +
  'exec "$s" -lc \'exec "$@"\' sh "$@"';
const UNIX = 'echo "::step pull"; { git -C "$1" fetch origin main && git -C "$1" checkout main && git -C "$1" merge --ff-only origin/main; } || { echo "::failed pull"; sleep 900; exit 1; }; ' +
  'echo "::step install"; sh "$1/install.sh" || { echo "::failed install"; sleep 900; exit 1; }; echo "::step done"; sleep 900';

/** The command that updates: the newest main from GitHub (fetch, switch to main, fast-forward),
 *  then the installer, printing ::step markers the window follows. Local changes are never discarded:
 *  if they are in the way, git stops and the update says so. */
function updateCommand(repo, platform) {
  if (platform === "windows") {
    const q = repo.replaceAll("/", "\\").replaceAll("'", "''");
    return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `'::step pull'; git -C '${q}' fetch origin main; if ($LASTEXITCODE -eq 0) { git -C '${q}' checkout main }; if ($LASTEXITCODE -eq 0) { git -C '${q}' merge --ff-only origin/main }; if ($LASTEXITCODE -ne 0) { '::failed pull'; Start-Sleep 900; exit 1 }; ` +
      `'::step install'; & powershell -NoProfile -ExecutionPolicy Bypass -File '${q}\\install.ps1'; if ($LASTEXITCODE -ne 0) { '::failed install'; Start-Sleep 900; exit 1 }; '::step done'; Start-Sleep 900`];
  }
  return ["/bin/sh", "-c", LOGIN, "sh", "/bin/sh", "-c", UNIX, "sh", repo];
}

/** Where the update is, from the terminal's text: the last ::step or ::failed marker. */
function progress(text) {
  const marks = [...String(text).matchAll(/::(step|failed) (pull|install|done)/g)];
  const last = marks.at(-1);
  if (!last) return { step: "pull", failed: false };
  return { step: last[2], failed: last[1] === "failed" };
}

const PERSON = ["..hhhhhh..", ".hhhhhhhh.", ".hssssssh.", ".hsessesh.", ".ssssssss.", "..ssssss..", ".bbbbbbbb.", "sbbbbbbbbs", "sbbbbbbbbs", ".bbbbbbbb.", ".dd....dd."];
function sprite(rows, colors, px) {
  return v_flex().flex_none().children(rows.map(row => {
    const runs = [];
    for (const ch of row) { const last = runs.at(-1); if (last && last.ch === ch) last.n++; else runs.push({ ch, n: 1 }); }
    return h_flex().h(px).flex_none().children(runs.map(r => { const box = div().w(r.n * px).h(px).flex_none(); return colors[r.ch] ? box.bg(colors[r.ch]) : box; }));
  }));
}

export default class Update extends View {
  init(_props, cx) {
    this.terminal = props()?.terminal ?? null;
    this.repo = props()?.repo ?? null;
    this.state = { step: "pull", failed: false };
    this.info = null;
    if (checking()) return;
    if (this.terminal) {
      cx.timer.every(1000, cx => this.follow(cx));
      this.follow(cx);
    } else this.check(cx);
  }

  async close() {
    if (!checking() && /^t[0-9a-z]+$/.test(this.terminal ?? "")) await exec("hc", ["kill", this.terminal]).catch(() => {});
  }

  git(args) { return exec("git", ["-C", this.repo, ...args], { timeout: 60000 }); }

  /** What is installed and what is waiting. */
  check(cx) {
    cx.spawn(async cx => {
      try {
        const pack = JSON.parse((await readTextFile(`${appHome()}/nv-pack.json`)) ?? "null");
        if (!pack?.repo) { this.info = { missing: true }; cx.notify(); return; }
        this.repo = pack.repo;
        // Compare with what is on GitHub now, not with what was fetched last time.
        const fetched = await this.git(["fetch", "--quiet", "origin", "main"]).catch(error => ({ code: 1, stderr: String(error.message ?? error) }));
        const status = await this.git(["status", "--porcelain=v1", "--branch"]);
        const lines = status.stdout.split(/\r?\n/).filter(Boolean);
        const count = await this.git(["rev-list", "--count", "HEAD..origin/main"]).catch(() => ({ stdout: "0" }));
        const log = await this.git(["log", "--oneline", "-12", "HEAD..origin/main"]).catch(() => ({ stdout: "" }));
        const remote = await this.git(["remote", "get-url", "origin"]).catch(() => ({ stdout: "" }));
        this.info = {
          branch: /^## ([^.\s]+)/.exec(lines[0] ?? "")?.[1] ?? "?", behind: Number(count.stdout.trim()) || 0, dirty: lines.length > 1,
          commits: log.stdout.split(/\r?\n/).filter(Boolean).map(l => l.replace(/^[0-9a-f]+ /, "")),
          remote: remote.stdout.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
          offline: fetched.code !== 0,
        };
      } catch (error) { this.info = { error: String(error.message ?? error) }; }
      cx.notify();
    });
  }

  /** Starts the update in a terminal and shows it under the courier. */
  start(cx) {
    if (this.starting || !this.repo) return;
    this.starting = true;
    cx.spawn(async cx => {
      try {
        await exec("hc", ["kill", "nv-update"]).catch(() => {});
        await exec("hc", ["rm", "nv-update"]).catch(() => {});
        const r = await exec("hc", ["run", "--bg", "--json", "--no-notify", "--no-parent", "--name", "nv-update", "--cwd", this.repo, "--", ...updateCommand(this.repo, window().platform)], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        const terminal = JSON.parse(r.stdout).address;
        openOverlay({ kind: "window", key: "nv-update", width: 860, height: 600,
          layout: { type: "column", children: [
            { type: "block", size: { px: 190 }, content: { mod: "nv-update", props: { terminal, repo: this.repo } } },
            { type: "block", content: { terminal } },
          ] } });
        closeOverlay(props().overlay);
      } catch (error) { this.info = { ...(this.info ?? {}), error: String(error.message ?? error) }; this.starting = false; cx.notify(); }
    });
  }

  follow(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async cx => {
      try {
        const r = await exec("hc", ["read", this.terminal, "--lines", "80"]);
        if (r.code === 0) this.state = progress(r.stdout);
      } catch { /* the terminal is gone: the window closes with it */ }
      this.reading = false;
      cx.notify();
    });
  }

  button(id, label, onClick, t, primary = false) {
    return div().id(id).px(12).py(5).rounded(6).cursor_pointer().flex_none().bg(primary ? t.accent : t.raised).text_color(primary ? t.accent_foreground : t.foreground)
      .hover(s => s.opacity(0.85)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx)).child(label);
  }

  /** The courier walks a track of three stations and bobs while there is work. */
  running(t, l) {
    const order = ["pull", "install", "done"], at = order.indexOf(this.state.step), failed = this.state.failed, done = this.state.step === "done";
    const colors = { h: "#3b2a20", s: "#f1c9a5", e: "#1b1b1f", b: failed ? t.blocked : t.accent, d: "#3a3550" };
    const courier = sprite(PERSON, colors, 4);
    const station = (step, i) => v_flex().w(200).items_center().gap(6).flex_none()
      .child(div().h(48).flex().items_end().child(i === at ? (done || failed ? courier : courier.loop("top", { from: 0, to: -4, period: 320 })) : div().h(44)))
      .child(h_flex().w_full().items_center()
        .child(div().flex_1().h(3).bg(i <= at && i > 0 ? t.done : i === 0 ? t.chrome : t.border))
        .child(div().w(16).h(16).rounded_full().flex_none().bg(i < at || done ? t.done : i === at ? (failed ? t.blocked : t.accent) : t.raised)
          .when(i === at && !done && !failed, el => el.loop("opacity", { from: 0.4, to: 1, period: 700 })))
        .child(div().flex_1().h(3).bg(i < at ? t.done : i === 2 ? t.chrome : t.border)))
      .child(div().text_size(12).font_semibold().text_color(i <= at ? t.foreground : t.dim).child(l.steps[step]));
    return v_flex().id("nv-update-run").size_full().px(16).py(10).gap(8).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(h_flex().items_center()
        .child(div().font_semibold().text_size(13).child(l.title))
        .child(div().flex_1())
        .child(this.button("update-close", l.close, () => { const id = props()?.overlay; if (id) closeOverlay(id); }, t)))
      .child(h_flex().flex_1().items_center().justify_center().children(order.map(station)))
      .child(div().text_color(failed ? t.blocked : done ? t.done : t.muted).child(failed ? l.failed : done ? l.finished : l.working));
  }

  render() {
    const t = theme(), l = copy();
    if (this.terminal) return this.running(t, l);
    const i = this.info;
    return v_flex().id("nv-update").size_full().p(18).gap(10).bg(t.surface).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().text_size(15).child(l.title))
      .when(!i, el => el.child(div().text_color(t.muted).child(l.checking)))
      .when(Boolean(i?.missing), el => el.child(div().text_color(t.blocked).child(l.noPack)))
      .when(Boolean(i?.error), el => el.child(div().text_color(t.blocked).child(String(i.error))))
      .when(Boolean(i && !i.missing), el => el
        .child(div().text_color(i.behind ? t.accent : t.done).child(i.behind ? l.behind(i.behind) : l.upToDate))
        .child(div().text_size(11).text_color(t.dim).truncate().child(`GitHub ${i.remote || "origin"} · main${i.branch !== "main" ? ` (${l.branch} ${i.branch} → main)` : ""}`))
        .when(Boolean(i.offline), x => x.child(div().text_size(11).text_color(t.blocked).child(l.offline)))
        .when(Boolean(i.dirty), x => x.child(div().text_size(11).text_color(t.muted).child(l.dirty)))
        .child(v_flex().id("update-commits").w_full().h(180).gap(3).overflow_y_scrollbar().children((i.commits ?? []).map((c, n) => div().id(`commit-${n}`).text_size(12).text_color(t.muted).truncate().child(`• ${c}`)))))
      .child(h_flex().gap(8)
        .when(Boolean(i && !i.missing), el => el.child(this.button("update-now", i.behind ? l.update : l.again, cx => this.start(cx), t, true)))
        .child(this.button("update-dismiss", l.close, () => { const id = props()?.overlay; if (id) closeOverlay(id); }, t)));
  }
}
