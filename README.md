# doc-preview (dp)

markdown / HTML をブラウザでライブプレビューする CLI。
ローカルサーバーを立てて配信し、ファイル保存で即時反映する。mermaid 対応。

## インストール

```bash
git clone git@github.com:m0r1m0/doc-preview.git
cd doc-preview
npm install
npm link   # dp コマンドをグローバル登録
```

## 使い方

```bash
dp README.md          # ファイルをプレビュー
dp docs/              # ディレクトリなら .md/.html の一覧から選ぶ
dp report.html        # 自己完結 HTML もそのまま表示
```

| オプション | 説明 |
|---|---|
| `-p, --port <n>` | ポート番号(既定 3000。使用中なら空きポートまで自動 +1) |
| `--no-open` | ブラウザの自動起動を抑止 |
| `-h, --help` | ヘルプ |
| `--version` | バージョン |

## レビューモード (AI エージェント連携)

Claude などの AI エージェントが書いた md をブラウザでレビューし、
テキスト選択でコメントを付けてエージェントに返せる。

    dp review docs/design.md

- コマンドはユーザーの決定までブロックし、結果を stdout に出力して終了する
  - 承認: `The user approved.`
  - コメント: `# レビューコメント` で始まる整形済み一覧 (引用 + 見出しで位置を伝える)
  - 中断 (タブを閉じる / Ctrl+C): `Review session closed without feedback.`
- 表示は起動時のスナップショット固定 (ライブリロードなし)
- 対象は .md のみ
- Bash timeout (既定最大 10 分) を超えるレビューには `BASH_MAX_TIMEOUT_MS` を設定する

### Claude Code スキルのセットアップ

Claude Code なら、成果物 (md) を書き終えたエージェントが自動で `dp review` を呼び、
ユーザーのレビューを待つスキル `dp-review` をプラグインとして導入できる。手動でファイルをコピーする必要はない。

**前提**: スキルは `dp` コマンドを呼ぶので、先に上記「インストール」の `npm link` を済ませて `dp` を通しておく。

**導入手順** (Claude Code のプロンプトで実行):

```
/plugin marketplace add m0r1m0/doc-preview
/plugin install dp-review@doc-preview
```

- 1 行目でこのリポジトリをマーケットプレイスとして登録し、2 行目でスキルを入れる。
- ユーザースコープで入るので、一度入れれば全プロジェクトで有効になる。

**確認**: `/plugin` を開くと導入済みプラグインとして `dp-review` が表示される。
スキルはエージェントが md 成果物を書き終えた場面で自動的に呼ばれる (「レビューさせて」と指示しても発火する)。

**更新 / 削除**:

```
/plugin marketplace update doc-preview   # マーケットプレイスを最新化
/plugin uninstall dp-review@doc-preview  # 削除
```

#### このリポジトリを clone して開発する場合

移動させたスキル本体は `skills/dp-review/` にある。開発リポジトリ自身でスキルを使うときは、
GitHub 経由ではなくローカルパスでマーケットプレイスを登録する (リポジトリ root で実行):

```
/plugin marketplace add .
/plugin install dp-review@doc-preview
```

## 機能

- 保存で即時反映: markdown は本文だけ差し替え(スクロール位置維持)、HTML は自動リロード
- **目次サイドバー**: md プレビューで h1–h3 の目次を左サイドバーに表示。
  クリックでジャンプ、スクロールに追従して現在位置をハイライト、⟨ ボタンで開閉できる
  (状態は記憶される)。見出しには GitHub 風のスラッグ id が付くので `#見出し` の直リンクも使える。
- ` ```mermaid ` コードブロックを図として描画(オフライン可)
- WSL2 では Windows 側の既定ブラウザを自動で開く
- 127.0.0.1 バインドのみ(外部公開しない)

## 開発

```bash
npm test   # node --test
```

CI (GitHub Actions) が push / PR ごとに Node 20・22 で `npm test` を実行する。

## ライセンス

[MIT](LICENSE)
