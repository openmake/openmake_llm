<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>オープンウェイトモデルと BYOK モデルのための、オープンソース・ローカルファースト・セルフホスト型 AI ワークスペース。</strong><br/>
  vLLM/LiteLLM 推論 · マルチモーダルオーケストレーション · 自律型エージェント · MCP ツール · ディープリサーチ · Docker サンドボックス。
</p>

<p align="center">
  <a href="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml"><img src="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/github/package-json/v/openmake/openmake_llm?label=version&color=green" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D24%20%3C25-brightgreen.svg" alt="Node >=24 <25" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js 16" />
</p>

<p align="center">
  <a href="https://openmake.cc/ja/">ホームページ</a> ·
  <a href="https://chat.openmake.cc">ライブデモ</a> ·
  <a href="https://bench.openmake.cc">Bench</a> ·
  <a href="https://openmake.cc/ja/docs/">セルフホスティングガイド</a><br/>
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <strong>日本語</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

> 本書は英語版 [README.md](README.md) の日本語訳です。内容が異なる場合は英語版とコードを正とします。

## 概要

**OpenMake LLM** は、自分のハードウェアで動かすセルフホスト型 AI アシスタントです。ローカルモデルを **vLLM** で提供し、その前段に **LiteLLM ゲートウェイ**(OpenAI 互換)を置きます。自分のキーで登録した外部プロバイダー — **OpenRouter、NVIDIA NIM、Ollama Cloud、Open AI Service Hub(hasa)、B.AI** — も*同じ*ゲートウェイを通り、**ChatGPT サブスクリプションログイン**にも対応します。既定ではデータは手元のマシンから出ません。

すべてのチャットターンは軽量な**メッセージパイプライン**(プロバイダーゲート、セキュリティ・言語ポリシー、プロンプトとツールの組み立て)を経て、ローカルと外部のモデルが共有する単一の実行経路に入ります。*これを描いて、読み上げて、この動画を文字起こしして、短い動画を作って* のようにテキスト以上が必要なときは、**Planner** が小さな計画を立て、該当する **capability** のタスクが割り当てたモデルで並列に実行され、選んだチャットモデルがその結果を使って最終回答を書きます。動作は不透明なプリセットではなく、互いに独立した軸 — **モデル · 応答スタイル · モード切り替え · カスタムエージェント** — だけで制御します。

チャット以外にも、Docker サンドボックス(またはローカルブリッジ経由で自分のマシン)で動く自律エージェントタスク、ディープリサーチ、ワンクリックのカタログを備えた MCP ツールシステム、Claude Code 形式のプラグインやスキルをインストールする拡張システムを提供し、すべて JWT 認証とロールベースのアクセス制御の内側にあります。

> **単一ホスト設計:** アプリケーション(API + Web)は **PM2** で動かし、状態を持つ依存(PostgreSQL / Redis)とサンドボックス化されたエージェント・MCP・アーティファクトのプロセスは分離のため **Docker** で動かします。

**ひと目でわかる特徴**

| | |
|---|---|
| 🧠 **ローカルモデル + BYOK ゲートウェイ** | vLLM + LiteLLM で提供する `qwen3.8-27b`、262K コンテキストの安全網。外部プロバイダーも自分のキーで同じゲートウェイを通ります |
| 🎨 **マルチモーダルオーケストレーター** | Planner がリクエストを画像生成・編集、音声→テキスト、テキスト→音声、動画、ビジョン・OCR のタスクに分けて並列実行し、チャットモデルが回答をまとめます |
| 🎛️ **モデルロールと capability** | ロール(エージェント・判定・リサーチ・サブエージェント・レビュー・要約・プランナー)ごと、capability ごとにモデルを指定。ユーザー設定 + 管理者の全体既定値 |
| 🤖 **自律型エージェント** | 永続的な Docker サンドボックス(シェル · Python · ブラウザー · ファイル)または **OpenMake Companion** / **OpenMake Code** CLI でつないだローカルフォルダーで複数ターンを実行、人による承認付き |
| 🔬 **ディープリサーチとレポート** | 並列 Web 検索 → ソース取得 → 引用付きの統合。レポート依頼は **PDF/DOCX** に出力できる HTML アーティファクトとして描画 |
| 🧩 **組み込みツール 23 種 + MCP** | Web 検索・スクレイピング・ビジョン・計画・コード/セキュリティレビュー・スキル読み込みなど。外部 MCP サーバーはそれぞれ Docker で分離、リモートサーバーは OAuth ログインに対応 |
| 📦 **拡張とスキル** | Git やマーケットプレイスからプラグイン・スキル・エージェント・MCP サーバーをインストール — インストール時に Claude Code の慣習を変換 — し、**承認**画面ひとつで確認 |
| ⚖️ **比較モード** | 2 つのモデルに同じ質問をして回答を並べて比べられます |
| 🖥️ **ネイティブクライアント** | OpenMake Companion(SwiftUI メニューバーアプリ、macOS)、OpenMake Code CLI、開発中の SwiftUI iOS クライアント — チャット自体は Web アプリに置きます |
| 🌐 **4 言語 UI** | 한국어 · English · 日本語 · 简体中文 (`next-intl`、ブラウザー自動検出)。回答は書いた言語に合わせます |
| 🔒 **セキュリティ重視** | JWT(HttpOnly)、Google OAuth 2.0、RBAC、ルート単位のレート制限、SSRF ガード、AES-256-GCM によるキー保存、Audit ↔ Alert |

