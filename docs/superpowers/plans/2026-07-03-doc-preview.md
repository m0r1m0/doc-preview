# doc-preview (dp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** markdown / HTML をブラウザでライブプレビューする CLI ツール `dp` を作る(ローカルサーバー・SSE リアルタイム更新・mermaid 対応)。

**Architecture:** `node:http` の素のサーバーが md/html を配信し、chokidar のファイル監視イベントを SSE でブラウザへ通知する。md はクライアント側で本文 DOM だけ差し替え(スクロール維持)、html は全体リロード。mermaid は npm 依存の dist をローカル配信しクライアントで描画する。

**Tech Stack:** Node.js >= 20 (ESM) / markdown-it ^14 / chokidar ^4 / mermaid ^11 / node:test

## Global Constraints

- リポジトリ: `/home/yukiw/repos/doc-preview`(すべてのパスはここからの相対)
- ランタイム依存は `markdown-it` `chokidar` `mermaid` の3つのみ。devDependencies も追加しない
- Node.js >= 20、`"type": "module"`(ESM)
- サーバーは `127.0.0.1` バインドのみ(外部公開しない)
- コマンド名は `dp`(bin に `dp` と `doc-preview` の両方を登録)
- 対応拡張子は `.md` `.html` `.htm` のみ
- テストは `node --test` で実行(フレームワーク不使用)
- コミットメッセージは Conventional Commits(feat / test / docs / chore)

---

## File Structure

```
package.json           npm メタデータ・bin 登録・依存
bin/dp.js              CLI エントリ(引数パース → 各モジュールの結線)
src/render.js          md → HTML 変換、ページ組み立て、HTML へのリロードスクリプト注入
src/server.js          HTTP サーバー(ルーティング・SSE・静的配信・ポート再試行)
src/watcher.js         chokidar 監視 → 変更イベントのコールバック
src/open-browser.js    OS 判定してブラウザ起動(WSL2 対応)
public/client.js       ブラウザ側(SSE 受信・本文差し替え・mermaid 描画)
public/style.css       プレビュー用スタイル(GitHub 風・ダーク/ライト自動)
test/render.test.js    render.js のテスト
test/server.test.js    server.js のテスト
test/watcher.test.js   watcher.js のテスト
test/cli.test.js       bin/dp.js の引数バリデーションのテスト
README.md              使い方
```

---

### Task 1: プロジェクト初期化と markdown 変換 (`renderMarkdown`)

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Produces: `renderMarkdown(mdText: string): string` — md を HTML 断片に変換。` ```mermaid ` フェンスは `<pre class="mermaid">エスケープ済みコード</pre>` になる
- Produces: `escapeHtml(s: string): string` — `& < > "` をエスケープ

- [ ] **Step 1: package.json と .gitignore を作成**

`package.json`:

```json
{
  "name": "doc-preview",
  "version": "0.1.0",
  "description": "Live preview markdown/HTML in the browser with SSE reload and mermaid support",
  "private": true,
  "type": "module",
  "bin": {
    "dp": "bin/dp.js",
    "doc-preview": "bin/dp.js"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "markdown-it": "^14.1.0",
    "chokidar": "^4.0.1",
    "mermaid": "^11.4.0"
  }
}
```

`.gitignore`:

```
node_modules/
```

- [ ] **Step 2: 依存をインストール**

Run: `cd /home/yukiw/repos/doc-preview && npm install`
Expected: `added N packages` で終了コード 0。`node_modules/mermaid/dist/mermaid.min.js` が存在することを `ls` で確認。

- [ ] **Step 3: 失敗するテストを書く**

