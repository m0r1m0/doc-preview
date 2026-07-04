# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

doc-preview は markdown / HTML をブラウザでライブプレビューする CLI (`dp`)。ローカルサーバーを立てて配信し、ファイル保存で即時反映する。依存は最小限 (markdown-it / chokidar / mermaid) で、外部 CDN に頼らずオフラインで動くことを重視している。配布はローカルのみ (`npm link`) を想定。

## 開発ワークフロー (PR とマージ)

変更を加えるときは以下のフローに従う。

1. **main へ直接コミットしない。** `main` から作業ブランチを切って作業し、PR を作成する。
2. **PR を出したら Monitor でその PR のマージ状態を監視する** (persistent。MERGED / CLOSED を検知したら通知し、終了状態になったら監視を止める)。
3. **マージされたら後片付けする**:
   - ローカル `main` を最新化: `git checkout main && git pull --ff-only origin main`
   - 作業ブランチを削除: `git branch -d <branch>` (ローカル) と `git push origin --delete <branch>` (リモート)

## コマンド

```bash
npm test                          # 全テスト (node 組み込みテストランナー、test/*.test.js)
node --test test/render.test.js   # 単一ファイルのテスト
node --test --test-name-pattern "mermaid"  # 名前パターンで絞り込み

npm link                          # dp / doc-preview をグローバル登録 (開発時)
node bin/dp.js <path> [--port N] [--no-open]  # link せず直接起動
node bin/dp.js review <file.md> [--no-open]  # レビューモード (ユーザーの決定までブロック)
```

Node.js >= 20 必須 (`node:test`、`parseArgs`、ESM を使用)。ビルド/トランスパイル工程はなく、lint 設定もない。

## アーキテクチャ

エントリは `bin/dp.js`。引数を解釈し、対象が **ファイルなら `mode: 'file'`**、**ディレクトリなら `mode: 'dir'`** を決めて、以下 3 つを起動する。

- **`src/server.js`** — `createPreviewServer({ rootDir, entry, mode })` が HTTP サーバーと `broadcast` を返す。ルーティングの要点:
  - `/` — file モードはそのファイルのプレビュー、dir モードは `.md/.html` の一覧ページ
  - `/view/<relPath>` — 完全な HTML ページとしてプレビューを返す (md は変換、html は生 + リロード注入)
  - `/raw/<relPath>` — **本文の HTML 断片のみ** (完全ページではない)。ライブ更新でクライアントが差し替えるのに使う
  - `/events` — Server-Sent Events。接続中クライアントを `clients` Set で保持し `broadcast` で配信
  - `/assets/<name>` — `ASSETS` に登録した固定資産 (client.js / style.css / mermaid.min.js) のみ配信
  - それ以外 — 起点ディレクトリ配下の静的ファイル (md 内の相対パス画像など)
- **`src/watcher.js`** — chokidar でルートを監視し、`.md/.html/.htm` の change/add/unlink だけを `onEvent({ event, path })` に流す。これが `broadcast` に繋がって SSE で配信される。
- **`src/render.js`** — markdown → HTML 変換とページ組み立て。`renderMarkdown` / `buildMarkdownPage` / `buildIndexPage` / `injectReloadScript`。
- **`src/open-browser.js`** — OS 別にブラウザを開く。WSL2 では `wslview` → 失敗時 `cmd.exe /c start` で Windows 側の既定ブラウザを開くフォールバックがある。
- **`public/client.js`** — ブラウザ側。`/events` を購読し、対象パスの変更で `/raw/...` を fetch して `#content` の innerHTML だけ差し替える。**ページ全体をリロードしないのでスクロール位置が保たれる** (md モード)。mermaid ブロックは `pre.mermaid` を走査してクライアント側で描画する。
- **`src/review-server.js`** — `createReviewServer({ filePath })` がレビュー専用サーバーを返す。
  起動時に md を 1 回だけ読むスナップショット方式 (watcher/SSE なし)。
  `POST /api/decision` (approve / comments / dismiss、先勝ちで 2 回目以降は 409) で
  `decision` Promise が解決し、CLI が `src/format-review.js` で整形して stdout に出力する。
  stdout は結果契約専用で、URL などの案内は stderr に出す。
- **`public/review.js`** — レビュー UI。テキスト選択で `<mark>` ハイライト
  (Range に交差するテキストノードを個別に包む方式) + コメント、
  タブクローズは pagehide + sendBeacon で dismiss を通知する。
- **`src/assets.js`** — publicDir / MIME / mermaid 解決の共有定義 (server.js と review-server.js が使う)。

### ライブリロードの仕組み (md と html で異なる)

- **md**: サーバーが `buildMarkdownPage` で `data-dp-mode="md"` / `data-dp-path` を持つ完全ページを返す。client.js が SSE を受けて `/raw/` の本文断片だけを差し替える (全リロードしない)。
- **html**: 生 HTML をそのまま返し、`injectReloadScript` で `</body>` 直前に SSE 購読スクリプトを 1 回だけ注入する。変更検知時は `location.reload()` で全リロード。ユーザーの HTML に手を加えないため本文差し替えはしない。

### mermaid 描画

`render.js` の fence レンダラをカスタムし、` ```mermaid ` フェンスだけ `<pre class="mermaid">` にエスケープ出力する。実際の図描画は client.js が `mermaid.min.js` (ローカル配信) を使ってブラウザ側で行う。1 ブロックが失敗しても `.mermaid-error` に置換してページ全体は壊さない。

## 設計上の制約・約束事

- **127.0.0.1 バインドのみ** (`startServer` の既定 host)。外部公開しない前提。
- **パストラバーサル対策**: `safeResolve` で解決先が root 配下か検証し、外れたら 400。URL に `..` を含む場合も拒否。新しいルートを足すときは必ずこれを通す。
- **ポート自動リトライ**: `startServer` は EADDRINUSE のとき最大 `maxTries` 回まで +1 して再試行する。
- **長時間セッション対策**: server / watcher とも `error` リスナーを付けてクラッシュを防ぐ (過去の修正)。
- **HTML/属性は必ずエスケープ**: `render.js` の `escapeHtml` を使う。`injectReloadScript` はパスに `</script>` が入ってもタグを壊さないよう `<` エスケープする (テストで担保)。
- ドキュメント対象の拡張子は `.md` / `.html` / `.htm` に限定 (`DOC_EXTS`)。一覧・監視ともこの集合で判定する。
- **`dp review` の stdout は結果契約専用**: `The user approved.` /
  `Review session closed without feedback.` / `# レビューコメント` 形式のみを出力する。
  文言を変えるときは `.claude/skills/dp-review/SKILL.md` と README も合わせて変える。
  案内ログは stderr に出すこと。

## テスト方針

`node --test` のみ。`test/` は `render` (純関数)、`server` (実サーバーを立てて fetch)、`cli` (`bin/dp.js` を execFile)、`watcher` (実ファイル書き込み + ポーリング待機) に分かれる。ネットワーク/FS を実際に叩くテストがあるので、挙動を変えたら該当テストの前提 (一時ディレクトリ構成やポート取得) も確認すること。
