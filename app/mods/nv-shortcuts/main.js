import { View, div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { checking, closeOverlay, keys, nextCommand, props, settings, shared, setShared, theme, window } from "herdr";

const LANGUAGES = { en: "English", ja: "日本語", zh: "中文", ko: "한국어" };
const code = value => {
  const key = String(value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGES, key) ? key : null;
};
const locale = () => code(shared("nv.language")) ?? code(settings().language) ?? code(settings().locale) ?? "en";
const TEXT = {
  en: { title: "Keyboard shortcuts", search: "Search keys, actions or context", close: "Close", auto: "Follow Herdr", global: "Global", layout: "Layout", mod: "Panel", custom: "Custom action", empty: "No matching shortcuts", count: n => `${n} shortcuts`, live: "Current Herdr bindings, including your customizations" },
  ja: { title: "キーボードショートカット", search: "キー・操作・コンテキストを検索", close: "閉じる", auto: "Herdrに従う", global: "全体", layout: "レイアウト", mod: "パネル", custom: "カスタム操作", empty: "該当するショートカットはありません", count: n => `${n}件`, live: "現在のHerdr設定とカスタマイズを表示" },
  zh: { title: "键盘快捷键", search: "搜索按键、操作或上下文", close: "关闭", auto: "跟随 Herdr", global: "全局", layout: "布局", mod: "面板", custom: "自定义操作", empty: "没有匹配的快捷键", count: n => `${n}个快捷键`, live: "显示当前 Herdr 绑定及自定义设置" },
  ko: { title: "단축키 모음", search: "키·동작·적용 범위 검색", close: "닫기", auto: "Herdr 설정 따르기", global: "전체", layout: "레이아웃", mod: "패널", custom: "사용자 지정 동작", empty: "일치하는 단축키가 없습니다", count: n => `${n}개 단축키`, live: "사용자 설정을 포함한 현재 Herdr 단축키" },
};
// Descriptions follow actual command names; the original action is always shown too.
const ACTIONS = {
  "mod.open:nv-code": ["Code highlighting", "コードハイライト", "代码高亮", "코드 하이라이팅"],
  "mod.open:nv-shortcuts": ["Keyboard shortcuts", "ショートカット一覧", "快捷键列表", "단축키 모음"],
  "layout.switch:all-agents": ["All agents", "全エージェント", "全部智能体", "전체 에이전트"],
  "mod.open:nv-toggle-agents": ["All agents (press again: back)", "全エージェント（もう一度で戻る）", "全部智能体（再按返回）", "전체 에이전트 (다시 누르면 돌아가기)"],
  "mod.open:nv-toggle-prs": ["Pull requests (press again: close)", "プルリクエスト（もう一度で閉じる）", "拉取请求（再按关闭）", "풀 리퀘스트 (다시 누르면 닫기)"],
  "mod.open:nv-browser": ["Browser (press again: close)", "ブラウザー（もう一度で閉じる）", "浏览器（再按关闭）", "브라우저 (다시 누르면 닫기)"],
  "mod.open:devices": ["Devices", "デバイス", "设备", "기기 목록"],
  "space.new": ["New space", "スペースを作成", "新建空间", "새 공간"],
  "space.select": ["Select space", "スペースを選択", "选择空间", "공간 선택"],
  "space.next": ["Next space", "次のスペース", "下一个空间", "다음 공간"],
  "space.prev": ["Previous space", "前のスペース", "上一个空间", "이전 공간"],
  "space.rename": ["Rename space", "スペース名を変更", "重命名空间", "공간 이름 변경"],
  "tab.new": ["New tab", "タブを作成", "新建标签页", "새 탭"],
  "tab.close": ["Close tab", "タブを閉じる", "关闭标签页", "탭 닫기"],
  "tab.select": ["Select tab", "タブを選択", "选择标签页", "탭 선택"],
  "tab.next": ["Next tab", "次のタブ", "下一个标签页", "다음 탭"],
  "tab.prev": ["Previous tab", "前のタブ", "上一个标签页", "이전 탭"],
  "tab.rename": ["Rename tab", "タブ名を変更", "重命名标签页", "탭 이름 변경"],
  "pane.split": ["Split pane", "ペインを分割", "拆分面板", "패널 분할"],
  "pane.close": ["Close pane", "ペインを閉じる", "关闭面板", "패널 닫기"],
  "pane.zoom": ["Zoom pane", "ペインを拡大", "缩放面板", "패널 확대"],
  "pane.go": ["Focus adjacent pane", "隣のペインへ移動", "切换相邻面板", "옆 패널로 이동"],
  "pane.swap": ["Swap pane", "ペインを入れ替え", "交换面板", "패널 위치 바꾸기"],
  "agent.next": ["Next agent", "次のエージェント", "下一个智能体", "다음 에이전트"],
  "agent.prev": ["Previous agent", "前のエージェント", "上一个智能体", "이전 에이전트"],
  "layout.switch": ["Switch layout", "レイアウトを切替", "切换布局", "레이아웃 전환"],
  "layout.toggle": ["Toggle panel", "パネルを切替", "显示或隐藏面板", "패널 표시 전환"],
  "app.settings": ["Settings", "設定", "设置", "설정"],
  "app.help": ["Herdr help", "Herdrヘルプ", "Herdr 帮助", "Herdr 도움말"],
  "app.palette": ["Command palette", "コマンドパレット", "命令面板", "명령 팔레트"],
  "app.zoom_in": ["Zoom in", "拡大", "放大", "화면 확대"],
  "app.zoom_out": ["Zoom out", "縮小", "缩小", "화면 축소"],
  "app.zoom_reset": ["Reset zoom", "倍率をリセット", "重置缩放", "화면 배율 초기화"],
  "app.quit": ["Quit Herdr", "Herdrを終了", "退出 Herdr", "Herdr 종료"],
  "app.hide": ["Hide Herdr", "Herdrを隠す", "隐藏 Herdr", "Herdr 숨기기"],
  "app.hide_others": ["Hide other apps", "他のアプリを隠す", "隐藏其他应用", "다른 앱 숨기기"],
  "editor.save": ["Save file", "ファイルを保存", "保存文件", "파일 저장"],
  "editor.preview": ["Toggle Markdown preview", "Markdownプレビュー切替", "切换 Markdown 预览", "마크다운 미리보기 전환"],
  "editor.wrap": ["Wrap lines", "行を折り返す", "自动换行", "줄 바꿈"],
  "all-agents.all": ["Show all agents", "全エージェントを表示", "显示全部智能体", "모든 에이전트 보기"],
  "all-agents.done": ["Show done agents", "完了したエージェント", "显示已完成智能体", "완료된 에이전트 보기"],
  "all-agents.working": ["Show working agents", "作業中のエージェント", "显示工作中的智能体", "작업 중인 에이전트 보기"],
  "all-agents.idle": ["Show idle agents", "待機中のエージェント", "显示空闲智能体", "대기 중인 에이전트 보기"],
  "all-agents.blocked": ["Show blocked agents", "確認待ちのエージェント", "显示受阻智能体", "확인이 필요한 에이전트 보기"],
};
const describe = (action, lang) => (ACTIONS[action] ?? ACTIONS[action.split(/[ :{]/)[0]])?.[Object.keys(LANGUAGES).indexOf(lang)] ?? TEXT[lang].custom;

function formatKeys(value) {
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", secondary: "⌘", super: "⌘", win: "⌘" }
    : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", secondary: "Ctrl", super: "Super", win: "Super" };
  return value.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "−"; parts.pop(); }
    return [...parts.map(part => names[part.toLowerCase()] ?? part), key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)].join(mac ? "" : "+");
  }).join(" ");
}