---

## デモ

> 実際に動いているアプリから録画しており、タブは自動で切り替わります。最近の会話タイトルとアカウント名は隠しています。

<table>
  <tr>
    <td align="center">
      <img src="assets/demo-tour.gif" alt="デモツアー: チャット、マルチモーダル、エージェントタスク、設定、言語" width="860" />
    </td>
  </tr>
  <tr>
    <td>
      <b>Chat</b> — 質問すると回答がストリーミングで表示され、モデル・応答スタイル・推論の強さを入力欄で直接切り替えられます<br/>
      <b>Multimodal</b> — 「〜の画像を生成して」が画像生成タスクになり、その capability に割り当てたモデルで実行されて会話内に表示されます<br/>
      <b>Agent tasks</b> — 承認ポリシーを選んだ Agent モードが目標をサンドボックスで実行し、進捗を表示して結果を返します<br/>
      <b>Settings</b> — モデルロール、capability ごとのモデル割り当て、MCP カタログ、スキルライブラリ<br/>
      <b>Languages</b> — インターフェースはブラウザーの言語か設定で選んだ言語に従います
    </td>
  </tr>
</table>

---

## アーキテクチャ

OpenMake は**何を実行するかを決めること**と**モデルを呼び出すこと**を分けています。特殊モードは先に振り分け、それ以外はすべて 1 本の経路を通ります。

```
                             WebSocket / REST
                                     │
                       ┌─────────────▼─────────────┐
   Query ─────────────►│     message-pipeline      │  provider gate · security & language policy
                       └─────────────┬─────────────┘  prompt & tool assembly · custom agent
                                     │
                       ┌─────────────▼─────────────┐
                       │          Planner          │  one small JSON plan per turn
                       └──────┬──────────────┬─────┘
                        simple│              │multi
                              │   ┌──────────▼──────────┐
                              │   │  capability tasks   │  image · speech · video · vision
                              │   │  (run in parallel)  │  on the models you assigned
                              │   └──────────┬──────────┘
                       ┌──────▼──────────────▼─────┐
                       │ streamFromExternalProvider│  one path for local & external models
                       │   (always-on tool loop)   │  chat model writes the final answer
                       └─────────────┬─────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │       LLMClient.chat      │  context-fit safety net
                       └─────────────┬─────────────┘  truncate → cap → 413 + audit
                                     │
                  LiteLLM gateway → vLLM (local) · BYOK external providers
```