`test/render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/render.js';

test('見出しとテーブルを HTML に変換する', () => {
  const html = renderMarkdown('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<table>/);
});

test('mermaid フェンスは pre.mermaid になり中身がエスケープされる', () => {
  const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /<pre class="mermaid">graph TD; A--&gt;B;\n<\/pre>/);
});

test('通常のコードブロックは pre.mermaid にならない', () => {
  const html = renderMarkdown('```js\nconst a = 1;\n```');
  assert.doesNotMatch(html, /class="mermaid"/);
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `node --test test/render.test.js`
Expected: FAIL(`Cannot find module '../src/render.js'`)

- [ ] **Step 5: src/render.js の最小実装**

```js
import MarkdownIt from 'markdown-it';

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const md = new MarkdownIt({ html: true, linkify: true });

const defaultFence = md.renderer.rules.fence;

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    return `<pre class="mermaid">${escapeHtml(token.content)}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export function renderMarkdown(mdText) {
  return md.render(mdText);
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `node --test test/render.test.js`
Expected: PASS(3 tests)

- [ ] **Step 7: コミット**

```bash
git add package.json package-lock.json .gitignore src/render.js test/render.test.js
git commit -m "feat: プロジェクト初期化と markdown 変換 (mermaid フェンス対応)"
```

---

### Task 2: ページ組み立てと HTML へのリロードスクリプト注入

**Files:**
- Modify: `src/render.js`(関数を追記)
- Test: `test/render.test.js`(テストを追記)

**Interfaces:**
- Consumes: `escapeHtml(s)`(Task 1)
- Produces: `buildMarkdownPage({title, contentHtml, relPath}): string` — 完全な HTML ページ。`<body data-dp-mode="md" data-dp-path="<relPath>">`、`<main id="content">` に contentHtml、`/assets/style.css` `/assets/mermaid.min.js` `/assets/client.js` を参照
- Produces: `buildIndexPage({title, files}): string` — files (relpath 文字列の配列) を `/view/<relpath>` へのリンク一覧にした完全ページ。`data-dp-mode="index"`
- Produces: `injectReloadScript(html, relPath): string` — `</body>` 直前(なければ末尾)にリロード用インライン `<script>` を1回だけ挿入

- [ ] **Step 1: 失敗するテストを追記**

`test/render.test.js` の import を差し替え、テストを追記:

```js
import { renderMarkdown, buildMarkdownPage, buildIndexPage, injectReloadScript } from '../src/render.js';
```

```js
test('buildMarkdownPage は data 属性とアセット参照を含む完全ページを返す', () => {
  const page = buildMarkdownPage({ title: 'a.md', contentHtml: '<p>hi</p>', relPath: 'a.md' });
  assert.match(page, /<html lang="ja">/);
  assert.match(page, /data-dp-mode="md"/);
  assert.match(page, /data-dp-path="a\.md"/);
  assert.match(page, /\/assets\/client\.js/);
  assert.match(page, /\/assets\/mermaid\.min\.js/);
  assert.match(page, /<p>hi<\/p>/);
});

test('buildIndexPage はファイルへのリンク一覧を返す', () => {
  const page = buildIndexPage({ title: 'docs', files: ['a.md', 'sub/c.md'] });
  assert.match(page, /data-dp-mode="index"/);
  assert.match(page, /href="\/view\/a\.md"/);
  assert.match(page, /href="\/view\/sub\/c\.md"/);
});

test('injectReloadScript は </body> の直前に1回だけスクリプトを入れる', () => {
  const out = injectReloadScript('<html><body><h1>x</h1></body></html>', 'x.html');
  assert.equal(out.split('EventSource').length - 1, 1);
  assert.ok(out.indexOf('EventSource') < out.indexOf('</body>'));
});

