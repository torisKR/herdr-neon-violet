import { View, div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, TextView } from "gpui-base";
import { appHome, checking, closeOverlay, exec, nextCommand, openOverlay, props, settings, shared, setShared, theme, window, writeTextFile } from "herdr";

const LANGUAGES = { en: "English", ja: "日本語", zh: "中文", ko: "한국어" };
const code = value => {
  const key = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGES, key) ? key : null;
};
const locale = () => code(shared("nv.language")) ?? code(settings().language) ?? code(settings().locale) ?? "en";
const TEXT = {
  en: { title: "Code highlighting", syntax: "Syntax", plain: "Plain text", wrap: "Wrap lines", highlight: "Highlight", close: "Close", auto: "Follow Herdr", saved: "Draft saved on this computer", paste: "Paste code into the editor", count: n => `${n} characters` },
  ja: { title: "コードハイライト", syntax: "構文", plain: "プレーンテキスト", wrap: "折り返し", highlight: "色分け", close: "閉じる", auto: "Herdrに従う", saved: "下書きはこの端末に保存", paste: "エディターにコードを貼り付け", count: n => `${n}文字` },
  zh: { title: "代码高亮", syntax: "语法", plain: "纯文本", wrap: "自动换行", highlight: "高亮", close: "关闭", auto: "跟随 Herdr", saved: "草稿已保存在本机", paste: "在编辑器中粘贴代码", count: n => `${n}个字符` },
  ko: { title: "코드 하이라이팅", syntax: "구문", plain: "일반 텍스트", wrap: "줄 바꿈", highlight: "구문 강조", close: "닫기", auto: "Herdr 설정 따르기", saved: "이 컴퓨터에 초안 저장", paste: "편집기에 코드를 붙여 넣으세요", count: n => `${n}자` },
};
const GRAMMARS = [["js", "JavaScript / TypeScript"], ["py", "Python"], ["rs", "Rust"], ["go", "Go"], ["json", "JSON"], ["html", "HTML"], ["css", "CSS"], ["env", ".env"], ["sh", "Shell"], ["yaml", "YAML"], ["md", "Markdown"], ["txt", null]];
const SAMPLE = 'const enabled = true;\n\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("Herdr"), 42, enabled);\n';

