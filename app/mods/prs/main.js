// Pull requests — the open PRs of the repository you are working in: read one,
// comment on it, merge it. Uses the GitHub CLI (`gh`) on the machine the space lives on,
// so it works for spaces on other machines too.
//
// Open it beside your terminals: pane.split { direction: "right", mod: "prs" }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { checking, spaces, panes, focused, exec, props, theme, window as win } from "herdr";

const LIST_FIELDS = "number,title,author,headRefName,baseRefName,isDraft,reviewDecision,updatedAt";
const VIEW_FIELDS = "number,title,body,author,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,additions,deletions,headRefName,headRefOid,baseRefName,comments,files,statusCheckRollup";
const METHODS = ["squash", "merge", "rebase"];

// Where the focused pane is: its folder and the machine it runs on.
function location(p = {}) {
  if (p.cwd) return { cwd: p.cwd, on: p.on ?? null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  if (f?.terminal && (f.cwd || pane?.cwd)) return { cwd: f.cwd || pane.cwd, on };
  const folders = [...new Set(panes().filter((p) => p.tab === f?.tab && p.terminal && p.cwd).map((p) => p.cwd))];
  return { cwd: folders.length === 1 ? folders[0] : null, on };
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Summary of the checks: { pass, fail, pending }.
function checks(rollup) {
  const out = { pass: 0, fail: 0, pending: 0 };
  for (const c of rollup ?? []) {
    const result = (c.conclusion || c.state || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(result)) out.pass++;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(result)) out.fail++;
    else out.pending++;
  }
  return out;
}

export default class PullRequests extends View {
  init(_props, cx) {
    this.list = []; this.pr = null; this.open = null; this.method = "squash"; this.comment = "";
    const source = location(props() ?? {});
    this.cwd = source.cwd; this.on = source.on; this.context = JSON.stringify(source);
    this.drafts = new Map(); this.draftVersion = 0;
    if (!this.cwd) this.error = "Cannot choose a repository safely. Focus its terminal and open Pull requests from the + menu.";
    // props { number: 12 } opens that pull request right away
    this.wanted = Number(props()?.number) || null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Write a comment" });
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.comment.trim());
      const text = this.input.value();
      if (text === this.comment) return;
      this.comment = text;
      if (this.open) this.drafts.set(this.draftKey(), { text, version: ++this.draftVersion });
      if (had !== Boolean(this.comment.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.sendComment(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  gh(args) {
    return exec("gh", args, { cwd: this.cwd, on: this.on, timeout: 60000 });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const context = this.context;
    if (!this.cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await this.gh(["pr", "list", "--state", "open", "--limit", "50", "--json", LIST_FIELDS]);
        if (this.context !== context) return;
        if (r.code !== 0) {
          const text = (r.stderr || r.stdout).trim();
          this.list = [];
          this.error = /not a git repository/i.test(text) ? "Not a git repository"
            : /no git remotes|none of the git remotes/i.test(text) ? "This folder has no GitHub remote"
            : /gh auth login|not logged in/i.test(text) ? "GitHub CLI is not signed in here. Run: gh auth login"
            : text.split("\n")[0] || "Could not list pull requests";
          return;
        }
        this.list = JSON.parse(r.stdout);
        this.error = null;
        if (this.wanted) { this.select(this.wanted); this.wanted = null; }
        if (this.open && !this.list.some((p) => p.number === this.open)) { this.select(null); this.pr = null; }
        if (this.open) await this.load(this.open, context);
      } catch (e) {
        if (this.context === context) this.error = /No such file|not found|cannot find/i.test(String(e)) ? "GitHub CLI (gh) is not installed on this machine" : String(e);
      } finally { this.loading = false; cx.notify(); }
    });
  }

  async load(number, context) {
    const r = await this.gh(["pr", "view", String(number), "--json", VIEW_FIELDS]);
    if (this.context !== context || this.open !== number) return;
    if (r.code !== 0) { this.note = (r.stderr || r.stdout).trim().split("\n")[0]; return; }
    const pr = JSON.parse(r.stdout);
    if (this.confirm && this.confirm.head !== pr.headRefOid) this.confirm = false;
    this.pr = pr;
  }

  draftKey(number = this.open) {
    return JSON.stringify([this.context, number]);
  }

  select(number) {
    this.open = number;
    this.comment = this.drafts.get(this.draftKey())?.text ?? "";
    this.input.set_value(this.comment);
  }

  pick(number, cx) {
    this.select(this.open === number ? null : number);
    this.pr = null; this.note = null; this.confirm = false;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(number, context); } catch (e) { this.note = String(e); }
      cx.notify();
    });
    cx.notify();
  }

  // Runs one writing action (comment, merge) and reloads.
  act(cx, label, args, after) {
    if (this.busy || !this.open) return;
    const context = this.context;
    this.busy = label; this.note = null; this.confirm = false;
    cx.spawn(async (cx) => {
      try {
        const r = await this.gh(args);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        if (this.context === context) after?.();
      } catch (e) { if (this.context === context) this.note = `${label} failed: ${e.message ?? e}`; }
      finally { this.busy = null; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  sendComment(cx) {
    const body = this.comment.trim();
    if (!body || this.pr?.number !== this.open || this.pr?.state !== "OPEN") return;
    const number = this.open, key = this.draftKey(), draft = this.drafts.get(key);
    this.act(cx, "Comment", ["pr", "comment", String(number), "--body", body], () => {
      if (this.drafts.get(key) === draft) {
        this.drafts.delete(key);
        if (this.open === number) { this.comment = ""; this.input.set_value(""); }
      }
      if (this.open === number) this.done = "Comment posted";
    });
  }

  merge(cx) {
    if (!this.canMerge()) return;
    const number = this.open, head = this.pr.headRefOid;
    // First press arms it, second press merges.
    if (!this.confirm || this.confirm.number !== number || this.confirm.head !== head || this.confirm.method !== this.method) {
      this.confirm = { number, head, method: this.method }; this.done = null; cx.notify(); return;
    }
    this.act(cx, "Merge", ["pr", "merge", String(number), `--${this.method}`, "--match-head-commit", this.confirm.head], () => {
      if (this.open === number) { this.done = `Merged #${number}`; this.select(null); this.pr = null; }
    });
  }

  canMerge() {
    return Boolean(this.open && this.pr?.number === this.open && this.pr.state === "OPEN" && !this.busy && !this.pr.isDraft
      && this.pr.mergeable === "MERGEABLE" && /^[0-9a-f]{40}$/i.test(this.pr.headRefOid ?? ""));
  }

  openInBrowser(url) {
    const p = win().platform;
    if (p === "windows") exec("cmd", ["/c", "start", "", url]);
    else exec(p === "macos" ? "open" : "xdg-open", [url]);
  }

  button(id, text, t, { primary, danger, enabled = true, onClick }) {
    const bg = !enabled ? t.raised : danger ? t.blocked : primary ? t.solid : t.raised;
    const fg = !enabled ? t.dim : danger || primary ? (danger ? "#ffffff" : t.solid_foreground) : t.foreground;
    return div().id(id).h(30).px(12).flex().flex_none().items_center().rounded(8).bg(bg).text_color(fg).text_size(12)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (enabled) onClick(cx); })
      .child(text);
  }

  detail(t) {
    const pr = this.pr;
    if (!pr) return div().p(14).text_color(t.dim).child(this.note || "Loading…");
    const c = checks(pr.statusCheckRollup);
    const mergeable = pr.mergeable === "MERGEABLE";
    const state = pr.isDraft ? "Draft" : pr.mergeable === "CONFLICTING" ? "Has conflicts" : mergeable ? "Ready to merge" : "Checking mergeability";
    const comments = pr.comments ?? [];
    return v_flex().id("pr-detail").size_full().overflow_y_scrollbar().p(14).gap(10)
      .child(div().font_semibold().text_size(15).child(`#${pr.number}  ${pr.title}`))
      .child(h_flex().gap(8).flex_wrap().text_size(11).text_color(t.muted)
        .child(div().child(`${pr.author?.login ?? "unknown"} wants to merge ${pr.headRefName} into ${pr.baseRefName}`))
        .child(div().text_color(t.ansi2).child(`+${pr.additions}`)).child(div().text_color(t.ansi1).child(`−${pr.deletions}`)))
      .child(h_flex().gap(8).flex_wrap().text_size(11)
        .child(div().px(6).py(1).rounded(4).border_1().border_color(t.border).text_color(mergeable && !pr.isDraft ? t.done : t.working).child(state))
        .when(c.pass + c.fail + c.pending > 0, (e) => e.child(div().px(6).py(1).rounded(4).border_1().border_color(t.border)
          .text_color(c.fail ? t.blocked : c.pending ? t.working : t.done)
          .child(`checks: ${c.pass} passed${c.fail ? ` · ${c.fail} failed` : ""}${c.pending ? ` · ${c.pending} running` : ""}`)))
        .when(Boolean(pr.reviewDecision), (e) => e.child(div().px(6).py(1).rounded(4).border_1().border_color(t.border).text_color(t.muted)
          .child(String(pr.reviewDecision).replace(/_/g, " ").toLowerCase()))))
      .child(div().text_size(13).child(pr.body?.trim() ? TextView.markdown(`pr-body-${pr.number}`, pr.body).selectable(true) : div().text_color(t.dim).child("No description")))
      .child(div().pt(4).font_semibold().text_color(t.muted).child(`Files changed (${(pr.files ?? []).length})`))
      .children((pr.files ?? []).slice(0, 200).map((f) =>
        h_flex().gap(8).text_size(12)
          .child(div().flex_1().min_w(0).truncate().child(f.path))
          .child(div().flex_none().text_color(t.ansi2).child(`+${f.additions}`))
          .child(div().flex_none().text_color(t.ansi1).child(`−${f.deletions}`))))
      .child(div().pt(4).font_semibold().text_color(t.muted).child(`Comments (${comments.length})`))
      .children(comments.slice(-30).map((m, i) =>
        v_flex().gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(h_flex().gap(8).text_size(11).child(div().font_semibold().text_color(t.accent).child(m.author?.login ?? "unknown")).child(div().text_color(t.dim).child(`${ago(m.createdAt)} ago`)))
          .child(div().text_size(12).child(TextView.markdown(`pr-comment-${pr.number}-${i}`, m.body ?? "").selectable(true)))));
  }

  render(cx) {
    const t = theme(), pr = this.pr;
    const canComment = Boolean(this.open && pr?.number === this.open && pr.state === "OPEN" && this.comment.trim() && !this.busy);
    const canMerge = this.canMerge();
    return v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.cwd ? `${this.on ? `${this.on}: ` : ""}${this.cwd}` : "No repository"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.list.length} open`))
        .child(div().flex_1())
        .child(div().id("prs-refresh").px(8).py(2).rounded(6).text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx)).child(this.loading ? "Loading…" : "Refresh")))
      .child(div().flex_none().min_h(44).max_h(240).h(this.list.length * 30 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("prs-list").absolute().inset_0().overflow_y_scrollbar().p(6).children(this.list.map((p) =>
          h_flex().id(`pr-${p.number}`).h(30).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
            .when(this.open === p.number, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.pick(p.number, cx))
            .child(div().flex_none().w(8).h(8).rounded_full().bg(p.isDraft ? t.dim : p.reviewDecision === "APPROVED" ? t.done : p.reviewDecision === "CHANGES_REQUESTED" ? t.blocked : t.working))
            .child(div().flex_none().text_color(t.accent).child(`#${p.number}`))
            .child(div().flex_1().min_w(0).truncate().child(p.title))
            .child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.muted).child(p.author?.login ?? ""))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(p.updatedAt)))))
          .when(!this.list.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading pull requests…" : "No open pull requests"))))))
      .child(div().flex_1().min_h(0).child(this.open ? this.detail(t) : div().p(14).text_color(t.dim).child(this.done || (this.list.length ? "Select a pull request" : ""))))
      .when(Boolean(this.note && this.pr), (e) => e.child(div().px(12).py(6).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(Boolean(this.done && this.open), (e) => e.child(div().px(12).py(6).text_size(11).text_color(t.done).child(this.done)))
      .when(Boolean(this.open), (el) => el
        .child(h_flex().flex_none().px(10).pt(10).gap(8).border_t(1).border_color(t.border)
          .child(div().id("pr-comment-input").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .child(this.button("pr-comment", this.busy === "Comment" ? "Posting…" : "Comment", t, { primary: true, enabled: canComment, onClick: (cx) => this.sendComment(cx) })))
        .child(h_flex().flex_none().p(10).gap(6).items_center()
          .children(METHODS.map((m) =>
            div().id(`pr-method-${m}`).h(30).px(10).flex().flex_none().items_center().rounded(8).text_size(12).cursor_pointer()
              .border_1().border_color(this.method === m ? t.accent : t.border).text_color(this.method === m ? t.foreground : t.muted)
              .on_click((_e, cx) => { this.method = m; this.confirm = false; cx.notify(); }).child(m)))
          .child(div().flex_1())
          .child(this.button("pr-web", "Open on GitHub", t, { enabled: Boolean(pr?.url), onClick: () => this.openInBrowser(pr.url) }))
          .child(this.button("pr-merge", this.busy === "Merge" ? "Merging…" : this.confirm ? `Click again to ${this.method} #${this.open}` : "Merge", t,
            { primary: !this.confirm, danger: this.confirm, enabled: canMerge, onClick: (cx) => this.merge(cx) }))));
  }
}
