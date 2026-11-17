# AI usage in Herdr Desktop

Open **+ → AI usage** (Korean: **AI 사용량**) or run:

```sh
herdr-app do mod.open --name nv-usage
```

The panel reads this computer and every connected Herdr machine. Select today,
7 days, or 30 days. Each computer has its own agent/model breakdown of input,
output, cache tokens, and estimated USD. Periods use the desktop's timezone.
Histories are kept separate because synchronized session files can exist on
multiple computers.

Token history comes from [ccusage](https://github.com/ccusage/ccusage), pinned to
20.0.51 in a private cache. The first scan downloads the reader with npm; it does
not install it globally. Each computer needs Node.js 24+ and npm. The install
scripts ship `app/usage/nv-usage.mjs` to the desktop's `bin/` directory. The reader
uses existing local agent logs, including supported Codex, Claude, and Hermes
logs. An empty period and a failed scan are displayed separately.

USD values are **API-equivalent estimates**, not subscription invoices. Cached
tokens are counted separately from ordinary input tokens. Unpriced models keep
their token counts and show an unknown cost rather than $0. The reader uses its
[recorded costs and model pricing](https://ccusage.com/guide/cost-modes).

Account limits are read independently from token history:

- Codex: the installed CLI's `app-server` protocol, using only initialization
  and `account/rateLimits/read`.
- Claude: the usage endpoint with the existing Claude CLI OAuth login, from the
  platform credential store or CLI credential file. Credentials stay on the
  computer being queried and are never included in the response.

The panel shows remaining percentages, actual window durations, reset times,
and observation timestamps. Missing CLI/login/limit data is marked unavailable.
Limits belong to the account, so the same account on two computers must not be
added together. Quotas are cached for five minutes, including across period
changes. History is cached for one minute and can be refreshed explicitly.
The panel does not start a model conversation, change plans, refresh login
credentials, or purchase credits.

For a connected Linux or macOS computer without Node, an optional private
runtime installer is provided:

```sh
python3 scripts/install-usage-runtime.py
```

Run it **on that computer**. It downloads Node v24.22.3 from nodejs.org, verifies
the published SHA-256 checksum, and prepares the runtime under
`${XDG_DATA_HOME:-$HOME/.local/share}/herdr-neon-violet/usage-node/current`.
The panel falls back to this location when `node` is absent from PATH. It does
not replace system tools. Windows uses the existing Node.js/npm installation.

## 한국어

**+ → AI 사용량**에서 Mac과 연결된 PC·서버의 오늘/7일/30일 사용량을
확인합니다. 컴퓨터별로 에이전트와 모델의 입력·출력·캐시 토큰, API 환산
추정 USD를 표시합니다. 실제 구독 청구액과는 다릅니다.

Codex·Claude의 기존 로그인으로 계정 한도와 리셋 시각도 조회합니다.
같은 계정의 한도는 컴퓨터 간 공유되며, 로그인이나 한도 정보가 없으면
조회 불가로 표시합니다. 토큰 기록과 계정 한도는 서로 다른 자료이므로
기기별 사용량을 계정 전체 사용량으로 해석하지 마세요.