test('injectReloadScript は </body> が無ければ末尾に追加する', () => {
  const out = injectReloadScript('<h1>x</h1>', 'x.html');
  assert.match(out, /EventSource/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/render.test.js`
Expected: FAIL(`buildMarkdownPage is not a function` 等の SyntaxError/ReferenceError)

- [ ] **Step 3: src/render.js に実装を追記**

```js
export function buildMarkdownPage({ title, contentHtml, relPath }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-dp-mode="md" data-dp-path="${escapeHtml(relPath)}">
<main id="content">
${contentHtml}
</main>
<script src="/assets/mermaid.min.js"></script>
<script src="/assets/client.js"></script>
</body>
</html>`;
}

function encodeRelPath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

export function buildIndexPage({ title, files }) {
  const items = files
    .map((f) => `<li><a href="/view/${encodeRelPath(f)}">${escapeHtml(f)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-dp-mode="index" data-dp-path="">
<main id="content">
<h1>${escapeHtml(title)}</h1>
<ul class="dp-file-list">
${items}
</ul>
</main>
<script src="/assets/client.js"></script>
</body>
</html>`;
}

export function injectReloadScript(html, relPath) {
  const script = `<script>(()=>{const p=${JSON.stringify(relPath)};const es=new EventSource("/events");es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.path===p)location.reload();};})();</script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + script;
  return html.slice(0, idx) + script + html.slice(idx);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/render.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: コミット**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: プレビューページ組み立てと HTML へのリロードスクリプト注入"
```

---

### Task 3: クライアント資産 (client.js / style.css)

**Files:**
- Create: `public/client.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: `body` の `data-dp-mode`(`md` | `index`)と `data-dp-path`(Task 2 のページが埋め込む)
- Consumes: `GET /raw/<relpath>`(md の変換済み HTML 断片を返す。Task 4 で実装)
- Consumes: `GET /events`(SSE。`data: {"path": "<relpath>", "event": "change|add|unlink"}` を配信。Task 5 で実装)
- Produces: ブラウザ側の挙動一式(自動テストなし。Task 7 の実機確認で検証)

- [ ] **Step 1: public/client.js を作成**

```js
/* global mermaid */
(() => {
  const body = document.body;
  const mode = body.dataset.dpMode; // 'md' | 'index'
  const current = body.dataset.dpPath || '';
  const encPath = current.split('/').map(encodeURIComponent).join('/');

  let mermaidReady = false;
  if (typeof mermaid !== 'undefined') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
    });
    mermaidReady = true;
  }

  let seq = 0;
  async function renderMermaidBlocks(root) {
    if (!mermaidReady) return;
    for (const block of root.querySelectorAll('pre.mermaid')) {
      const code = block.textContent;
      const id = `dp-mermaid-${seq++}`;
      try {
        const { svg } = await mermaid.render(id, code);
        const div = document.createElement('div');
        div.className = 'mermaid-rendered';
        div.innerHTML = svg;
        block.replaceWith(div);
      } catch (err) {
        // 失敗したブロックだけエラー表示にして、ページ全体は壊さない
        const pre = document.createElement('pre');
        pre.className = 'mermaid-error';
        pre.textContent = `mermaid エラー: ${err.message}\n\n${code}`;
        block.replaceWith(pre);
        document.getElementById('d' + id)?.remove();
      }
    }
  }

  function showMissing() {
    document.getElementById('content').innerHTML =
      '<p class="dp-missing">ファイルが見つかりません</p>';
  }

  async function refresh() {
    const res = await fetch(`/raw/${encPath}`);
    if (!res.ok) {
      showMissing();
      return;
    }
    const html = await res.text();
    const content = document.getElementById('content');
    content.innerHTML = html; // 本文だけ差し替えるのでスクロール位置は保たれる
    await renderMermaidBlocks(content);
  }

  const es = new EventSource('/events');
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (mode === 'index') {
      if (data.event === 'add' || data.event === 'unlink') location.reload();
      return;
    }
    if (data.path !== current) return;
    if (data.event === 'unlink') showMissing();
    else refresh();
  };

  renderMermaidBlocks(document);
})();
```

- [ ] **Step 2: public/style.css を作成**

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --border: #d1d9e0;
  --code-bg: #f6f8fa;
  --link: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --border: #3d444d;
    --code-bg: #161b22;
    --link: #4493f8;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
    "Noto Sans CJK JP", Meiryo, sans-serif;
  line-height: 1.7;
}
main#content {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}
h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 0.6em; }
h1 { font-size: 1.8rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h2 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h3 { font-size: 1.15rem; }
a { color: var(--link); }
p { margin: 0.8em 0; }
ul, ol { padding-left: 1.6em; }
blockquote {
  margin: 0.8em 0;
  padding: 0.1em 1em;
  border-left: 4px solid var(--border);
  color: var(--muted);
}
code {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
pre {
  background: var(--code-bg);
  border-radius: 8px;
  padding: 1em;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1em 0; }
th, td { border: 1px solid var(--border); padding: 0.4em 0.8em; }
th { background: var(--code-bg); }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
.dp-file-list { list-style: none; padding: 0; }
.dp-file-list li { border-bottom: 1px solid var(--border); }
.dp-file-list a { display: block; padding: 0.6em 0.4em; text-decoration: none; }
.dp-file-list a:hover { background: var(--code-bg); }
.mermaid-rendered { margin: 1em 0; text-align: center; }
.mermaid-rendered svg { max-width: 100%; height: auto; }
.mermaid-error { color: #d1242f; white-space: pre-wrap; }
.dp-missing { color: var(--muted); font-style: italic; }
```

- [ ] **Step 3: 構文チェック**

Run: `node --check public/client.js`
Expected: 出力なし(終了コード 0)

- [ ] **Step 4: コミット**

```bash
git add public/client.js public/style.css
git commit -m "feat: ブラウザ側クライアント (SSE 受信・本文差し替え・mermaid 描画) とスタイル"
```

---

### Task 4: HTTP サーバー(ルーティング・静的配信・SSE エンドポイント・ポート再試行)

**Files:**
- Create: `src/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `renderMarkdown` / `buildMarkdownPage` / `buildIndexPage` / `injectReloadScript`(Task 1-2)
- Consumes: `public/client.js` / `public/style.css`(Task 3。`/assets/*` で配信される)
- Produces: `createPreviewServer({rootDir, entry = '', mode}): {server, broadcast, close}` — `mode` は `'file' | 'dir'`、`entry` は file モード時のファイル名(rootDir からの相対)。`broadcast(payload)` は接続中の全 SSE クライアントに JSON を送る。`close()` は SSE 接続とサーバーを閉じる
- Produces: `startServer(server, {port = 3000, host = '127.0.0.1', maxTries = 10}): Promise<number>` — EADDRINUSE なら +1 して再試行、実際に listen したポート番号を返す

- [ ] **Step 1: 失敗するテストを書く**

`test/server.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createPreviewServer, startServer } from '../src/server.js';

let dir;
let srv; // { server, broadcast, close }
let port;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dp-test-'));
  await writeFile(path.join(dir, 'a.md'), '# Hello\n\n```mermaid\ngraph TD; A-->B;\n```\n');
  await writeFile(path.join(dir, 'b.html'), '<html><body><p>raw-body</p></body></html>');
  await writeFile(path.join(dir, 'note.txt'), 'plain');
  await mkdir(path.join(dir, 'sub'));
  await writeFile(path.join(dir, 'sub', 'c.md'), '# Sub');
  srv = createPreviewServer({ rootDir: dir, mode: 'dir' });
  port = await startServer(srv.server, { port: 0 });
});

after(() => srv.close());

const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);

test('dir モード: / は .md/.html の一覧を返す (txt は含まない)', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /href="\/view\/a\.md"/);
  assert.match(html, /href="\/view\/sub\/c\.md"/);
  assert.match(html, /href="\/view\/b\.html"/);
  assert.doesNotMatch(html, /note\.txt/);
});

test('/view/<md> は変換済みの完全ページを返す', async () => {
  const res = await get('/view/a.md');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /data-dp-mode="md"/);
  assert.match(html, /<pre class="mermaid">/);
});

test('/view/<html> は生 HTML + リロードスクリプト注入を返す', async () => {
  const res = await get('/view/b.html');
  const html = await res.text();
  assert.match(html, /<p>raw-body<\/p>/);
  assert.equal(html.split('EventSource').length - 1, 1);
});

test('/raw/<md> は HTML 断片 (完全ページではない) を返す', async () => {
  const res = await get('/raw/a.md');
  const html = await res.text();
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(html, /<html/);
});

test('/view/<txt> や画像などは静的配信される', async () => {
  const res = await get('/view/note.txt');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'plain');
});

test('存在しないファイルは 404', async () => {
  const res = await get('/raw/nope.md');
  assert.equal(res.status, 404);
});

test('パストラバーサルは 400 で拒否される', async () => {
  // fetch は ../ を正規化してしまうので生ソケットで送る
  const raw = await new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET /raw/..%2F..%2Fetc%2Fpasswd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    let buf = '';
    sock.on('data', (d) => (buf += d));
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
  assert.match(raw, /^HTTP\/1\.1 400/);
});

test('/assets/client.js と /assets/mermaid.min.js が配信される', async () => {
  for (const p of ['/assets/client.js', '/assets/style.css', '/assets/mermaid.min.js']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
  }
});

test('/events は text/event-stream を返し broadcast が届く', async () => {
  const res = await get('/events');
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  srv.broadcast({ path: 'a.md', event: 'change' });
  let text = '';
  for (let i = 0; i < 5 && !text.includes('a.md'); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /"path":"a\.md"/);
  await reader.cancel();
});

test('file モード: / がそのファイルのプレビューになる', async () => {
  const s2 = createPreviewServer({ rootDir: dir, entry: 'a.md', mode: 'file' });
  const p2 = await startServer(s2.server, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${p2}/`);
  const html = await res.text();
  assert.match(html, /<h1>Hello<\/h1>/);
  s2.close();
});

test('startServer は使用中ポートを +1 して再試行する', async () => {
  const s3 = createPreviewServer({ rootDir: dir, mode: 'dir' });
  const p3 = await startServer(s3.server, { port });
  assert.notEqual(p3, port);
  assert.ok(p3 > port);
  s3.close();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/server.test.js`
Expected: FAIL(`Cannot find module '../src/server.js'`)

- [ ] **Step 3: src/server.js を実装**

```js
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderMarkdown,
  buildMarkdownPage,
  buildIndexPage,
  injectReloadScript,
  escapeHtml,
} from './render.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

function resolveMermaidDist() {
  try {
    return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
  } catch {
    return fileURLToPath(new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url));
  }
}

const ASSETS = {
  'client.js': { file: path.join(publicDir, 'client.js'), type: 'text/javascript; charset=utf-8' },
  'style.css': { file: path.join(publicDir, 'style.css'), type: 'text/css; charset=utf-8' },
  'mermaid.min.js': { file: resolveMermaidDist(), type: 'text/javascript; charset=utf-8' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const DOC_EXTS = ['.md', '.html', '.htm'];

async function listDocFiles(root, dir = root) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listDocFiles(root, abs)));
    else if (DOC_EXTS.includes(path.extname(e.name).toLowerCase()))
      out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

export function createPreviewServer({ rootDir, entry = '', mode }) {
  const root = path.resolve(rootDir);
  const clients = new Set();

  function broadcast(payload) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function safeResolve(relPath) {
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  }

  function sendMissingPage(res, relPath) {
    send(
      res,
      404,
      buildMarkdownPage({
        title: relPath,
        contentHtml: `<p class="dp-missing">ファイルが見つかりません: ${escapeHtml(relPath)}</p>`,
        relPath,
      }),
      'text/html; charset=utf-8'
    );
  }

  async function serveStatic(res, abs) {
    try {
      const buf = await readFile(abs);
      const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
      send(res, 200, buf, type);
    } catch {
      send(res, 404, 'Not Found');
    }
  }

  async function servePreview(res, relPath) {
    const abs = safeResolve(relPath);
    if (!abs) return send(res, 400, 'Bad path');
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.md') {
      let text;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        return sendMissingPage(res, relPath);
      }
      return send(
        res,
        200,
        buildMarkdownPage({ title: path.basename(abs), contentHtml: renderMarkdown(text), relPath }),
        'text/html; charset=utf-8'
      );
    }
    if (ext === '.html' || ext === '.htm') {
      let text;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        return sendMissingPage(res, relPath);
      }
      return send(res, 200, injectReloadScript(text, relPath), 'text/html; charset=utf-8');
    }
    return serveStatic(res, abs);
  }

  async function serveRaw(res, relPath) {
    const abs = safeResolve(relPath);
    if (!abs) return send(res, 400, 'Bad path');
    const ext = path.extname(abs).toLowerCase();
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      return send(res, 404, 'Not Found');
    }
    if (ext === '.md') return send(res, 200, renderMarkdown(text), 'text/html; charset=utf-8');
    return send(res, 200, injectReloadScript(text, relPath), 'text/html; charset=utf-8');
  }

  function serveEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (pathname.includes('..')) return send(res, 400, 'Bad path');

    if (pathname === '/events') return serveEvents(req, res);

    if (pathname.startsWith('/assets/')) {
      const asset = ASSETS[pathname.slice('/assets/'.length)];
      if (!asset) return send(res, 404, 'Not Found');
      try {
        return send(res, 200, await readFile(asset.file), asset.type);
      } catch {
        return send(res, 404, 'Not Found');
      }
    }

    if (pathname === '/') {
      if (mode === 'file') return servePreview(res, entry);
      const files = await listDocFiles(root);
      return send(
        res,
        200,
        buildIndexPage({ title: path.basename(root), files }),
        'text/html; charset=utf-8'
      );
    }

    if (pathname.startsWith('/view/')) return servePreview(res, pathname.slice('/view/'.length));
    if (pathname.startsWith('/raw/')) return serveRaw(res, pathname.slice('/raw/'.length));

    // それ以外は起点ディレクトリ配下の静的配信 (md 内の相対パス画像など)
    const abs = safeResolve(pathname.slice(1));
    if (!abs) return send(res, 400, 'Bad path');
    return serveStatic(res, abs);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, `Internal Server Error: ${err.message}`);
    });
  });

  function close() {
    for (const res of clients) res.end();
    clients.clear();
    server.closeAllConnections?.();
    server.close();
  }

  return { server, broadcast, close };
}