- **単一の実行経路** — ローカルと外部のモデルが `streamFromExternalProvider` とその MCP ツールループを共有します。ディスカッションとディープリサーチはディスパッチ前に振り分ける別モードです。
- **Planner → capability → 統合** — `simple` の計画では追加のモデル呼び出しはありません。`multi` の計画は実行前に割り当て・キー状態・ゲートウェイ対応・クォータを確認し、依存関係の段階ごとに並列実行して、成功したメディアだけを回答に添付します。終わっていない動画ジョブは保持され、次のメッセージで再送信せずに引き継ぎます。
- **モデルの決定** — モデルを呼ぶすべてのサブシステムは、ロール・capability のレジストリでモデルを決めます: ユーザー設定 → 管理者の全体既定値 → 組み込み既定値の順で、失敗したらローカルモデルに戻ります。
- **コンテキスト安全網** — 入口でプロンプトのトークン数(画像を含む)を見積もり、有効な **262K** ウィンドウを超える場合は入力を削り、`max_tokens` を下げ、最後の手段として監査記録とアラート付きで **HTTP 413** を返します。
- **ユーザーカスタマイズ** — **モデル** · **応答スタイル**(簡潔 / 標準 / 詳細) · **モード**(ディスカッション / Thinking / 回答検証 / ディープリサーチ / エージェント) · **カスタム指示とエージェント**、さらにオプトインの会話横断メモリ。
- **途切れても続くストリーミング** — タブがバックグラウンドに回ったりアプリのソケットが切れたりしても生成は続き、再接続すると同じ回答に戻ります。

---

## 機能

**▸ モデルとルーティング**
- セルフホストの vLLM + LiteLLM(既定 `qwen3.8-27b`)と、出力トークンを守りながら段階的に縮めるコンテキスト安全網。
- OpenRouter、NVIDIA NIM、Ollama Cloud、Open AI Service Hub(hasa)、B.AI で**自分のキーを使用(BYOK)** — すべて LiteLLM ゲートウェイ経由で、キーは AES-256-GCM で暗号化保存 — に加えて ChatGPT サブスクリプションログイン。ゲストはローカルモデルのみ使えます。
- **モデルロール** — `agent`、`judge`、`research`、`spawn`、`review`、`summary`、`planner` ごとに別のモデルを割り当て。管理者は組織全体の既定値を設定し、日次・月次のトークン予算付きのサーバー共有キーを登録できます。
- **capability ごとのモデル** — テキスト、コード、ビジョン・OCR、画像生成・編集、音声→テキスト、テキスト→音声、動画のモデルを設定でグループ単位に選び、項目ごとに個別指定もできます。
- **明確な失敗理由** — レート制限、クレジット不足、アクセス制限のあるモデル、非対応のツール定義を、ひとまとめのアップストリームエラーではなくそのまま伝え、プロバイダーごとの同時実行上限は `429` で後退します。
- **比較モード** — 同じプロンプトを 2 つのモデルで並べて実行。

**▸ マルチモーダル**
- **Planner 主導のオーケストレーション** — 画像生成・編集(直前の画像を参照)、音声・動画添付の音声→テキスト、テキスト→音声、動画生成、ビジョンによる説明・OCR を、並列実行できる capability タスクとして処理します。
- チャットモデルが画像を見られない場合は、ビジョンモデルが先に画像を説明し、チャットモデルはその記録をもとに回答します。
- 生成したメディアは `/generated` から配信され、保持期間を過ぎると自動で整理されます。使用量と計画の所要時間はコスト確認のために記録されます。

**▸ エージェントとリサーチ**
- **自律エージェントタスク** — **永続的な Docker サンドボックス**(シェル、Python、ブラウザー、ファイル、計画、コード探索)で目標を複数ターンにわたって追い、承認ポリシーは **Manual / Auto / Skip**。ファイルや画像を添付し、**Excel** や **PDF** などの成果物を受け取れます。達成できなかった場合は偽りの「完了」ではなく目標判定の結果をそのまま示します。タスクは**テンプレート**として保存したり、**スケジュール**実行したり、実行結果を**共有**したりできます。
- **ローカル実行** — **OpenMake Companion**(macOS メニューバーアプリ)または **OpenMake Code** CLI で手元のフォルダーをつなぐと、ツール呼び出しがそのフォルダー内で、パス制限・コマンド確認ゲート・git worktree 分離とともに実行されます。
- **並列サブエージェント** — 互いに独立したサブタスクを複数のサブエージェントに分けて任せ、結果をまとめます。
- **ディープリサーチ** — テーマ分解、並列 Web 検索(SearXNG、Naver、Daum など)、チャンク要約、引用付きレポート。
- **レポートパイプライン** — レポート依頼は構造化データを生成し、サーバーが固定テンプレートで HTML アーティファクトとして描画し、**PDF** と **DOCX** に出力できます。
- **カスタムエージェント** — 入力欄から選べるプロジェクト型のペルソナ。エージェントごとにモデルを固定でき、18 の業界エージェント(専門家 100 人)が標準で入っています。

