// Editor — a file in the main area, as a tab or a pane: syntax highlighting, line numbers,
// folding, editing with save, and a rendered preview for Markdown.
//
// Open one with: tab.new { mod: "editor", name: "main.rs", props: { file: "/abs/path/main.rs", on: null } }
// Keys (keys.json, section "mod:editor"): editor.save, editor.preview, editor.wrap.
// Files on another machine open read-only.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { checking, nextCommand, props, readTextFile, settings, theme, writeTextFile } from "herdr";

// Extension -> the editor's language. Languages without a grammar of their own
// (Dart, Kotlin, Gradle, PHP …) borrow the closest C-like one so keywords, strings
// and comments still get color.
const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  dart: "js", kt: "js", kts: "js", gradle: "js", groovy: "js", php: "js", scala: "js",
  toml: "yaml", yml: "yaml", lock: "yaml", ini: "yaml", conf: "yaml", env: "yaml", properties: "yaml",
  jsonc: "json", json5: "json", arb: "json", ipynb: "json", webmanifest: "json",
  svelte: "html", vue: "html", xml: "html", plist: "html", svg: "html", storyboard: "html", xib: "html", htm: "html",
  markdown: "md", mdx: "md", mmd: "md",
  zsh: "sh", bash: "sh", fish: "sh", command: "sh",
  h: "c", hpp: "cpp", cc: "cpp", cxx: "cpp", mm: "cpp", m: "c",
  pyi: "py", scss: "css", less: "css",
};
const MARKDOWN = new Set(["md", "markdown", "mdx"]);

const extension = (file) => {
  const name = file.split(/[\\/]/).pop() ?? "";
  if (/^(Dockerfile|Makefile|Gemfile|Podfile|Fastfile)$/i.test(name)) return name.toLowerCase() === "dockerfile" ? "sh" : "rb";
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
};

export default class EditorPane extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.file = p.file ?? null;
    this.on = p.on ?? null;
    this.ext = this.file ? extension(this.file) : "txt";
    this.preview = MARKDOWN.has(this.ext);
    this.wrap = MARKDOWN.has(this.ext);
    this.dirty = false;
    if (checking() || !this.file) return;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "save") this.save(cx);
        else if (command === "preview") this.preview = !this.preview;
        else if (command === "wrap") this.setWrap(!this.wrap, cx);
        else if (command === "focus") this.state?.focus();
        cx.notify();
      }
    });
  }

  build(value, cx) {
    const t = theme();
    this.state?.release();
    this.state = EditorState.new({
      language: LANG[this.ext] ?? this.ext,
      value,
      readonly: this.readonly,
      soft_wrap: this.wrap,
      font_family: settings().font_family,
      font_size: 13,
      syntax: {
        keyword: t.ansi5, string: t.ansi2, "string.escape": t.ansi6, comment: t.dim, function: t.ansi4, type: t.ansi3,
        number: t.ansi11, constant: t.ansi6, boolean: t.ansi1, operator: t.muted, punctuation: t.muted, variable: t.foreground,
      },
    });
    this.state.on("change", (_e, cx) => {
      const dirty = this.state.value() !== this.original;
      if (dirty !== this.dirty) { this.dirty = dirty; this.note = null; cx.notify(); }
    });
    cx?.notify();
  }

  load(cx) {
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.file, { on: this.on });
        if (text === null) this.error = "This file is no longer available";
        else if (text.includes("\0")) this.error = "Binary file · no text view";
        else {
          const cut = text.length > 400000;
          this.original = cut ? text.slice(0, 400000) + "\n… (file truncated)" : text;
          // Remote files and truncated ones cannot be written back safely.
          this.readonly = Boolean(this.on) || cut;
          this.dirty = false;
          this.build(this.original, cx);
        }
      } catch (e) {
        this.error = `Cannot open this file: ${e}`;
      }
      cx.notify();
    });
  }

  save(cx) {
    if (!this.state || !this.dirty || this.readonly || this.saving) return;
    const value = this.state.value();
    this.saving = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(this.file, value, this.original);
        this.original = value;
        this.dirty = this.state.value() !== value;
        this.note = { text: "Saved", ok: true };
      } catch (e) {
        this.note = { text: `Not saved: ${String(e).slice(0, 120)}`, ok: false };
      }
      this.saving = false;
      cx.notify();
    });
    cx.notify();
  }

  setWrap(wrap, cx) {
    if (!this.state) return;
    this.wrap = wrap;
    this.build(this.state.value(), cx);
  }

  chip(id, text, t, active, onClick) {
    return div().id(id).px(8).py(2).rounded(6).text_size(11).cursor_pointer().border_1()
      .border_color(active ? t.accent : t.border).text_color(active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => onClick(cx))
      .child(text);
  }

  render() {
    const t = theme();
    if (!this.file) return div().size_full().p(16).text_color(t.dim).child("No file. Open one from the Files panel.");
    const parts = this.file.split(/[\\/]/), name = parts.pop();
    const markdown = MARKDOWN.has(this.ext);
    const canSave = this.dirty && !this.readonly && !this.saving;
    return v_flex().id("editor").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(38).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(`${name}${this.dirty ? " •" : ""}`))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${this.on ? `${this.on}: ` : ""}${parts.join("/")}`))
        .when(Boolean(this.note), (e) => e.child(div().flex_none().text_size(11).text_color(this.note.ok ? t.done : t.blocked).child(this.note.text)))
        .when(this.readonly === true, (e) => e.child(div().flex_none().text_size(11).text_color(t.working).child(this.on ? "read-only (remote)" : "read-only")))
        .child(div().flex_none().px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(this.ext))
        .when(markdown, (e) => e.child(this.chip("editor-preview", this.preview ? "Source" : "Preview", t, false, (cx) => { this.preview = !this.preview; cx.notify(); })))
        .child(this.chip("editor-wrap", "Wrap", t, this.wrap, (cx) => this.setWrap(!this.wrap, cx)))
        .child(this.chip("editor-reload", "Reload", t, false, (cx) => this.load(cx)))
        .child(div().id("editor-save").flex_none().px(10).py(3).rounded(6).text_size(11)
          .bg(canSave ? t.solid : t.raised).text_color(canSave ? t.solid_foreground : t.dim)
          .when(canSave, (e) => e.cursor_pointer())
          .on_click((_e, cx) => this.save(cx))
          .child(this.saving ? "Saving…" : "Save")))
      .child(this.error
        ? div().p(16).text_color(t.dim).child(this.error)
        : !this.state
          ? div().p(16).text_color(t.dim).child("Loading…")
          : this.preview && markdown
            ? div().id("editor-md").flex_1().min_h(0).overflow_y_scrollbar().px(28).py(18).text_size(14)
                .child(TextView.markdown("editor-md-view", this.state.value()).selectable(true))
            : Editor.new(this.state).flex_1().min_h(0));
  }
}