export function startServer(server, { port = 3000, host = '127.0.0.1', maxTries = 10 } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryListen = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && ++tries < maxTries) tryListen(p + 1);
        else reject(err);
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    };
    tryListen(port);
  });
}
```

注意点:
- `pathname.includes('..')` の早期拒否と `safeResolve` の二重チェックでパストラバーサルを防ぐ(URL 正規化をすり抜けたエンコード済み `..` は decodeURIComponent 後にここで捕まる)
- SSE クライアントは `req.on('close')` で確実に Set から外す(接続リーク防止)
- `startServer` は `port: 0`(テスト用の空きポート自動割当)でも動くよう `server.address().port` を返す

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/server.test.js && node --test`
Expected: server.test.js の 11 tests PASS、全体でも PASS

- [ ] **Step 5: コミット**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: HTTP サーバー (ルーティング・SSE・静的配信・ポート再試行)"
```

---

### Task 5: ファイル監視 (watcher.js)

**Files:**
- Create: `src/watcher.js`
- Test: `test/watcher.test.js`

**Interfaces:**
- Produces: `startWatcher({rootDir, onEvent}): FSWatcher` — rootDir 配下の `.md` `.html` `.htm` の `change` / `add` / `unlink` で `onEvent({event, path})` を呼ぶ。`path` は rootDir からの相対 (`/` 区切り)。戻り値は chokidar の watcher(`.close()` 可能)

- [ ] **Step 1: 失敗するテストを書く**

`test/watcher.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startWatcher } from '../src/watcher.js';