export default class Shortcuts extends View {
  init(_props, cx) {
    this.query = "";
    this.input = InputState.new();
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    if (checking()) return;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.input.focus();
        else if (command.startsWith("language:")) this.setLanguage(command.slice(9));
        cx.notify();
      }
    });
  }

  setLanguage(value) {
    if (value === "auto" || Object.hasOwn(LANGUAGES, value)) setShared("nv.language", value);
  }

  entries() {
    const lang = locale(), l = TEXT[lang], query = this.query.trim().toLowerCase();
    return keys().filter(entry => entry.keys?.trim()).map(entry => {
      const action = typeof entry.action === "string" ? entry.action : JSON.stringify(entry.action);
      const [kind, ...rest] = entry.section.split(":");
      const context = kind === "global" ? l.global : `${kind === "layout" ? l.layout : kind === "mod" ? l.mod : kind} · ${rest.join(":")}`;
      const label = describe(action, lang);
      return { ...entry, action, context, label };
    }).filter(entry => `${entry.keys} ${entry.action} ${entry.section} ${entry.context} ${entry.label}`.toLowerCase().includes(query));
  }

  button(id, text, active, action) {
    const t = theme();
    return div().id(id).flex_none().px(8).py(3).rounded(5).text_size(11).cursor_pointer()
      .text_color(active ? t.accent : t.muted).hover(s => s.bg(t.hover)).on_click(action).child(text);
  }

  render() {
    const t = theme(), lang = locale(), l = TEXT[lang], entries = this.entries();
    return v_flex().id("nv-shortcuts").size_full().min_h(0).gap(8).p(14).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().font_semibold().text_size(16).child(l.title)).child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(l.count(entries.length)))
        .child(this.button("shortcuts-close", l.close, false, () => closeOverlay(props()?.overlay))))
      .child(div().id("shortcuts-search").relative().flex_none().h(32).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
        .when(!this.query, el => el.child(div().absolute().left(8).text_size(12).text_color(t.dim).child(l.search)))
        .child(Input.new(this.input).w_full().h_full()))
      .child(v_flex().id("shortcuts-list").flex_1().min_h(0).overflow_y_scrollbar().gap(3)
        .children(entries.map((entry, i) => h_flex().id(`shortcut-${i}`).flex_none().min_h(48).px(10).py(6).gap(12).items_center().rounded(5)
          .bg(i % 2 ? t.surface : t.popover)
          .child(div().flex_none().w(155).font_semibold().text_size(12).text_color(t.accent).child(formatKeys(entry.keys)))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_size(12).child(entry.label))
            .child(div().truncate().text_size(10).text_color(t.dim).child(entry.action)))
          .child(div().flex_none().max_w(150).truncate().text_size(10).text_color(t.muted).child(entry.context))))
        .when(!entries.length, el => el.child(div().p(18).text_color(t.dim).child(l.empty))))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(l.live))
      .child(h_flex().flex_none().gap(3).items_center()
        .child(this.button("shortcuts-language-auto", l.auto, !code(shared("nv.language")), () => this.setLanguage("auto")))
        .children(Object.entries(LANGUAGES).map(([key, name]) => this.button(`shortcuts-language-${key}`, name,
          shared("nv.language") === key, () => this.setLanguage(key)))));
  }
}
