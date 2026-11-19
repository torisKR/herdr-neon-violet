// Play check: what a developer account has on Google Play, app by app.
//   - every app of the account with its releases on each track (production, open, closed, internal):
//     published, in review, rejected, approved but not published, draft
//   - whether the public store page answers, the developer it names, and the project folder that builds the app
//   - filters for what needs a look; Open goes to the store page, Space to the project's space
// bin/nv-play.mjs asks Google (read only, no tokens) and keeps the last answer. This mod runs it on
// this computer and on every connected machine, so an account is checked where its key file is.
// Open it as a tab: tab.new { mod: "nv-play" } (Ctrl+Shift+L).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, checking, exec, machines, readTextFile, run, settings, shared, spaces, theme, window as win } from "herdr";

const POLL_MS = 900000, MAX_AGE_MIN = 60, TOP_H = 40;
const TRACKS = ["production", "beta", "alpha", "internal"];
const FILTERS = { all: () => true, review: a => a.state === "review", look: a => ["rejected", "ready", "draft", "other"].includes(a.state) || Boolean(a.error) || (a.live && a.store === "missing"),
  live: a => a.live, testing: a => a.state === "testing" || a.state === "none" };
const TEXT = {
  en: { title: "Play check", all: "All", review: "In review", look: "Needs a look", live: "Published", testing: "Testing only", refresh: "Check now", checkingNow: "Asking Google Play…", loading: "Reading…",
    addAccount: "+ Account", local: "This computer", apps: "apps", checked: "checked {ago} ago", never: "not checked yet", failed: "The last check failed: {why}",
    empty: "No Play account yet. Add a service-account key (the JSON file fastlane uploads with) to see every app of the account.",
    name: "Account name", key: "Path of the key file (.json) on that machine", where: "Machine", save: "Add and check", cancel: "Cancel", remove: "Remove account",
    states: { live: "Published", review: "In review", rejected: "Rejected", ready: "Approved, not published", draft: "Draft, not sent", testing: "Testing only", none: "No release", other: "Production" },
    release: { published: "published", in_review: "in review", not_approved: "rejected", approved_not_published: "approved, not published", draft: "draft", not_sent_for_review: "not sent for review" },
    tracks: { production: "Production", beta: "Open test", alpha: "Closed test", internal: "Internal" },
    developer: "Developer", storeLive: "store page is public", storeMissing: "no public store page", open: "Store page", space: "Open space", none: "Nothing here." },
  ko: { title: "Play 체크", all: "전체", review: "검토 중", look: "확인 필요", live: "출시됨", testing: "테스트만", refresh: "지금 확인", checkingNow: "Google Play 에 묻는 중…", loading: "읽는 중…",
    addAccount: "+ 계정", local: "이 컴퓨터", apps: "개 앱", checked: "{ago} 전 확인", never: "아직 확인 안 함", failed: "마지막 확인 실패: {why}",
    empty: "아직 Play 계정이 없습니다. 서비스 계정 키(fastlane 이 업로드에 쓰는 JSON 파일)를 추가하면 그 계정의 모든 앱이 나옵니다.",
    name: "계정 이름", key: "그 머신에 있는 키 파일(.json) 경로", where: "머신", save: "추가하고 확인", cancel: "취소", remove: "계정 빼기",
    states: { live: "출시됨", review: "검토 중", rejected: "반려됨", ready: "승인됨 · 게시 대기", draft: "초안 · 미제출", testing: "테스트만", none: "출시 없음", other: "프로덕션" },
    release: { published: "출시됨", in_review: "검토 중", not_approved: "반려됨", approved_not_published: "승인됨 · 게시 대기", draft: "초안", not_sent_for_review: "검토 미제출" },
    tracks: { production: "프로덕션", beta: "공개 테스트", alpha: "비공개 테스트", internal: "내부 테스트" },
    developer: "개발자", storeLive: "스토어 페이지 공개", storeMissing: "스토어 페이지 없음", open: "스토어 페이지", space: "공간 열기", none: "해당하는 앱이 없습니다." },
};
const language = value => { const k = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0]; return Object.hasOwn(TEXT, k) ? k : null; };
const copy = () => TEXT[language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en"];
const norm = path => String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const clipText = (text, max) => { const s = String(text ?? ""); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/** "3m", "2h", "5d": how long ago, short. */
function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

export default class PlayCheck extends View {
  init(_props, cx) {
    this.groups = [];          // one per machine: { machine, accounts }
    this.filter = Object.hasOwn(FILTERS, localStorage.getItem("filter")) ? localStorage.getItem("filter") : "all";
    this.form = null;          // { machine } while the account form is open
    this.note = null;
    this.inputs = { name: InputState.new({ placeholder: copy().name }), key: InputState.new({ placeholder: copy().key }) };
    this.inputs.key.on("submit", (_e, cx) => this.saveAccount(cx));
    if (checking()) return;
    cx.timer.every(POLL_MS, cx => this.load(cx));
    this.load(cx);
  }

  /** Runs one nv-play command on a machine (null: this computer) and returns what it answered. */
  async call(machine, request) {
    if (!this.source) {
      this.source = await readTextFile(`${appHome()}/bin/nv-play.mjs`);
      if (!this.source) throw new Error("bin/nv-play.mjs is missing: install this pack again");
    }
    const script = `${this.source}\nrun(${JSON.stringify(request)}).then(r => r, e => ({ error: String(e && e.message || e) })).then(r => { console.log(JSON.stringify(r)); process.exit(0); });`;
    const r = await exec("node", ["--input-type=module", "-e", script], { on: machine, timeout: 240000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "node failed").trim().slice(0, 200));
    const data = JSON.parse(r.stdout);
    if (data.error) throw new Error(data.error);
    return data;
  }

  /** Reads what every machine last saw, at once. With flags.refresh Google is asked again; without it, a check
   *  follows by itself when the last answer of an account is older than MAX_AGE_MIN. */
  load(cx, flags = {}) {
    if (this.loading) return;
    this.loading = true; this.asking = Boolean(flags.refresh);
    cx.spawn(async cx => {
      const names = [...new Set([null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)])];
      const groups = await Promise.all(names.map(async machine => {
        try { return { machine, accounts: (await this.call(machine, { command: "list", flags })).accounts }; }
        // A machine without Node or without an account is left out quietly; this computer says why.
        catch (error) { return { machine, accounts: [], error: machine ? null : String(error.message ?? error) }; }
      }));
      this.groups = groups; this.loaded = true; this.loading = false; this.asking = false;
      this.note = groups.find(g => g.error)?.error ?? null;
      cx.notify();
      const old = a => !a.at || Date.now() - Date.parse(a.at) > MAX_AGE_MIN * 60000;
      if (!flags.refresh && groups.some(g => g.accounts.some(old))) this.load(cx, { refresh: true });
    });
  }

  saveAccount(cx) {
    const f = this.form, name = this.inputs.name.value().trim(), key = this.inputs.key.value().trim();
    if (!f || !name || !key) return;
    this.form = null;
    cx.spawn(async cx => {
      try { await this.call(f.machine, { command: "account", args: ["add", name, key] }); this.note = null; this.loading = false; this.load(cx, { refresh: true }); }
      catch (error) { this.note = String(error.message ?? error); }
      cx.notify();
    });
  }

  removeAccount(machine, id, cx) {
    cx.spawn(async cx => {
      try { await this.call(machine, { command: "account", args: ["remove", id] }); this.note = null; }
      catch (error) { this.note = String(error.message ?? error); }
      this.loading = false; this.load(cx);
      cx.notify();
    });
  }

  /** Every account with the machine it is on. */
  accounts() { return this.groups.flatMap(g => g.accounts.map(a => ({ a, machine: g.machine }))); }

  openStore(pkg) {
    const url = `https://play.google.com/store/apps/details?id=${pkg}`, p = win().platform;
    if (p === "windows") exec("cmd", ["/c", "start", "", url]);
    else exec(p === "macos" ? "open" : "xdg-open", [url]);
  }

  /** Goes to the space of the app's project folder, or makes one there on its machine. */
  openSpace(app, machine) {
    const space = spaces().find(s => (s.machine ?? null) === machine && norm(s.folder) === norm(app.folder));
    if (space) run("space.select", { id: space.id }); else run("space.new", { name: app.name.split(/[:\-–]/)[0].trim().slice(0, 24) || app.package, folder: app.folder, ...(machine ? { machine } : {}) });
  }

  // ------------------------------------------------------------------ drawing

  button(id, label, onClick, t, { primary = false, active = false, danger = false, small = false } = {}) {
    return div().id(id).px(small ? 7 : 10).py(small ? 2 : 4).rounded(6).flex_none().text_size(small ? 11 : 12).cursor_pointer()
      .bg(primary ? t.accent : active ? t.selected : t.raised).text_color(primary ? t.accent_foreground : danger ? t.blocked : active ? t.foreground : t.muted)
      .hover(s => s.opacity(0.85)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
  }

  tint(state, t) { return state === "rejected" ? t.blocked : state === "review" || state === "ready" ? t.accent : state === "live" ? t.done : t.muted; }

  topBar(t, l, apps) {
    const set = value => { this.filter = value; localStorage.setItem("filter", value); };
    return h_flex().id("play-top").h(TOP_H).flex_none().px(12).gap(8).items_center().bg(t.chrome).border_b_1().border_color(t.border)
      .child(div().font_semibold().text_size(13).flex_none().child(l.title))
      .children(Object.keys(FILTERS).map(f => this.button(`filter-${f}`, `${l[f]} ${apps.filter(FILTERS[f]).length}`, () => set(f), t, { active: this.filter === f, small: true })))
      .child(div().flex_1())
      .when(Boolean(this.asking), el => el.child(div().id("asking").flex_none().text_size(11).text_color(t.dim).child(l.checkingNow)))
      .child(this.button("add-account", l.addAccount, () => { this.form = this.form ? null : { machine: null }; }, t, { active: Boolean(this.form) }))
      .child(this.button("refresh", l.refresh, cx => this.load(cx, { refresh: true }), t, { primary: true }));
  }

  accountForm(t, l) {
    const names = [...new Set([null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)])];
    const field = f => h_flex().id(`field-${f}`).flex_1().h(28).px(8).rounded(6).bg(t.raised).items_center().child(Input.new(this.inputs[f]).w_full().h_full().text_size(12).text_color(t.foreground));
    return v_flex().id("account-form").m(12).p(10).gap(8).rounded(8).border_1().border_color(t.accent).flex_none()
      .child(h_flex().gap(6).items_center().child(div().w(84).flex_none().text_size(11).text_color(t.dim).child(l.where))
        .children(names.map(m => this.button(`on-${m ?? "local"}`, m ?? l.local, () => { this.form.machine = m; }, t, { active: this.form.machine === m, small: true }))))
      .child(h_flex().gap(8).items_center().child(h_flex().w(200).flex_none().child(field("name"))).child(field("key")))
      .child(h_flex().gap(6)
        .child(this.button("save-account", l.save, cx => this.saveAccount(cx), t, { primary: true }))
        .child(this.button("cancel-account", l.cancel, () => { this.form = null; }, t)));
  }

  appRow(app, machine, t, l, owner) {
    const k = app.package;
    const chips = TRACKS.flatMap(track => (app.tracks?.[track] ?? []).map((r, i) => div().id(`release-${k}-${track}-${i}`).px(6).py(1).rounded(8).flex_none().text_size(10).bg(t.raised)
      .text_color(r.state === "not_approved" ? t.blocked : r.state === "in_review" || r.state === "approved_not_published" ? t.accent : r.state === "published" && track === "production" ? t.done : t.muted)
      .child(`${l.tracks[track]} ${clipText(r.name || (r.codes ?? []).join(", "), 26)} · ${l.release[r.state] ?? r.state}`)));
    return v_flex().id(`app-${k}`).px(10).py(7).gap(4).rounded(8).bg(t.surface).border_1().border_color(app.state === "rejected" ? t.blocked : app.state === "review" ? t.accent : t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().id(`state-${k}`).w(112).flex_none().text_size(11).font_semibold().text_color(this.tint(app.state, t)).child(l.states[app.state] ?? app.state))
        .child(div().font_semibold().text_size(13).truncate().child(app.name))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(app.package))
        .when(Boolean(app.developer) && app.developer !== owner, el => el.child(div().id(`developer-${k}`).flex_none().text_size(10).text_color(t.accent).child(`${l.developer} ${app.developer}`)))
        .child(div().flex_1())
        .when(Boolean(app.store), el => el.child(div().id(`store-${k}`).flex_none().text_size(10).text_color(app.store === "live" ? t.done : app.live ? t.blocked : t.dim).child(app.store === "live" ? l.storeLive : l.storeMissing)))
        .when(app.store === "live", el => el.child(this.button(`open-${k}`, l.open, () => this.openStore(app.package), t, { small: true })))
        .when(Boolean(app.folder), el => el.child(this.button(`space-${k}`, l.space, () => this.openSpace(app, machine), t, { small: true }))))
      .when(chips.length > 0, el => el.child(h_flex().gap(5).flex_wrap().pl(120).children(chips)))
      .when(Boolean(app.error), el => el.child(div().id(`error-${k}`).pl(120).text_size(10).text_color(t.blocked).child(String(app.error))));
  }

  render() {
    const t = theme(), l = copy(), accounts = this.accounts(), all = accounts.flatMap(x => x.a.apps), now = Date.now();
    const section = ({ a, machine }) => {
      const shown = a.apps.filter(FILTERS[this.filter]), k = `${machine ?? ""}/${a.id}`;
      return v_flex().id(`account-${k}`).gap(6)
        .child(h_flex().gap(8).items_center()
          .child(div().font_semibold().text_size(12).child(a.name))
          .when((a.developers ?? []).length > 0, el => el.child(div().id(`developers-${k}`).text_size(11).text_color(t.accent).child(`${l.developer} ${a.developers.join(", ")}`)))
          .child(div().text_size(11).text_color(t.dim).child(`${machine ?? l.local} · ${a.apps.length}${l.apps.startsWith("개") ? "" : " "}${l.apps} · ${a.at ? l.checked.replace("{ago}", ago(a.at, now)) : l.never}`))
          .child(div().flex_1())
          .child(this.button(`remove-${k}`, l.remove, cx => this.removeAccount(machine, a.id, cx), t, { small: true, danger: true })))
        .when(Boolean(a.error), el => el.child(div().id(`failed-${k}`).text_size(11).text_color(t.blocked).child(l.failed.replace("{why}", a.error))))
        .children(shown.map(app => this.appRow(app, machine, t, l, a.developers?.[0])))
        .when(shown.length === 0 && Boolean(a.at), el => el.child(div().id(`none-${k}`).p(10).text_size(11).text_color(t.dim).child(l.none)));
    };
    return v_flex().id("nv-play").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12)
      .child(this.topBar(t, l, all))
      .when(Boolean(this.note), el => el.child(div().id("note").px(12).py(5).flex_none().text_size(11).text_color(t.blocked).bg(t.surface).child(String(this.note))))
      .when(Boolean(this.form), el => el.child(this.accountForm(t, l)))
      .when(!this.loaded, el => el.child(div().id("loading").p(24).text_color(t.dim).child(l.loading)))
      .when(Boolean(this.loaded) && accounts.length === 0 && !this.form, el => el.child(v_flex().id("empty").flex_1().items_center().justify_center().gap(12).p(24)
        .child(div().text_color(t.muted).child(l.empty))
        .child(this.button("empty-add", l.addAccount, () => { this.form = { machine: null }; }, t, { primary: true }))))
      .when(Boolean(this.loaded) && accounts.length > 0, el => el.child(v_flex().id("play-body").flex_1().min_h(0).p(12).gap(16).overflow_y_scrollbar().children(accounts.map(section))));
  }
}