test('md の追加と変更がイベントになり、txt は無視される', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dp-watch-'));
  const events = [];
  const watcher = startWatcher({ rootDir: dir, onEvent: (e) => events.push(e) });
  await new Promise((resolve) => watcher.on('ready', resolve));

  await writeFile(path.join(dir, 'x.md'), '# a');
  await writeFile(path.join(dir, 'skip.txt'), 'ignored');

  // ポーリング (最大 5 秒) で add イベント到着を待つ
  for (let i = 0; i < 50 && !events.some((e) => e.event === 'add'); i++) await sleep(100);
  assert.ok(
    events.some((e) => e.event === 'add' && e.path === 'x.md'),
    `add イベントが来ること: ${JSON.stringify(events)}`
  );

  await writeFile(path.join(dir, 'x.md'), '# b');
  for (let i = 0; i < 50 && !events.some((e) => e.event === 'change'); i++) await sleep(100);
  assert.ok(
    events.some((e) => e.event === 'change' && e.path === 'x.md'),
    `change イベントが来ること: ${JSON.stringify(events)}`
  );

  assert.ok(!events.some((e) => e.path === 'skip.txt'), 'txt は無視されること');
  await watcher.close();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/watcher.test.js`
Expected: FAIL(`Cannot find module '../src/watcher.js'`)

- [ ] **Step 3: src/watcher.js を実装**

```js
import chokidar from 'chokidar';
import path from 'node:path';

const DOC_EXTS = new Set(['.md', '.html', '.htm']);

export function startWatcher({ rootDir, onEvent }) {
  const root = path.resolve(rootDir);
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => {
      const base = path.basename(p);
      return (base.startsWith('.') && p !== root) || base === 'node_modules';
    },
  });
  for (const event of ['change', 'add', 'unlink']) {
    watcher.on(event, (absPath) => {
      if (!DOC_EXTS.has(path.extname(absPath).toLowerCase())) return;
      const rel = path.relative(root, absPath).split(path.sep).join('/');
      onEvent({ event, path: rel });
    });
  }
  return watcher;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/watcher.test.js && node --test`
Expected: PASS(全テスト)

- [ ] **Step 5: コミット**

```bash
git add src/watcher.js test/watcher.test.js
git commit -m "feat: chokidar によるファイル監視"
```

---

### Task 6: ブラウザ起動と CLI エントリ (bin/dp.js)

**Files:**
- Create: `src/open-browser.js`
- Create: `bin/dp.js`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `createPreviewServer` / `startServer`(Task 4)、`startWatcher`(Task 5)
- Produces: `openBrowser(url: string): void` — macOS は `open`、WSL2 は `wslview`(失敗時 `cmd.exe /c start`)、他 Linux は `xdg-open`。起動失敗でもプロセスは落とさない
- Produces: `dp` コマンド本体

- [ ] **Step 1: 失敗するテストを書く**

`test/cli.test.js`(CLI の異常系はプロセス起動で検証する):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/dp.js', import.meta.url));

async function runCli(args) {
  try {
    const { stdout, stderr } = await run('node', [bin, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('引数なしはエラー終了 (code 1) で usage を出す', async () => {
  const r = await runCli([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Usage/);
});

test('存在しないパスはエラー終了', async () => {
  const r = await runCli(['/no/such/path.md']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /存在しません/);
});

test('対象外拡張子はエラー終了', async () => {
  const r = await runCli([bin]); // .js ファイルを渡す
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.md \/ \.html/);
});

test('--help は usage を出して正常終了', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage/);
});

test('--version はバージョンを出して正常終了', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\d+\.\d+\.\d+/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/cli.test.js`
Expected: FAIL(bin/dp.js が存在しない)

