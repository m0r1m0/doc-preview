#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, startServer } from '../src/server.js';
import { createReviewServer } from '../src/review-server.js';
import { formatReviewResult, DISMISSED_TEXT } from '../src/format-review.js';
import { startWatcher } from '../src/watcher.js';
import { openBrowser } from '../src/open-browser.js';

const USAGE = `Usage: dp <path> [options]
       dp review <file.md> [options]

  <path>       プレビューする .md / .html ファイル、またはディレクトリ
  review       レビューモード: ブラウザでコメントを付けて stdout に結果を出力
               (ユーザーの承認/送信までブロックする。AI エージェント連携用)

Options:
  -p, --port <n>   ポート番号 (既定 3000。使用中なら空きポートまで自動で +1)
  --no-open        ブラウザの自動起動を抑止
  -h, --help       このヘルプを表示
  --version        バージョンを表示`;

const DOC_EXTS = ['.md', '.html', '.htm'];

let values, positionals;
try {
  ({ values, positionals } = parseArgs({
    options: {
      port: { type: 'string', short: 'p', default: '3000' },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  }));
} catch (err) {
  console.error(`error: ${err.message}\n\n${USAGE}`);
  process.exit(1);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.version) {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
  );
  console.log(pkg.version);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`error: ポート番号が不正です: ${values.port}`);
  process.exit(1);
}

// --- レビューモード: dp review <file.md> ---
if (positionals[0] === 'review') {
  const target = positionals[1];
  if (!target) {
    console.error(`error: レビューする .md ファイルを指定してください\n\n${USAGE}`);
    process.exit(1);
  }
  const absTarget = path.resolve(target);
  let st;
  try {
    st = statSync(absTarget);
  } catch {
    console.error(`error: パスが存在しません: ${target}`);
    process.exit(1);
  }
  if (!st.isFile() || path.extname(absTarget).toLowerCase() !== '.md') {
    console.error(`error: レビューモードは .md ファイルのみ対応です: ${target}`);
    process.exit(1);
  }

  const { server, decision, close } = createReviewServer({
    filePath: absTarget,
    displayPath: target,
  });
  let actualPort;
  try {
    actualPort = await startServer(server, { port });
  } catch (err) {
    console.error(`error: サーバーを起動できません: ${err.message}`);
    process.exit(1);
  }
  const url = `http://127.0.0.1:${actualPort}/`;
  // stdout は結果契約専用なので、案内はすべて stderr に出す
  console.error(`doc-preview review: ${absTarget} → ${url}`);
  console.error('ブラウザでレビューしてください (承認 / コメントを送信 / タブを閉じる=中断)');
  if (!values['no-open']) openBrowser(url);

  const onSignal = () => {
    console.log(DISMISSED_TEXT);
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const result = await decision;
  console.log(formatReviewResult({ ...result, filePath: target }));
  close();
  process.exit(0);
}

// --- 通常プレビュー ---
const target = positionals[0];
if (!target) {
  console.error(`error: パスを指定してください\n\n${USAGE}`);
  process.exit(1);
}

const absTarget = path.resolve(target);
let st;
try {
  st = statSync(absTarget);
} catch {
  console.error(`error: パスが存在しません: ${target}`);
  process.exit(1);
}

let mode, rootDir, entry;
if (st.isDirectory()) {
  mode = 'dir';
  rootDir = absTarget;
  entry = '';
} else {
  if (!DOC_EXTS.includes(path.extname(absTarget).toLowerCase())) {
    console.error(`error: .md / .html のみ対応です: ${target}`);
    process.exit(1);
  }
  mode = 'file';
  rootDir = path.dirname(absTarget);
  entry = path.basename(absTarget);
}

const { server, broadcast } = createPreviewServer({ rootDir, entry, mode });
const actualPort = await startServer(server, { port });
startWatcher({ rootDir, onEvent: broadcast });

const url = `http://127.0.0.1:${actualPort}/`;
console.log(`doc-preview: ${mode === 'file' ? absTarget : rootDir} → ${url}`);
console.log('Ctrl+C で終了');
if (!values['no-open']) openBrowser(url);
