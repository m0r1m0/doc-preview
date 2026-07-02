#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, startServer } from '../src/server.js';
import { startWatcher } from '../src/watcher.js';
import { openBrowser } from '../src/open-browser.js';

const USAGE = `Usage: dp <path> [options]

  <path>       プレビューする .md / .html ファイル、またはディレクトリ

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
const port = await startServer(server, { port: Number(values.port) });
startWatcher({ rootDir, onEvent: broadcast });

const url = `http://127.0.0.1:${port}/`;
console.log(`doc-preview: ${mode === 'file' ? absTarget : rootDir} → ${url}`);
console.log('Ctrl+C で終了');
if (!values['no-open']) openBrowser(url);