**▸ ツールと拡張性**
- **組み込みツール 23 種** — Web 検索、ファクトチェック、ページ抽出、スクレイプ・マップ・クロール、画像解析・OCR、エージェントタスク参照、計画、コード・セキュリティレビュー、スキルの作成と読み込み、スキル・エージェント・MCP サーバー・拡張の Git インポート、MCP メタツール、管理者専用の運用メトリクスツール。プロンプトを小さく保つため、必要なターンにだけ公開します。
- **外部 MCP サーバー** — サンドボックスを有効にすると(生成される設定の既定値)、stdio サーバーは Docker で `--cap-drop ALL`、非 root、メモリ・ネットワーク制限、任意の読み取り専用ルートファイルシステムとともに動きます。**MCP カタログ**(Tavily、Context7、Notion、NotebookLM、Kakao Map、OpenDART、韓国の公共データ API など)からインストールでき、リモートサーバーは **OAuth** でログインします。
- **拡張** — Git、zip、マーケットプレイスからプラグイン・スキル・カスタムエージェント・MCP サーバーをインストールします。Claude Code の慣習(ツール名、`$ARGUMENTS`、`commands/`、`agents/`、同梱スクリプト)はインストール時に変換され、確認が必要なものはすべて**承認**画面に集まります。
- **スキル** — ツールバインディング付きの再利用可能なマニフェスト。`/skill-name` で呼び出すか、関連する質問でモデルが選びます。
- **アーティファクト** — サンドボックス化されたライブプレビュー、任意の Docker コード実行、公開用の別オリジンビューアー。
- **NotebookLM グラウンディング** — 入力欄から自分のノートブックをひとつ会話のコンテキストとして固定します。
- **メモリ・指示・通知** — オプトインの会話横断メモリ、常に適用されるカスタム指示、エージェントタスクが承認待ちになったり終わったりしたときの Web プッシュ通知。

