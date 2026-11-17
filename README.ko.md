# herdr-neon-violet

[English](README.md) · **한국어** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md)

[herdr](https://herdr.dev)(AI 코딩 에이전트용 터미널 작업 공간)를 위한 보라색 네온 테마와 플러그인 묶음입니다. **ALL agents** 보드, **Devices** 팝업(adb·에뮬레이터·iOS 시뮬레이터), **터미널 안 브라우저**, SSH 너머 복사 설정, 터미널 색 구성이 들어 있습니다.

![ALL agents board](docs/agents.png)

## 들어 있는 것

| 기능 | 단축키 | 설명 |
| --- | --- | --- |
| 보라색 네온 테마 | | herdr 화면 전체 색, 사이드바의 에이전트 줄 구성 |
| ALL agents | `prefix` `a` | 지금 돌고 있는 에이전트를 한 탭에 모두 타일로 표시 |
| Devices | `prefix` `d` | adb 기기, 안드로이드 에뮬레이터, iOS 시뮬레이터 목록 |
| 브라우저 | `prefix` `u` | 터미널 안에서 웹 페이지 읽기 (SSH 너머에서도 동작) |
| 파일과 PR | `prefix` `f` | 미리보기가 있는 파일 트리와 저장소의 PR: 읽기, 댓글, 머지 |
| 에이전트 이동 | `prefix` `,` / `prefix` `.` | 이전 / 다음 에이전트로 이동 |
| SSH 너머 복사 | 드래그 | 원격 창의 글자를 드래그하면 내 컴퓨터 클립보드로 복사 |

`prefix`의 기본값은 `ctrl+b`입니다.

## 화면

**기본 화면.** 사이드바 아래쪽에 에이전트가 급한 순서(막힘 → 작업 중 → 완료 → 대기)로 나옵니다.

![main](docs/main.png)

**Devices.** 연결된 기기와 아직 켜지 않은 에뮬레이터·시뮬레이터를 한 번에 봅니다. `enter`로 꺼져 있는 것을 켜고, `y`로 기기 ID를 복사합니다.

![devices](docs/devices.png)

**브라우저.** 오른쪽에 창을 나눠 페이지를 글자로 보여 줍니다. 링크 번호를 누르고 `enter`를 치면 이동합니다.

![browser](docs/browser.png)

> 캡처의 에이전트 대화와 기기 목록은 `demo/` 폴더의 예시 데이터로 만든 것입니다.

## 설치

herdr 0.9.5 이상이 필요합니다. 도구들은 작은 Rust 실행 파일 `nv` 하나입니다. 설치 스크립트가 Rust가 있으면 빌드하고, 없으면 미리 빌드된 파일을 내려받습니다. PR 기능에는 GitHub CLI(`gh`)가 필요합니다.

**macOS / Linux**

```bash
git clone https://github.com/torisKR/herdr-neon-violet.git
cd herdr-neon-violet
./install.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/torisKR/herdr-neon-violet.git
cd herdr-neon-violet
.\install.ps1
```

설치 스크립트가 하는 일은 세 가지입니다.

1. 기존 herdr 설정을 `config.toml.bak-날짜`로 백업하고 `config/config.toml`을 설치합니다.
2. `plugin/` 폴더를 herdr 플러그인으로 연결합니다 (`herdr plugin link`).
3. 터미널 색 구성을 넣습니다 (Ghostty 테마 또는 Windows Terminal 색 구성표).

플러그인만 쓰려면 저장소를 받지 않고 바로 설치할 수 있습니다. 단축키는 `config/config.toml`의 `[[keys.command]]` 부분을 내 설정에 복사하면 됩니다.

```bash
herdr plugin install torisKR/herdr-neon-violet/plugin
```

### 터미널 색 맞추기

herdr 창 안쪽 배경은 바깥 터미널의 배경색을 그대로 씁니다. 그래서 터미널에도 같은 색을 넣어야 캡처처럼 보입니다.

| 터미널 | 파일 | 적용 방법 |
| --- | --- | --- |
| Ghostty | `terminal/ghostty-neon-violet` | `~/.config/ghostty/themes/neon-violet`로 복사하고 설정에 `theme = neon-violet` 추가 |
| iTerm2 | `terminal/neon-violet.itermcolors` | Settings → Profiles → Colors → Color Presets → Import |
| Windows Terminal | `terminal/windows-terminal.json` | `install.ps1`이 넣어 줍니다. 터미널을 다시 켠 뒤 프로필의 색 구성표에서 「Neon Violet」 선택 |

## Herdr 데스크톱 앱

Herdr 데스크톱 앱용 묶음은 `app/` 폴더에 있습니다. 설치 스크립트는 `~/.config/herdr-app` 폴더가 있으면 그 안에 복사하고, 이미 쓰고 있는 키는 바꾸지 않은 채 단축키만 `keys.json`에 더합니다.

| 구성 | 단축키 | 설명 |
| --- | --- | --- |
| 테마 `neon-violet` | | 앱에도 같은 색을 씁니다. 설정에서 고르거나 `herdr-app do app.theme --name neon-violet` 실행 |
| 레이아웃 `all-agents` | `ctrl+shift+a` | 모든 에이전트의 실제 터미널을 한 화면에 격자로 표시(급한 것이 앞). `ctrl+shift+l`로 레이아웃을 되돌립니다 |
| Devices | `ctrl+shift+d` | 이 컴퓨터와 연결된 모든 머신의 기기·에뮬레이터·시뮬레이터. 꺼져 있는 것을 누르면 켜집니다 |
| 브라우저 | `ctrl+shift+u` | 오른쪽에 창을 나눠 글자 브라우저를 엽니다 |
| 레이아웃 `neon-violet` | `ctrl+shift+l` | 기본 화면에 창 흐림과 반투명, 할 일 목록을 더한 레이아웃 |
| Pull requests | `ctrl+shift+g` | 지금 있는 저장소의 열린 PR: 설명, 바뀐 파일, 댓글. 패널에서 댓글과 머지를 합니다 |
| To-do | | 에이전트에게 시킨 일을 보여 주는 오른쪽 위의 떠 있는 목록 |

`all-agents` 레이아웃에서는:

- 위쪽 칩을 누르거나 `ctrl+d` 완료, `ctrl+w` 작업 중, `ctrl+i` 대기, `ctrl+b` 막힘, `ctrl+a` 전체로 상태별로 골라 봅니다.
- 이 레이아웃이 떠 있는 동안 이 다섯 키는 필터가 가져가므로 터미널 안의 프로그램에는 전달되지 않습니다.
- 카드 머리줄을 누르면 그 에이전트가 기본 레이아웃에서 열립니다.

어두운 테마입니다. 앱이 항상 밝은 모양을 쓰도록 설정돼 있으면 설정에서 어둡게 바꿔야 테마가 보입니다. 앱에서는 원래 글자를 드래그하면 복사되고, 원격 머신의 터미널도 마찬가지입니다.

## SSH 너머에서 드래그로 복사하기

설정에 `copy_on_select = true`가 들어 있어서, herdr 안에서 글자를 드래그하면 바로 복사됩니다. 원격 컴퓨터에 접속해 있을 때 복사된 글자가 어디로 가는지는 접속 방법에 따라 다릅니다.

- **`herdr --remote <호스트>` 또는 저장한 머신으로 접속한 경우.** 화면을 그리는 herdr가 내 컴퓨터에서 돌기 때문에 내 클립보드로 바로 들어갑니다. 따로 할 일이 없습니다.
- **`ssh`로 들어간 뒤 그 안에서 `herdr`를 실행한 경우.** herdr가 OSC 52라는 터미널 신호로 글자를 내보내고, 내 터미널이 그것을 받아 클립보드에 넣습니다. 터미널이 이 신호를 허용해야 합니다.
  - iTerm2: Settings → General → Selection → "Applications in terminal may access clipboard" 켜기
  - Ghostty: `clipboard-write = allow`
  - macOS 기본 터미널(Terminal.app)은 OSC 52를 지원하지 않습니다. 이 경우 위의 `herdr --remote` 방식을 쓰세요.

## ALL agents

`prefix` `a`를 누르면 「ALL agents」 탭이 열립니다. 이미 열려 있으면 그 탭으로 이동합니다.

- 에이전트마다 카드 하나가 나오고, 최근 출력이 1.5초마다 갱신됩니다.
- 급한 순서로 정렬됩니다: 막힘(BLOCKED) → 작업 중(WORKING) → 완료(DONE) → 대기(IDLE).
- 상태별로 골라 볼 수 있습니다: `ctrl+d` 완료, `ctrl+w` 작업 중, `ctrl+i` 대기, `ctrl+a` 전체. 글자만 눌러도(`d`, `w`, `i`, `a`) 되고, `b`는 막힌 에이전트를 보여 줍니다.
- 숫자 `1`~`9`를 누르면 그 에이전트가 있는 창으로 이동합니다. `q`로 닫습니다.
- 이 보드는 보드가 열린 herdr 서버의 에이전트만 보여 줍니다. 다른 머신의 에이전트는 사이드바에서 확인하세요.

## 파일과 PR

`prefix` `f`를 누르면 방금 있던 창의 폴더를 기준으로 탭이 열립니다. 마우스도 됩니다: 줄을 클릭하고, 양쪽을 각각 스크롤합니다.

| 키 | 파일 | PR |
| --- | --- | --- |
| `↑` `↓` / `j` `k` | 이동 | 이동 |
| `enter` 또는 클릭 | 파일 열기, 폴더 펼치기 | PR 열기 |
| `←` | 접기, 또는 상위 폴더로 | |
| `space` / `b` | 미리보기 스크롤 | PR 내용 스크롤 |
| `c` | | 댓글 쓰기 |
| `m` | | 머지. 먼저 물어봅니다: `y`로 머지, `s`로 squash·merge·rebase 전환 |
| `o` | | GitHub에서 열기 |
| `y` | 경로 복사 | |
| `tab` | PR로 전환 | 파일로 전환 |

Herdr 데스크톱 앱에는 파일 탐색기가 이미 있어서(오른쪽 위 Files 버튼), 앱에는 PR 패널만 더했습니다.

## 할 일 목록

Herdr 앱 오른쪽 위에 떠 있는 목록입니다. Claude Code나 Codex에 지시를 입력할 때마다 항목이 생기고, 그 차례가 끝나면 체크되면서 알림이 뜹니다. 직접 추가, 체크, 삭제도 할 수 있고 연결된 모든 머신의 목록이 함께 보입니다.

- 머신마다 한 번 켭니다: `~/.config/herdr-app/bin/nv todo hooks install`. Claude Code의 `settings.json`과 Codex의 `hooks.json`에 훅 두 개(지시 입력, 차례 종료)를 더하고, 기존 훅은 그대로 두며 백업을 남깁니다. `nv todo hooks remove`로 뺍니다.
- `↔`와 `↕`로 너비와 높이를 바꾸고, `–`로 접고, 끌어서 옮길 수 있습니다.
- 셸에서: `nv todo add "내용"`, `nv todo done <id>`, `nv todo list`.

## Devices

`prefix` `d`로 엽니다. 창이 떠 있는 컴퓨터에서 다음을 읽어 옵니다.

- `adb devices -l`: 연결된 안드로이드 기기와 실행 중인 에뮬레이터 (안드로이드 버전 포함)
- `emulator -list-avds`: 아직 켜지 않은 에뮬레이터
- macOS에서는 `xcrun simctl`과 `xcrun xctrace`: iOS 시뮬레이터와 연결된 아이폰·아이패드

`adb`와 `emulator`는 `PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, 그리고 Android Studio 기본 위치(`~/Library/Android/sdk` 등)에서 찾습니다.

## 브라우저

`prefix` `u`로 열고 주소나 검색어를 입력합니다. 검색어는 DuckDuckGo로 검색합니다.

| 키 | 동작 |
| --- | --- |
| `j` / `k`, 방향키 | 스크롤 |
| `space` / `b` | 한 화면 아래 / 위 |
| 숫자 + `enter` | 그 번호의 링크로 이동 |
| `u` 또는 `/` | 새 주소·검색어 입력 |
| `h` | 뒤로 |
| `y` | 지금 주소를 내 클립보드로 복사 |
| `o` | 창이 떠 있는 컴퓨터의 기본 브라우저로 열기 |
| `q` | 닫기 |

글자만 보여 주는 브라우저라서 자바스크립트로 그려지는 페이지는 내용이 비어 보일 수 있습니다. 문서 읽기나 개발 서버 응답 확인에 맞습니다.

터미널에 찍힌 `http://localhost:포트` 링크를 `ctrl`+클릭하면 이 브라우저로 열립니다. 원격 컴퓨터의 개발 서버는 내 노트북의 localhost가 아니라 그 컴퓨터에 있기 때문입니다. 그 밖의 링크는 herdr가 원래 하던 대로 내 브라우저에서 열립니다.

## 확인한 환경

- Windows 11, herdr 0.9.5, nv 0.2(Rust)에서 테마와 세 창(ALL agents, Devices, 브라우저)을 실행해 확인했습니다.
- Windows 11의 Herdr 데스크톱 앱에서 테마, `all-agents` 레이아웃과 필터, Devices를 실행해 확인했습니다. Devices는 연결된 맥의 실제 안드로이드 기기, 에뮬레이터, iOS 시뮬레이터를 보여 줬습니다.
- 터미널 플러그인의 Devices 창은 `demo/fixtures`의 예시 출력으로 확인했고, 같은 명령이 실제 맥에서도 그 형식으로 나오는 것을 봤습니다. macOS에 이 묶음을 직접 설치해 보지는 못했습니다. 문제가 있으면 이슈로 알려 주세요.

## 만든 배경

색은 VS Code의 Cyber Purple 77 테마 화면에서 영감을 받아 herdr의 색 토큰에 맞춰 새로 골랐습니다.

## 라이선스

MIT
