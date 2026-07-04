# dp レビューモード設計

日付: 2026-07-04
ステータス: 承認済み

## 目的

Claude (などの AI エージェント) が生成した markdown 成果物を、ユーザーがブラウザのプレビュー画面上でレビューし、特定の箇所にコメントを付けて Claude に返せるようにする。plannotator の「ブロッキング CLI + stdout」方式を dp に取り込む。

- 通常のプレビュー (`dp <path>`) は一切変更しない。
- レビューは独立したサブコマンド `dp review <file.md>` で行う。
- Claude が `dp review` を実行するとプロセスはユーザーの決定までブロックし、結果を stdout に出力して終了する。stdout が Claude への伝達経路。

## 全体フロー

```
Claude が Bash で `dp review docs/design.md` を実行 (ブロック開始)
  → レビュー専用サーバー起動 + ブラウザが開く
    → ユーザーがテキスト選択でコメントを付ける
      → 「承認」or「コメントを送信」or タブを閉じる
        → CLI が結果を stdout に出力して exit 0 (ブロック解除)
          → Claude が stdout を読んで対応
```

## 1. CLI (`dp review`)

```
dp review <file.md> [--port N] [--no-open]
```

- 対象は `.md` のみ。それ以外の拡張子はエラーメッセージを stderr に出して exit 1。
- 起動時にファイルを 1 回だけ読んで**スナップショット**とする。watcher / SSE は動かさない。レビュー中にファイルが変わっても表示は変わらず、コメントのアンカーずれは原理的に起きない。
- ポートは既存 `startServer` を再利用 (EADDRINUSE で +1 リトライ、127.0.0.1 バインド)。
- ユーザーの決定を受けて stdout に結果を出力し exit 0。SIGINT / SIGTERM は dismissed 扱いで終了する。

### stdout の 3 状態 (プレーンテキスト契約)

| 決定 | stdout |
|---|---|
| 承認 | `The user approved.` |
| コメント送信 | 下記フォーマットのコメント一覧 |
| タブを閉じた / Ctrl-C / SIGTERM | `Review session closed without feedback.` |

コメント一覧のフォーマット:

```markdown
# レビューコメント

File: docs/design.md

## コメント 1
Section: ## アーキテクチャ
> 選択された本文の引用

ここの説明は古い方の構成では?

## コメント 2
...

上記のコメントすべてに対応してください。
```

- 位置の伝達は**引用テキスト + 直近の見出し** (見出しがなければ `Section:` 行を省略)。md ソースの行番号マッピングは持たない — Claude は引用テキストでソースを検索できるため十分であり、実装が大幅に軽くなる。
- ドキュメント全体へのコメント (選択なし) は仕様に含めない (YAGNI。選択コメントで代替できる)。

## 2. サーバー (`src/review-server.js` 新規)

既存 `src/server.js` には手を入れず、小さな専用サーバーを新設する。`escapeHtml` などは `render.js` から再利用する。

ルーティング:

- `GET /` — レンダリング済み本文 + レビュー UI の完全ページ (`buildReviewPage`)
- `GET /assets/<name>` — `review.js` / `review.css` / 既存 `style.css` / `mermaid.min.js` の固定資産のみ
- `POST /api/decision` — `{ decision: "approve" | "comments" | "dismiss", comments: [{ quote, section, text }] }` を受理して Promise を解決する。CLI 側はこの Promise を await して stdout 出力 → 終了
- それ以外 — md 内の相対パス画像などを対象ファイルのディレクトリ起点で静的配信。**必ず `safeResolve` 相当のパストラバーサル検証を通す** (`..` 拒否を含む。既存の設計上の約束事)

決定の競合は**先勝ち**: 最初に受理した decision で確定し、以降の POST は 409 で無視する。ブラウザのタブクローズ検知は `pagehide` イベントで `navigator.sendBeacon('/api/decision', dismiss)` を送る方式。承認/送信の直後に pagehide の dismiss が届いても先勝ちルールで無害。

## 3. ブラウザ UI (`public/review.js` / `public/review.css` 新規)

