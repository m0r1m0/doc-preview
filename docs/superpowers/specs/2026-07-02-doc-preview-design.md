# doc-preview (dp) 設計書

- 作成日: 2026-07-02
- 状態: 設計承認待ち

## 目的

Claude Code をターミナルで使っているとき、生成された markdown / HTML をブラウザで
手軽にプレビューするための CLI ツール。ローカルサーバーを立てて配信し、
ファイル変更をリアルタイムに反映する。mermaid 図に対応する。

## ゴール条件(これを満たしたら完了)

1. `dp <file.md>` で markdown がブラウザに表示され、ファイルを編集すると保存時に自動反映される
2. `dp <file.html>` で HTML がそのまま表示され、変更時に自動リロードされる
3. `dp <dir>` で配下の .md / .html の一覧が表示され、クリックで各ファイルを閲覧できる
4. ` ```mermaid ` コードブロックが図としてレンダリングされる(オフラインでも動く)
5. WSL2 上で起動すると Windows 側のブラウザが自動で開く
6. `npm link` 後、任意のディレクトリから `dp` コマンドが使える

## 技術方針(案A: Node.js + 最小依存)

- ランタイム: Node.js (>= 20)。シバン付き bin スクリプトで `npm link` 配布
- HTTP サーバー: `node:http`(フレームワーク不使用)
- ライブリロード: **Server-Sent Events (SSE)**。WebSocket ライブラリ不要
- Markdown 変換: `markdown-it`(GFM 相当。テーブル・コードブロック対応)
- ファイル監視: `chokidar`(WSL2 で `fs.watch` が不安定なため)
- mermaid: npm 依存 `mermaid` を入れ、`node_modules` の dist をサーバーから配信。
  クライアント側 JS でコードブロックを図に描画(CDN 不使用・オフライン可)
- ランタイム依存は `markdown-it` / `chokidar` / `mermaid` の3つのみ

## CLI 仕様

```
dp <path> [options]

<path>      .md / .html ファイル、またはディレクトリ
--port, -p  ポート番号(既定 3000。使用中なら空きポートまで自動インクリメント)
--no-open   ブラウザ自動起動を抑止
--help, -h  ヘルプ
--version   バージョン表示
```

- コマンド名は `dp`(package.json の bin に `dp` と `doc-preview` の両方を登録)
- 引数なし・存在しないパス・対象外拡張子のファイルはエラーメッセージを出して終了コード 1

## アーキテクチャ

```
bin/dp.js            CLI エントリ(引数パース → server 起動)
src/server.js        HTTP サーバー(ルーティング・SSE)
src/render.js        markdown → HTML 変換、プレビュー用ページの組み立て
src/watcher.js       chokidar 監視 → SSE クライアントへ変更通知
src/open-browser.js  OS 判定してブラウザ起動(WSL2 対応)
public/client.js     ブラウザ側(SSE 受信・本文差し替え・mermaid 描画)
public/style.css     markdown 表示用スタイル(GitHub 風・ダーク/ライト自動)
```

### ルーティング

| パス | 内容 |
|---|---|
| `/` | ファイル指定時: そのファイルのプレビュー。ディレクトリ指定時: ファイル一覧 |
| `/view/<relpath>` | ディレクトリ指定時の各ファイルのプレビュー |
| `/raw/<relpath>` | 変換済み本文の HTML 断片(md)/ 生 HTML(html)。クライアントの差し替え取得用 |
| `/events` | SSE エンドポイント。変更のあった relpath を通知 |
| `/assets/*` | client.js / style.css / mermaid.min.js |

- パストラバーサル対策: `/view` `/raw` は起点ディレクトリ配下に正規化して検証する

### ライブリロードの流れ

1. chokidar が対象(ファイル or ディレクトリ配下の .md/.html)を監視
2. 変更イベント → 接続中の SSE クライアントへ `{path}` を送信
3. クライアントは表示中ファイルと一致したら:
   - **md**: `/raw/<path>` を fetch して本文 DOM を差し替え(スクロール位置維持)→ mermaid 再描画
   - **html**: ページ全体をリロード
4. ディレクトリ一覧表示中はファイルの追加・削除で一覧をリロード

### HTML ファイルの扱い

- 自己完結 HTML を想定し、内容はそのまま配信する
- ライブリロード用に `</body>` 直前へ SSE クライアントスクリプトを1つ注入する(それ以外は改変しない)

### mermaid の扱い

- markdown-it のレンダリング時、` ```mermaid ` ブロックを `<pre class="mermaid">` に変換
- クライアントで `mermaid.run()` を実行して描画
- 描画失敗時はそのブロックにエラーメッセージを表示し、ページ全体は壊さない

## エラーハンドリング

- 監視対象が消えた場合: プレビュー画面に「ファイルが見つかりません」を表示(サーバーは落とさない)
- markdown 変換エラー: markdown-it は基本失敗しないが、読み込み失敗時はエラーページを表示
- ポート使用中: 自動で次の空きポートを探す(+1 ずつ、最大 10 回で諦めてエラー)

## テスト

- `node:test` + `node --test` で自動テスト
  - render: md → HTML 変換(見出し・テーブル・mermaid ブロックの class 付与)
  - server: 各ルートのレスポンス(200 / 404 / パストラバーサル拒否 / SSE ヘッダ)
  - HTML 注入: スクリプトが1回だけ注入されること
- ライブリロード・mermaid 描画・ブラウザ自動起動は実ブラウザで手動確認(ゴール条件 1-5 の実証)

## スコープ外(YAGNI)

- md の TOC 自動生成・シンタックスハイライト・数式(KaTeX)
- 外部公開(ローカル 127.0.0.1 バインドのみ)
- 画像等の相対パス解決は「起点ディレクトリ配下の静的配信」の範囲でのみ対応
- 設定ファイル・テーマカスタマイズ

## 配布

- リポジトリ: `/home/yukiw/repos/doc-preview`(GitHub: `m0r1m0/doc-preview`、private で作成)
- インストール: `npm install && npm link` で `dp` をグローバル登録