export default class CodeHighlighting extends View {
  init(_props, cx) {
    const grammar = localStorage.getItem("grammar");
    this.grammar = GRAMMARS.some(([key]) => key === grammar) ? grammar : "js";
    this.wrap = localStorage.getItem("wrap") === "1";
    this.highlight = localStorage.getItem("highlight") !== "0";
    this.preview = false;
    this.build(localStorage.getItem("code") ?? SAMPLE, cx);
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.state.focus();
        else if (command === "wrap") this.toggle("wrap", cx);
        else if (command === "highlight") this.toggle("highlight", cx);
        else if (command === "preview" && ["md", "html"].includes(this.grammar)) this.preview = !this.preview;
        else if (command.startsWith("syntax:")) this.selectGrammar(command.slice(7), cx);
        else if (command === "browser-preview") this.browserPreview(cx);
        else if (command.startsWith("language:")) this.setLanguage(command.slice(9));
        cx.notify();
      }
    });
  }

  setLanguage(value) {
    if (value === "auto" || Object.hasOwn(LANGUAGES, value)) setShared("nv.language", value);
  }

  build(value, cx) {
    const selection = this.state?.selected_range();
    this.state?.release();
    const t = theme();
    this.state = EditorState.new({ value, language: this.highlight ? this.grammar === "env" ? "sh" : this.grammar : "txt", soft_wrap: this.wrap,
      line_numbers: true, folding: true, font_family: settings().font_family, font_size: 14,
      syntax: { keyword: t.ansi5, string: t.ansi2, "string.escape": t.ansi6, comment: t.dim,
        function: t.ansi4, type: t.ansi3, number: t.ansi11, constant: t.ansi6, boolean: t.ansi1,
        variable: this.grammar === "env" ? t.ansi6 : t.foreground, operator: t.muted, punctuation: t.muted } });
    if (selection) this.state.set_selected_range(selection);
    this.state.on("change", (_e, cx) => { localStorage.setItem("code", this.state.value()); cx.notify(); });
    cx.notify();
  }

  selectGrammar(grammar, cx) {
    if (!GRAMMARS.some(([key]) => key === grammar)) return;
    this.grammar = grammar;
    this.preview = false;
    localStorage.setItem("grammar", grammar);
    this.build(this.state.value(), cx);
    this.state.focus();
  }

  toggle(key, cx) {
    this[key] = !this[key];
    localStorage.setItem(key, this[key] ? "1" : "0");
    this.build(this.state.value(), cx);
    this.state.focus();
  }

  browserPreview(cx) {
    if (this.grammar !== "html" || this.previewBusy) return;
    this.previewBusy = true;
    this.previewError = null;
    const html = this.state.value();
    cx.spawn(async cx => {
      let input;
      try {
        const helper = `${appHome()}/bin/nv-preview.mjs`;
        const reserved = await exec("node", [helper, "reserve", appHome()]);
        if (reserved.code !== 0) throw new Error(reserved.stderr || reserved.stdout);
        input = JSON.parse(reserved.stdout).input;
        await writeTextFile(input, JSON.stringify({ html }), "");
        const r = await exec("node", [helper, "render", appHome(), input]);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        openOverlay({ mod: "nv-browser", kind: "dialog", width: 460, height: 160, props: { url: JSON.parse(r.stdout).url } });
      } catch (error) { this.previewError = String(error.message ?? error); }
      finally { if (input) await exec("node", [`${appHome()}/bin/nv-preview.mjs`, "discard", appHome(), input]).catch(() => {}); }
      this.previewBusy = false; cx.notify();
    });
  }

  button(id, label, active, action) {
    const t = theme();
    return div().id(id).flex_none().px(8).py(3).rounded(5).cursor_pointer().text_size(11)
      .border_1().border_color(active ? t.accent : t.border).text_color(active ? t.accent : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx)).child(label);
  }

  render() {
    const t = theme(), l = TEXT[locale()];
    return v_flex().id("nv-code").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().flex_none().h(40).px(12).gap(8).items_center().bg(t.chrome)
        .child(div().font_semibold().child(l.title)).child(div().flex_1())
        .child(this.button("code-highlight", l.highlight, this.highlight, cx => this.toggle("highlight", cx)))
        .when(["md", "html"].includes(this.grammar), el => el.child(this.button("code-preview", this.preview ? "Source" : "Preview", this.preview, cx => { this.preview = !this.preview; cx.notify(); })))
        .when(this.grammar === "html", el => el.child(this.button("code-browser-preview", this.previewBusy ? "Opening…" : "Browser", false, cx => this.browserPreview(cx))))
        .child(this.button("code-wrap", l.wrap, this.wrap, cx => this.toggle("wrap", cx)))
        .child(this.button("code-close", l.close, false, () => closeOverlay(props()?.overlay))))
      .child(h_flex().flex_none().h(36).px(12).gap(4).items_center().overflow_x_scrollbar()
        .child(div().flex_none().text_size(11).text_color(t.dim).child(l.syntax))
        .children(GRAMMARS.map(([grammar, name]) => this.button(`code-syntax-${grammar}`, name ?? l.plain,
          grammar === this.grammar, cx => this.selectGrammar(grammar, cx)))))
      .when(Boolean(this.previewError), el => el.child(div().px(12).py(6).text_size(12).text_color(t.blocked).child(this.previewError)))
      .child(this.preview && ["md", "html"].includes(this.grammar)
        ? div().id("code-document-preview").flex_1().min_h(0).overflow_y_scrollbar().px(24).py(16).text_size(14)
          .child((this.grammar === "html" ? TextView.html("code-html-preview", this.state.value()) : TextView.markdown("code-md-preview", this.state.value())).selectable(true))
        : Editor.new(this.state).flex_1().min_h(0))
      .child(h_flex().flex_none().h(28).px(12).gap(10).items_center().text_size(10).text_color(t.dim)
        .child(div().child(`${l.paste} · ${window()?.platform === "macos" ? "⌘V" : "Ctrl+V"}`))
        .child(div().flex_1()).child(div().child(l.count(this.state.value().length))).child(div().child(l.saved)))
      .child(h_flex().flex_none().h(34).px(12).gap(4).items_center()
        .child(this.button("code-language-auto", l.auto, !code(shared("nv.language")), () => this.setLanguage("auto")))
        .children(Object.entries(LANGUAGES).map(([key, name]) => this.button(`code-language-${key}`, name,
          shared("nv.language") === key, () => this.setLanguage(key)))));
  }
}