- [ ] **Step 3: src/open-browser.js を実装**

```js
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function trySpawn(cmd, args, onError) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', onError ?? (() => {}));
  child.unref();
}

export function openBrowser(url) {
  if (process.platform === 'darwin') return trySpawn('open', [url]);
  if (isWsl()) {
    // wslview 優先。無ければ cmd.exe 経由で Windows 側の既定ブラウザを開く
    return trySpawn('wslview', [url], () => {
      trySpawn('cmd.exe', ['/c', 'start', '', url]);
    });
  }
  return trySpawn('xdg-open', [url]);
}
```

- [ ] **Step 4: bin/dp.js を実装**

```js
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
```

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/cli.test.js && node --test`
Expected: PASS(全テスト)

- [ ] **Step 6: コミット**

```bash
git add src/open-browser.js bin/dp.js test/cli.test.js
git commit -m "feat: CLI エントリとブラウザ自動起動 (WSL2 対応)"
```

---

### Task 7: npm link・README・実機検証・GitHub リポジトリ作成

**Files:**
- Create: `README.md`
- Create: 検証用サンプル(scratchpad 内。リポジトリには入れない)

**Interfaces:**
- Consumes: すべて(完成品の統合検証)

- [ ] **Step 1: npm link でグローバル登録**

Run: `cd /home/yukiw/repos/doc-preview && npm link && which dp`
Expected: `dp` のパスが表示される(例: `~/.nvm/versions/node/v24.4.0/bin/dp`)

- [ ] **Step 2: curl で通し確認(自動でできる範囲の実機検証)**

scratchpad に検証用ファイルを作って確認する:

```bash
SCRATCH=/tmp/claude-1000/-home-yukiw-workspace/9615dc15-e5cc-43b6-80e9-abec0f1ef612/scratchpad/dp-verify
mkdir -p "$SCRATCH"
printf '# 検証\n\n```mermaid\ngraph TD; A-->B;\n```\n' > "$SCRATCH/sample.md"
dp "$SCRATCH/sample.md" --no-open -p 3900 &
sleep 1
curl -s http://127.0.0.1:3900/ | grep -c 'pre class="mermaid"'   # → 1
curl -s http://127.0.0.1:3900/assets/mermaid.min.js | head -c 100 # → JS が返る
# 変更が SSE に流れるか: /events を購読しながらファイルを書き換える
(curl -sN http://127.0.0.1:3900/events & CURL_PID=$!; sleep 1; \
 printf '# 更新\n' >> "$SCRATCH/sample.md"; sleep 2; kill $CURL_PID) | grep 'sample.md'
