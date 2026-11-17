import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, machines, props, readTextFile, settings, shared, setShared, theme } from "herdr";

const CACHE = "nv.usage.cache";
const TEXT = {
  en: { title: "AI usage", today: "Today", days7: "7 days", days30: "30 days", refresh: "Refresh", close: "Close", local: "This computer", loading: "Reading usage…", records: "Device usage logs", empty: "No records in this period", tokens: "tokens", estimates: "Estimated USD", quota: "Account limits", left: "remaining", reset: "resets", input: "Input", output: "Output", cache: "Cache", note: "Costs are API-equivalent estimates. Account quotas are shared across devices using the same account and are refreshed at most every 5 minutes.", unavailable: "Unavailable", model: "Model" },
  ko: { title: "AI 사용량", today: "오늘", days7: "7일", days30: "30일", refresh: "새로고침", close: "닫기", local: "이 컴퓨터", loading: "사용량 조회 중…", records: "이 기기의 사용 기록", empty: "선택한 기간에 기록이 없습니다", tokens: "토큰", estimates: "API 환산 추정 USD", quota: "계정 한도", left: "남음", reset: "리셋", input: "입력", output: "출력", cache: "캐시", note: "비용은 API 환산 추정치입니다. 같은 계정의 한도는 기기 간 공유되며 최대 5분마다 갱신합니다.", unavailable: "조회 불가", model: "모델" },
  ja: { title: "AI使用量", today: "今日", days7: "7日", days30: "30日", refresh: "更新", close: "閉じる", local: "この端末", loading: "使用量を取得中…", records: "この端末の利用記録", empty: "この期間の記録はありません", tokens: "トークン", estimates: "API換算推定USD", quota: "アカウント上限", left: "残り", reset: "リセット", input: "入力", output: "出力", cache: "キャッシュ", note: "費用はAPI換算の推定値です。同じアカウントの上限は端末間で共有され、最大5分ごとに更新します。", unavailable: "取得不可", model: "モデル" },
  zh: { title: "AI用量", today: "今天", days7: "7天", days30: "30天", refresh: "刷新", close: "关闭", local: "本机", loading: "正在读取用量…", records: "本机使用记录", empty: "此时段没有记录", tokens: "令牌", estimates: "API估算USD", quota: "账户限额", left: "剩余", reset: "重置", input: "输入", output: "输出", cache: "缓存", note: "费用为API估算值。同一账户的限额由各设备共享，最多每5分钟更新一次。", unavailable: "不可用", model: "模型" },
};
const language = value => { const key = String(value ?? "").toLowerCase().split(/[-_]/)[0]; return Object.hasOwn(TEXT, key) ? key : null; };
const copy = () => TEXT[language(shared("nv.language")) ?? language(settings().language) ?? language(settings().locale) ?? "en"];
const count = value => Number.isFinite(value) ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—";
const usd = value => typeof value !== "number" ? "—" : value > 0 && value < 0.0001 ? "<$0.0001" : `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "—";
const key = (machine, days, zone) => JSON.stringify([machine, days, zone]);
async function node(args, options = {}) {
  try { return await exec("node", args, options); }
  catch (e) {
    if (!/program not found|ENOENT|cannot start node:.*(?:No such file or directory|os error 2)/i.test(String(e))) throw e;
    const launch = 'nv_usage_node="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-neon-violet/usage-node/current/bin/node"; test -x "$nv_usage_node" || exit 127; exec "$nv_usage_node" "$@"';
    return exec("sh", ["-c", launch, "nv-usage", ...args], options);
  }
}

export default class Usage extends View {
  init(_props, cx) {
    this.days = [1, 7, 30].includes(Number(localStorage.getItem("days"))) ? Number(localStorage.getItem("days")) : 1;
    this.groups = []; this.revision = 0; this.timezone = "UTC";
    if (checking()) return;
    cx.timer.every(300000, cx => this.refresh(cx, true));
    this.refresh(cx);
  }

  selectDays(days, cx) {
    if (days === this.days) return;
    this.days = days; this.revision++; this.groups = [];
    localStorage.setItem("days", String(days)); this.refresh(cx, true); cx.notify();
  }

  refresh(cx, force = false) {
    if (this.busy) { this.queued = true; return; }
    this.busy = true; this.error = null;
    const revision = this.revision, days = this.days;
    cx.spawn(async cx => {
      try {
        if (!this.source) {
          this.source = await readTextFile(`${appHome()}/bin/nv-usage.mjs`);
          if (!this.source) throw new Error("Install the AI usage collector with this pack");
          try {
            const zone = await node(["-p", "Intl.DateTimeFormat().resolvedOptions().timeZone"], { timeout: 5000 });
            if (zone.code === 0 && zone.stdout.trim()) this.timezone = zone.stdout.trim();
          } catch {} // Connected computers can still be read using the displayed UTC fallback.
        }
        const zone = this.timezone, cache = shared(CACHE) ?? {};
        const names = [...new Set([null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)])];
        if (revision === this.revision) this.groups = names.map(machine => ({ machine, data: cache[key(machine, days, zone)]?.data, loading: true }));
        cx.notify();
        await Promise.all(names.map(async machine => {
          const cacheKey = key(machine, days, zone), prior = cache[cacheKey];
          let data = !force && prior && Date.now() - prior.at < 60000 ? prior.data : null, error;
          if (!data) {
            const quota = cache[key(machine, "quotas", zone)];
            const reuseQuota = quota && Date.now() - quota.at < 300000;
            const options = { days, timezone: zone, skipQuotas: Boolean(reuseQuota) };
            const script = this.source + `\ncollectUsage(${JSON.stringify(options)}).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.log(JSON.stringify({error:"Usage collection failed"}));process.exitCode=1});`;
            try {
              const result = await node(["--input-type=module", "-e", script], { on: machine, timeout: 55000 });
              if (result.code !== 0) throw new Error("Usage tools unavailable on this connection (Node.js/npm required)");
              data = JSON.parse(result.stdout);
              if (data.version !== 1 || data.error) throw new Error(data.error || "Invalid usage response");
              if (reuseQuota) data.quotas = quota.data;
              const current = shared(CACHE) ?? {};
              if (!reuseQuota && data.quotas) current[key(machine, "quotas", zone)] = { at: Date.now(), data: data.quotas };
              current[cacheKey] = { at: Date.now(), data }; setShared(CACHE, current);
            } catch (e) { data = null; error = String(e.message ?? e).slice(0, 180); }
          }
          if (revision === this.revision) this.groups = this.groups.map(g => g.machine === machine ? { machine, data, error } : g);
          cx.notify();
        }));
      } catch (e) { this.error = String(e.message ?? e); }
      finally {
        this.busy = false; cx.notify();
        if (this.queued || revision !== this.revision) { this.queued = false; this.refresh(cx, true); }
      }
    });
    cx.notify();
  }

  button(id, text, active, action) {
    const t = theme();
    return div().id(id).px(10).py(4).rounded(6).cursor_pointer().text_size(12).bg(active ? t.raised : t.chrome)
      .text_color(active ? t.accent : t.muted).on_click((_e, cx) => action(cx)).child(text);
  }

  renderGroup(group, t, l) {
    const data = group.data, history = data?.history;
    const box = v_flex().flex_none().p(12).gap(7).rounded(8).bg(t.surface)
      .child(h_flex().gap(8).child(div().font_semibold().child(group.machine ?? l.local)).child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim).child(group.loading ? l.loading : stamp(data?.generatedAt))));
    if (group.error) return box.child(div().text_color(t.blocked).child(group.error));
    if (!data) return box;
    box.child(div().text_size(11).text_color(t.muted).child(`${l.records} · ${data.days}d · ${data.timezone}`));
    if (!history?.available) box.child(div().text_color(t.blocked).child(history?.error ?? l.unavailable));
    else if (history.noRecords) box.child(div().text_color(t.dim).child(l.empty));
    else for (const provider of history.providers ?? []) {
      box.child(h_flex().pt(6).gap(10).items_center().child(div().font_semibold().child(provider.agent))
        .child(div().text_color(t.muted).child(`${count(provider.total)} ${l.tokens}`)).child(div().flex_1())
        .child(div().text_color(t.accent).child(`${l.estimates} ${usd(provider.costUsd)}`)));
      box.child(h_flex().gap(8).text_size(10).text_color(t.dim)
        .child(div().flex_1().child(l.model)).children([l.input, l.output, l.cache, "USD"].map(x => div().w(125).child(x))));
      for (const model of provider.models ?? []) box.child(h_flex().flex_none().min_h(24).gap(8).text_size(11)
        .child(div().flex_1().min_w(0).truncate().child(model.name))
        .children([count(model.input), count(model.output), count(model.cache), usd(model.costUsd)].map(x => div().w(125).child(x))));
    }
    box.child(div().pt(8).font_semibold().text_size(12).child(l.quota));
    for (const [provider, quota] of Object.entries(data.quotas ?? {})) {
      if (!quota.available) { box.child(div().text_size(11).text_color(t.dim).child(`${provider} · ${quota.error || l.unavailable}`)); continue; }
      box.child(div().text_size(10).text_color(t.dim).child(`${provider} · ${stamp(quota.observedAt)}`));
      if (quota.includedAllowed === false) box.child(div().text_color(t.blocked).child(`${provider} · Included usage is currently restricted`));
      for (const w of quota.windows ?? []) box.child(h_flex().flex_none().gap(10).text_size(12)
        .child(div().w(235).truncate().child(`${provider} · ${w.label}${w.minutes ? ` · ${w.minutes === 10080 ? "7d" : w.minutes / 60 + "h"}` : ""}`))
        .child(div().w(150).text_color(w.remaining < 10 ? t.blocked : t.done).child(`${Math.round(w.remaining * 10) / 10}% ${l.left}`))
        .child(div().text_color(t.muted).child(`${l.reset} ${stamp(w.resetsAt)}`)));
    }
    return box;
  }

  render() {
    const t = theme(), l = copy();
    return v_flex().size_full().min_h(0).p(14).gap(10).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().gap(8).items_center().child(div().font_semibold().text_size(16).child(l.title))
        .child(div().flex_1()).children([[1,l.today],[7,l.days7],[30,l.days30]].map(([days,label]) => this.button(`usage-days-${days}`,label,this.days===days,cx=>this.selectDays(days,cx))))
        .child(this.button("usage-refresh",l.refresh,false,cx=>this.refresh(cx,true)))
        .child(this.button("usage-close",l.close,false,()=>closeOverlay(props().overlay))))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().flex_none().gap(12).children(this.groups.map(g => div().text_size(11)
        .text_color(g.error ? t.blocked : g.loading ? t.dim : t.done)
        .child(`${g.machine ?? l.local} · ${g.error ?? (g.loading ? l.loading : "✓")}`))))
      .child(v_flex().id("usage-list").flex_1().min_h(0).overflow_y_scrollbar().gap(10).children(this.groups.map(g=>this.renderGroup(g,t,l))))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(l.note));
  }
}
