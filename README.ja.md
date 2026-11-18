# herdr-toris-neon

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · **日本語** · [Français](README.fr.md)

AI コーディングエージェントのためのデスクトップアプリ兼ターミナル [Herdr](https://herdr.dev) 用のワークスペースパックです。エージェントのチームがアプリを企画し、作り、テストし、リリースする様子を Herdr の中で見られます。ピクセルアートのチームボードを備えたアプリパイプライン、エージェントが操作できる本物のブラウザー、プルリクエスト、デバイス一覧、使用量、ネオンバイオレットのテーマが入っています。

![アプリパイプライン: 机に座るチーム、左にチームの会話、右に選べるデザイン案](docs/pipeline.png)

## 含まれるもの

| 機能 | 開き方 | 内容 |
| --- | --- | --- |
| **Auto app** | + メニュー → Auto app · `Ctrl/Cmd+Shift+Y` | フォルダーとアイデアを渡すと、エージェントのチームが調査、企画、デザイン、開発、実機テスト、ストア素材の準備、fastlane でのリリースまで進めます。 |
| **Inspect 付きブラウザー** | `Ctrl/Cmd+Shift+U` | Herdr の中の本物の Chrome/Edge です。エージェントは自分のタブを操作し、人は要素をクリックして変更内容を書き、エージェントに送ります。 |
| **ALL agents** | `Ctrl/Cmd+Shift+A` | 実行中のすべてのエージェントのターミナルを一画面で見ます。もう一度押すと戻ります。 |
| **プルリクエスト** | `Ctrl/Cmd+Shift+G` | ターミナルの横でリポジトリの PR を読み、コメントし、マージします。 |
| **デバイス** | `Ctrl/Cmd+Shift+D` | adb デバイス(USB、Wi-Fi)、Android エミュレーター、iOS シミュレーターを、このコンピューターと接続先で一覧します。 |
| **ファイル、エディター、コード** | Files · `Ctrl/Cmd+Shift+H` | ファイルツリーとエディター、Markdown/HTML プレビュー、コードハイライトです。 |
| **AI 使用量** | + メニュー → AI使用量 | Claude と Codex のトークン、推定コスト、上限を複数のマシンにわたって表示します。 |
| **スクリーンショットの貼り付け** | `Ctrl+V` · `Cmd+V` | クリップボードのスクリーンショットが Claude Code や Codex に画像として入ります。別のマシンのターミナルにも入ります。 |
| **アップデート** | + メニュー → アップデート | GitHub の最新版をダウンロードしてインストールし、進行状況を画面に表示します。 |
| **エージェントスキル** | Claude Code と Codex にインストール | `herdr-hc` スキルが `hc` によるオーケストレーション、ウィンドウ操作、ブラウザーの使い方をエージェントに教えます。 |
| **ネオンバイオレットテーマ** |  | アプリとターミナル herdr の配色、そして合わせたターミナル配色です。 |

## Auto app: アイデアからストアまで

- + メニューで **Auto app** を開き、プロジェクトフォルダーを選び、作りたいものを書きます。参考(Play ストアのリンク、リポジトリ、スクリーンショット)があれば一緒に入れます。
- 9 人のチームが順番に働きます: リサーチャー、プランナー、デザイナー、アーティスト、開発者、テスター、マーケター、リリースマネージャー、パブリッシャー。それぞれ新しいエージェントとして始まり、指示書を 1 つ読んで結果を 1 つ書くので、会話が積み上がりません。
- モデルごとに得意な仕事を担当します。Grok は調査、Codex は絵、Claude は企画・開発・リリースです。ない、または失敗したモデルは Claude が代わります。
- どこまで確認するかを選べます: **無人**、**本番前だけ確認**(既定)、**すべて確認**。企画案とデザイン案はカードで表示され、クリックで選びます。
- アプリは Flutter、ゲームはジャンルに応じて Godot か Unity + URP で作ります。リリースは Play の内部テストトラックを経て本番へ進みます。
- 参考は学ぶためのもので、コピーはしません。ジャンルとコアループは取り入れ、名前・絵・文章は新しく作ります。

詳細: [アプリパイプライン](docs/PIPELINE.md)。

## ブラウザー: 見て、指して、直してもらう

![ブラウザーウィンドウ: ライブで描かれるページ、アドレスバー、実行中のエージェントが並ぶ Inspect パネル](docs/browser-chrome.png)

- macOS・Linux にグラフィックランタイムがあれば herdr-web-browser を使い、それ以外と Windows ではインストール済みの Chrome か Edge を別プロファイルで操作します。
- エージェントは `nv-web` を使います: `open`、`snapshot`、`click`、`type`、`inspect`、`console --errors`、`network --failed`、修正を先に試す `css`。
- **Inspect** はクリックした要素(セレクター、スタイル、開発ビルドのソースファイル、枠付きスクリーンショット)を選んだエージェントに送ります。

詳細: [ブラウザーと文書プレビュー](docs/BROWSER.md)。

## エージェント、プルリクエスト、デバイス

![ALL agents ボード](docs/agents.png)

![デバイス](docs/devices.png)

## インストール

Herdr デスクトップアプリ(またはターミナル herdr 0.9.5 以上)、Node.js 22 以上、Git が必要です。パイプラインはインストール済みのエージェント CLI(`claude`、`codex`、`grok`)を使い、リリースには fastlane を使います。プルリクエストには GitHub CLI(`gh`)が必要です。

**macOS / Linux**

```bash
git clone https://github.com/torisKR/herdr-toris-neon.git
cd herdr-toris-neon
./install.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/torisKR/herdr-toris-neon.git
cd herdr-toris-neon
.\install.ps1
```

インストーラーは herdr の設定とキーを変更前にバックアップし、テーマ、レイアウト、モッド、ショートカットを入れます。自分で変えたショートカットは置き換えません。以後は + メニューの **アップデート** で最新に保てます。

## ターミナル herdr プラグイン

同じパックをターミナル herdr でも使えます: `prefix a` ALL agents、`prefix d` デバイス、`prefix u` テキストブラウザー、`prefix f` ファイルとプルリクエスト(`prefix` は `ctrl+b`)。リモートペインで文字をドラッグすると手元のクリップボードにコピーされます。

```bash
herdr plugin install torisKR/herdr-toris-neon/plugin
```

## 確認した環境

- Windows 11 の Herdr デスクトップアプリ: 上の機能をすべてアプリで実行しました。パイプラインは代役のエージェントで最後まで、最初の段階は macOS で実際のエージェントで動かしました。
- macOS: パイプラインの最初の段階、スクリーンショットの貼り付け(ローカルと Windows のターミナルへ)、インストーラーの各部分を実行しました。パイプラインの後半とストアへのアップロードはまだ実際には動かしていません。

## クレジット

配色は VS Code の Cyber Purple 77 テーマのスクリーンショットに着想を得て、herdr のカラートークンに合わせて選び直しました。macOS/Linux のグラフィックブラウザーは [herdr-web-browser](https://github.com/MattJColes/herdr-web-browser)(MIT)です。

## ライセンス

MIT
