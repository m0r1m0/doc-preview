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

## 機能

- 保存で即時反映: markdown は本文だけ差し替え(スクロール位置維持)、HTML は自動リロード
- ` ```mermaid ` コードブロックを図として描画(オフライン可)
- WSL2 では Windows 側の既定ブラウザを自動で開く
- 127.0.0.1 バインドのみ(外部公開しない)

## 開発

```bash
npm test   # node --test
```