**▸ 連携**
- API キーとスコープを使う **OpenAI 互換 API**(`/api/v1/chat/completions`)。
- ユーザーごとのセッションとファイル添付に対応し、API へメッセージを中継する **Discord ゲートウェイボット**(`apps/discord-bot`)。
- **OpenMake Bench** — [bench.openmake.cc](https://bench.openmake.cc) は Web SSO でサインインし、そこで選んだモデルを自分のモデルロールに適用できます。

**▸ セキュリティ**
- HttpOnly Cookie の JWT、Google OAuth 2.0、RBAC、ユーザー単位・ルート単位のレート制限、SSRF ガード、Helmet ヘッダー、エージェントツールの認証情報ファイル保護、統合された Audit ↔ Alert パイプライン。

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| **バックエンド** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod 4, Winston |
| **フロントエンド** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4, `next-intl`; Instrument デザインシステム |
| **データベース** | `pg` による PostgreSQL — パラメーター化された生 SQL(ORM なし) |
| **リアルタイム** | 切断後の再接続(detach/resume)に対応した WebSocket(`ws`)ストリーミング |
| **LLM バックエンド** | vLLM + LiteLLM ゲートウェイ(OpenAI 互換); 外部プロバイダーは `openai` SDK |
| **エージェント / ツール** | Model Context Protocol (`@modelcontextprotocol/client` v2), Docker で分離したサンドボックス |
| **ネイティブクライアント** | SwiftUI (macOS Companion, iOS), `packages/local-bridge-core` を共有する Node CLI (`apps/cli`) |
| **連携** | Discord ゲートウェイボット (`discord.js`); Web SSO でつながる OpenMake Bench |
| **認証 / セキュリティ** | `jsonwebtoken`, Google OAuth 2.0, Helmet, AES-256-GCM |
| **インフラ** | PM2 (API · Web · Discord ボット) + Docker (PostgreSQL/Redis, MCP / エージェント / アーティファクトのサンドボックス) |
| **テスト / CI** | Jest/ts-jest, Playwright, ESLint, GitHub Actions (CI Gate) |

---

## はじめに

対応プラットフォーム: **Linux** と **macOS**(Intel と Apple Silicon)。

### インストール(1 コマンド)

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

クローンは不要です。インストーラーはリポジトリの外で実行されたことを検出すると、ソースを
`~/.openmake/chat` に取得し(`OMK_HOME=...` で場所を変更、`OMK_REF=...` でブランチやタグを選択)、そこで
自分自身を再実行します。同じホストで 2 つ目のコピーを動かすには `--instance NAME`
(`... | bash -s -- --instance NAME`)を付けます。`~/.openmake/chat-NAME` に専用のポート(52417/3010)、
データベース、Redis、PM2 名(`openmake-llm-NAME`)でインストールされます。`--public-url https://chat.example.com`
は公開アドレスを `.env` に書き込み、HTTPS なら secure Cookie に切り替えます。パイプ実行でも `/dev/tty` で
対話的に質問し、端末のない環境(CI)では自動で承認します。従来の方法もそのまま使えます:

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

**Windows** では **WSL2**(Ubuntu)内で同じワンライナーを実行してください。ネイティブの Windows シェルを検出すると、
代わりに WSL2 のセットアップ手順を表示します。

これで完了です。インストーラーはツールチェーン(Node 24、Docker、PM2 — 足りなければ可能な限り `sudo` なしで導入)を
確認し、ランダムなシークレットで `.env` を生成し、依存関係をインストールし、PostgreSQL + Redis を起動し、
マイグレーションを適用し、両方のアプリをビルドして PM2 で起動したあと `/health` を待ちます。最後に Web の URL と
生成された管理者パスワードを表示します。

質問はひとつだけです — どの OpenAI 互換 LLM エンドポイントを使うか(Ollama / OpenRouter / カスタム / あとで決める)。
すべての質問を省略するには:

```bash
# フラグはワンライナーにもそのまま渡せます:
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 仮の LLM 設定、.env は後で埋める
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

`./install.sh` は何度実行しても安全です — 上書きせずに修復します。便利なフラグ:
`--skip-docker`(Postgres/Redis を自分で運用)、`--skip-build`、`--no-start`、`--force-env`、そして下記のポート指定。
`./install.sh --help` を参照してください。

既定のポートで Postgres や Redis がすでに動いている場合は、5432/6379 を取り合わずにコンテナのポートを移してください。
ポートは `.env` に記録され、`openmake_llm.sh` が読み戻します:

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

macOS では Docker Desktop、OrbStack、**Colima**(`brew install colima docker docker-compose` — GUI なしの
ヘッドレス)に対応します。Homebrew の compose プラグインが docker CLI に登録されていない場合は、インストーラーが
`~/.docker/config.json` に `cliPluginsExtraDirs` を追加します。

管理者アカウントがまだない場合、Web アプリは一度だけの**セットアップページ**を開き、管理者の作成と、必要なら
LLM ゲートウェイの設定ができます。

### インストール済みインスタンスの更新

```bash
./openmake_llm.sh update            # git pull (ff-only) → ビルド → マイグレーション → 再起動
./openmake_llm.sh update --yes      # マイグレーションの確認を省略 (非対話)
```

`update` は、コミットしていない変更や分岐したローカルコミットがあるツリーには手を付けません — 編集内容を上書きしません。
新しく取得したものがなければ再デプロイを省略します(強制するには `--force`)。git なしで tarball からインストールした
場合は、代わりに `install.sh` を再実行してください(その場で修復します)。

`main` ではなく特定のリリースに固定するには、ワンライナーで `OMK_REF` を指定します:

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh \
  | OMK_REF=v1.62.3 bash -s -- --yes
```

### 前提条件(インストーラーが処理)

- **git** — まっさらな macOS では最初の `git clone` で Xcode Command Line Tools のインストールダイアログが出ます。
  一度承認するか、ソースを zip でダウンロードしてください。`install.sh` 自体は git がなくても動きます(ビルドメタデータは `unknown`)
- **Node.js** `>=24 <25` — `mise`/`fnm`/`nvm`、Homebrew、どれもなければローカルの `~/.openmake/node` tarball で用意
- **Docker** — PostgreSQL/Redis と MCP・エージェントのサンドボックスに必要です。Linux では公式の `get.docker.com`
  スクリプトの実行を提案し、macOS では Docker Desktop、OrbStack、Colima のいずれかが必要です。注意: Docker Desktop の
  **初回起動**は GUI での承認(特権ヘルパー)を求めることがあり、インストーラーの約 60 秒の待機を超える場合があります —
  そのときは Docker の起動完了を待ってから `./install.sh` を再実行してください(繰り返しても安全)
- OpenAI 互換の LLM エンドポイント: ローカルの **vLLM + LiteLLM** スタック、**Ollama**、または外部プロバイダーのキー

### 手動セットアップ

自分で組み立てたい場合、`install.sh` にはこの手順が読みやすい形で書かれています:

```bash
npm install
node scripts/setup/gen-env.mjs        # シークレットを生成した最小限の .env
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
npm run build && pm2 start ecosystem.config.js   # マイグレーションは起動時に自動適用
```

> `--env-file .env` は省略できません。Compose は既定の `.env` を compose ファイルのディレクトリ(`infra/`)を基準に
> 探すため、指定しないと `POSTGRES_PASSWORD` が空になり起動に失敗します。

`gen-env.mjs` は起動に必要なキーだけを書き込みます(サーバーも初回起動時に不足している `JWT_SECRET` /
`API_KEY_PEPPER` / `TOKEN_ENCRYPTION_KEY` を生成します)。`.env.example` が完全なリファレンスです —
必要に応じて任意のブロック(OAuth、Web 検索、MCP サンドボックス、Discord ボット)をコピーしてください:

| 変数 | 用途 |
|---|---|
| `PORT` | API ポート(既定 `52416`) |
| `DATABASE_URL` | PostgreSQL の接続文字列(パスワードは `POSTGRES_PASSWORD` と一致させる) |
| `JWT_SECRET` | JWT 署名シークレット(32 文字以上) |
| `API_KEY_PEPPER` | API キーのハッシュ用 pepper |
| `TOKEN_ENCRYPTION_KEY` | 外部プロバイダー認証情報用の AES-256-GCM キー(ちょうど 64 桁の hex) |
| `ADMIN_PASSWORD` | 任意: ブートストラップ管理者のパスワード — 空にするとセットアップページで管理者を作成します |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM ゲートウェイのエンドポイント、マスターキー、既定モデル |
| `LLM_GATEWAY_PROVIDERS` | ゲートウェイ経由にする外部プロバイダーの id(カンマ区切り) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth(任意) |

多くの運用設定は **管理 → システム設定** で実行中に変更できます(データベースの値が `.env` より優先)。

### 実行

日常の運用は、PostgreSQL → Redis → アプリの 3 層を順に扱う `openmake_llm.sh` で行います(Linux・macOS 共通):

```bash
./openmake_llm.sh start     # 全体を起動してログを表示
./openmake_llm.sh status    # 各層のポート + docker + PM2 の状態
./openmake_llm.sh logs      # リアルタイムの PM2 ログ
./openmake_llm.sh health    # GET /health
./openmake_llm.sh deploy    # ビルド + マイグレーション + 再起動 (コード変更を反映)
./openmake_llm.sh stop      # 逆順に停止
```

または個別に動かします:

```bash
# 開発
npm run dev                 # API + フロントエンドを同時に実行
npm run dev:api             # バックエンドのみ (ts-node)
npm run dev:frontend-next   # フロントエンドのみ (next dev)

# 本番
npm run build               # 共有パッケージ + バックエンド + フロントエンド
npm start                   # node apps/api/dist/server.js
```

再起動後も動かし続けるには PM2 を init システムに登録します — `pm2 startup`(実行するコマンドを表示します:
macOS は `launchd`、Linux は `systemd`)のあとに `pm2 save`。

### テストと lint

```bash
npm test                    # 共有パッケージをビルドしてから Jest 単体テスト (apps/api)
npm run test:e2e            # Playwright (chromium + webkit)
npm run lint                # ESLint
```

### データベースマイグレーション

`db/migrations/` のファイルは**起動時に自動で適用**されます — `db/init/` のベーススキーマのあと、保留中のマイグレーションが PostgreSQL の advisory lock(複数インスタンスの同時起動を直列化)のもとで実行され、失敗すると即座に止まります。無効にするには `DB_AUTO_MIGRATE=false` にして CLI で手動実行します:

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # 保留中を表示
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # 適用
```

ロールバックスクリプトは `db/migrations/rollbacks/` にあります(正方向のマイグレーション走査からは除外)。

---

## プロジェクト構成

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript の API サーバー (strict, CommonJS)
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + ビジネスロジック
│   │       ├── services/orchestrator/           # Planner、capability 実行器、事前チェック
│   │       ├── chat/                            # パイプライン補助、分類器、プロンプト
│   │       ├── agents/                          # 業界エージェント、ディスカッションエンジン、スキル、git 取り込み
│   │       ├── llm/ providers/ cluster/         # LLM クライアント、プロバイダー抽象化、ノードルーティング
│   │       ├── mcp/                             # MCP ツールルーター、外部クライアント、Docker サンドボックス
│   │       ├── sockets/                         # WebSocket のチャット・ローカルブリッジハンドラー
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth、SSRF ガード、レート制限
│   │       └── data/                            # PostgreSQL (生 SQL)、マイグレーション、リポジトリ
│   ├── web/          # Next.js + React のフロントエンド (運用 UI)
│   ├── cli/          # OpenMake Code — ローカルブリッジ CLI (ソースからビルド、apps/cli/README.md 参照)
│   ├── desktop-native/ # OpenMake Companion — SwiftUI メニューバーアプリ (macOS)
│   ├── ios/          # SwiftUI iOS クライアント (開発中)
│   ├── discord-bot/  # 任意: Discord ゲートウェイボット (/api/v1/chat/completions へ中継)
│   └── legacy-web/   # /generated メディア用の静的アセットホスト
├── db/               # 初期スキーマ + マイグレーション (+ rollbacks/) — 実行時に読み込み
├── packages/         # shared-types, api-contracts, config, api-client, local-bridge-core
├── infra/            # Dockerfile と compose (mcp-runtime, task-runtime, artifact-viewer, egress-proxy)
├── scripts/          # setup/ (gen-env.mjs)、LLM バックエンドのホスト設定 (vLLM/LiteLLM)、Caddy、診断
├── tests/            # Playwright E2E
├── assets/           # README のデモ GIF
├── install.sh        # ワンショットインストーラー (Linux/macOS): ツールチェーン → .env → DB → ビルド → PM2
├── openmake_llm.sh   # サービス管理: start/stop/restart/deploy/update/status/logs/health
└── ecosystem.config.js  # PM2 のプロセス定義 (API、Next フロントエンド、任意の Discord ボット)
```

**稼働中のサーバーが実際に必要とするもの:** ビルド済みの `apps/api/dist` + `apps/web/.next`、`db/`(起動経路が `db/init/` と保留中の `db/migrations/` を適用)、Docker で分離したサンドボックス用の `infra/`。`scripts/` と `tests/` は実行時のコードからは読み込まれ*ません*が、`scripts/vllm/` と `scripts/caddy/` は推論バックエンドとリバースプロキシのデプロイ用成果物なので、リポジトリと一緒に置いてください。

---

## コントリビューション

コントリビューションを歓迎します。次の点をお願いします:

- [Conventional Commits](https://www.conventionalcommits.org/) を使う — `feat`、`fix`、`refactor`、`docs`、`test`、`chore`。
- 機能・修正ブランチで作業し、`main` に向けて PR を作成する。
- コード規約に従う: TypeScript strict モード、入力検証は Zod、ロギングは Winston、**パラメーター化された生 SQL のみ**(ORM なし)、設定の外部化(モデル名・マジックナンバー・インラインプロンプトのハードコード禁止)。

**PR を作成する前に:**

- [ ] `npm run lint` が通る
- [ ] `npm test` が通る
- [ ] DB スキーマの変更にはマイグレーションファイルを含める(連番の衝突なし)
- [ ] 新しい環境変数は `.env.example` に記載する
- [ ] UI の変更にはスクリーンショットか短い GIF を添付し、セキュリティの変更は影響範囲を説明する

CI はすべての push と pull request で単一の **CI Gate**(Test → Build → Size → Lint)を実行します。

---

## お問い合わせ

| | |
|---|---|
| 一般的な質問とセルフホスティングのサポート | support@openmake.cc |
| メンテナー | riskpw@openmake.cc · rockyhan@openmake.cc |

---

## ライセンス

**MIT ライセンス**で公開しています — 詳細は [LICENSE](LICENSE) を参照してください。