- 本文 (`#content`) 内でテキストを選択すると、選択範囲の近くに「コメント」ボタンをフローティング表示する。
- ボタンをクリックするとポップオーバー (textarea) が開き、保存でコメント確定。
- ハイライトは Range に交差するテキストノードをそれぞれ `<mark class="dp-annotation">` で包む方式 (要素をまたぐ選択にも対応)。
- コメントデータはクライアント側の配列に保持: `{ quote: 選択テキスト, section: 直近の先行見出しテキスト, text: コメント本文 }`。
- 右サイドバーにコメント一覧 (引用 + 本文表示、削除可)。
- 上部固定バー: 「✓ 承認」「コメントを送信 (N 件)」。コメント 0 件のとき送信ボタンは無効。
- 承認/送信後は「送信しました。このタブは閉じてください」表示に切り替え、以降の操作を無効化。
- mermaid ブロックは通常プレビュー同様クライアント側で描画する。描画後の SVG 上のテキスト選択はコメント対象外 (初期実装の割り切り)。
- コメントの永続化はしない (スナップショットレビューなのでセッション内で完結。リロードでコメントは消える)。

## 4. Claude 統合 (`.claude/skills/dp-review/SKILL.md` 同梱)

このリポジトリにスキルを同梱する。他プロジェクトで使う場合はスキルをコピーする運用。

- **発動条件**: Claude が md の成果物 (設計書・レポート・ドキュメントなど) を書き終えて、**ユーザーの確認・フィードバックを得たいとき**に Claude が自発的に実行する。「書き終わったら `dp review` でユーザーに見せる」が成果物作成フローの締め。ユーザーから「レビューさせて」と言われた場合も同様。
- **実行**: `dp review <path>` を Bash timeout 最大値 (600000ms = 10 分) で実行し、ユーザーの決定を待つ。
- **出力解釈**:
  - `The user approved.` → 承認。完了報告して次へ。
  - コメント一覧 → 全件対応し、修正後に再度 `dp review` で再提出。承認されるまで繰り返す。
  - `Review session closed without feedback.` → 停止してユーザーの指示を待つ。

### 制約: Bash timeout

Claude Code の Bash timeout は既定で最大 10 分。レビューが 10 分を超えるとプロセスが打ち切られる (dp は SIGTERM を dismissed 扱いで処理)。長時間レビューしたい場合は `BASH_MAX_TIMEOUT_MS` で延長できる旨をスキルと README に記載する。

## 5. エラーハンドリング

- 対象ファイルが存在しない / md でない → stderr にメッセージ、exit 1。
- `POST /api/decision` の JSON が不正 → 400。決定確定後の再 POST → 409。
- サーバー起動失敗 (ポート枯渇など) → stderr にメッセージ、exit 1。
- ブラウザ起動失敗 → 既存 `open-browser.js` と同様に URL を表示して続行 (レビュー自体は手動でブラウザを開けば可能)。

## 6. テスト (`node --test`)

- **format-review.test.js**: コメント配列 → stdout テキスト整形の純関数テスト (0 件 / 複数件 / 見出しなし / 引用内の特殊文字)。
- **review-server.test.js**: 実サーバーを立てて — `GET /` がレビューページを返す、`POST /api/decision` で Promise が解決する、先勝ち (2 回目は 409)、パストラバーサル拒否、相対パス画像の配信。
- **review-cli.test.js**: `dp review` を execFile + `--no-open` で起動し、HTTP で decision を POST して stdout の 3 状態 (approve / comments / dismiss) と exit code を検証。md 以外を渡したときの exit 1。

## 7. 変更ファイル一覧

| ファイル | 内容 |
|---|---|
| `bin/dp.js` | `review` サブコマンド分岐 |
| `src/review-server.js` | 新規: レビュー用サーバー |
| `src/render.js` | `buildReviewPage` 追加 |
| `src/format-review.js` | 新規: 決定 → stdout 整形 (純関数) |
| `public/review.js` | 新規: 選択コメント UI |
| `public/review.css` | 新規: レビュー UI スタイル |
| `.claude/skills/dp-review/SKILL.md` | 新規: Claude 用スキル |
| `test/format-review.test.js` ほか | 新規テスト 3 ファイル |
| `README.md` / `CLAUDE.md` | 使い方・アーキテクチャ追記 |

## 8. スコープ外 (将来拡張)

- HTML ファイルのレビュー (オーバーレイ注入が必要)
- レビュー中のライブ更新 + コメント再アンカー
- コメントの永続化・履歴
- 行番号ベースのアンカー
- MCP サーバー統合