# → data: {"event":"change","path":"sample.md"} が出力される
kill %1
```

Expected: 各コマンドがコメントどおりの出力。だめなら superpowers:systematic-debugging で切り分けてから直す。

- [ ] **Step 3: ユーザーと実ブラウザで検証(ゴール条件 1-5)**

ユーザーに `dp <サンプル md>` を実行してもらうか、こちらで起動してブラウザ確認を依頼する:

1. md がブラウザに表示され、編集・保存で自動反映される(スクロール位置維持)
2. html の変更で自動リロードされる
3. ディレクトリ指定で一覧 → クリックで閲覧できる
4. mermaid が図として描画される
5. WSL2 で Windows 側ブラウザが自動で開く

Expected: ユーザーの目視確認 OK。問題があれば修正してから次へ。

- [ ] **Step 4: README.md を書く**

````markdown
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
````

- [ ] **Step 5: GitHub に private リポジトリを作って push**

```bash
cd /home/yukiw/repos/doc-preview
git add README.md
git commit -m "docs: README を追加"
gh repo create m0r1m0/doc-preview --private --source=. --push
```

Expected: `https://github.com/m0r1m0/doc-preview` が作成され、main が push される。

- [ ] **Step 6: 最終確認とコミット漏れチェック**

Run: `git status && node --test`
Expected: working tree clean、全テスト PASS
