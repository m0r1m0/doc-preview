# dp レビューモード実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dp review <file.md>` — Claude が実行するとブラウザでレビュー UI が開き、ユーザーがテキスト選択コメント / 承認するまでブロックし、結果を stdout に出力して終了するサブコマンドを追加する。

**Architecture:** 既存のプレビューサーバーには手を入れず、専用の `src/review-server.js` (スナップショット配信 + `POST /api/decision` で Promise 解決) を新設する。ブラウザ UI は `public/review.js` の vanilla JS (テキストノード分割 `<mark>` ハイライト方式)。stdout 整形は純関数 `src/format-review.js`。spec: `docs/superpowers/specs/2026-07-04-review-mode-design.md`

**Tech Stack:** Node.js >= 20 (ESM / node:test / parseArgs)、vanilla JS (ブラウザ側)、依存追加なし

## Global Constraints

- 新しい npm 依存を追加しない
- サーバーは 127.0.0.1 バインドのみ (`startServer` の既定を使う)
- HTML/属性出力は必ず `render.js` の `escapeHtml` を通す
- 静的配信は必ず `safeResolve` 相当 (root 配下検証 + URL の `..` 拒否) を通す
- レビューモードの情報ログ (URL 等) は **stderr** に出す。stdout は結果契約専用
- stdout 契約: 承認 = `The user approved.` / 中断 = `Review session closed without feedback.` / コメント = `# レビューコメント` フォーマット
- UI 文言は日本語
- テストは `node --test` (test/*.test.js)
- 作業ブランチは `feat/review-mode` (作成済み)。main に直接コミットしない

---

### Task 1: stdout 整形の純関数 (`src/format-review.js`)

**Files:**
- Create: `src/format-review.js`
- Test: `test/format-review.test.js`

**Interfaces:**
- Consumes: なし (純関数)
- Produces:
  - `formatReviewResult({ decision, filePath, comments }) => string`
    - `decision: 'approve' | 'comments' | 'dismiss'`
    - `comments: Array<{ quote: string, section: string, text: string }>`
  - `export const APPROVED_TEXT = 'The user approved.'`
  - `export const DISMISSED_TEXT = 'Review session closed without feedback.'`

- [ ] **Step 1: 失敗するテストを書く**

`test/format-review.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReviewResult,
  APPROVED_TEXT,
  DISMISSED_TEXT,
} from '../src/format-review.js';

test('approve は固定文言を返す', () => {
  assert.equal(formatReviewResult({ decision: 'approve' }), APPROVED_TEXT);
});

test('dismiss は固定文言を返す', () => {
  assert.equal(formatReviewResult({ decision: 'dismiss' }), DISMISSED_TEXT);
});

test('comments はヘッダー・File 行・各コメント・フッターを含む', () => {
  const out = formatReviewResult({
    decision: 'comments',
    filePath: 'docs/design.md',
    comments: [
      { quote: '古い構成の説明', section: '## アーキテクチャ', text: 'ここは新構成に直して' },
      { quote: '二つ目', section: '', text: '誤字' },
    ],
  });
  assert.match(out, /^# レビューコメント\n/);
  assert.match(out, /File: docs\/design\.md/);
  assert.match(out, /## コメント 1\nSection: ## アーキテクチャ\n> 古い構成の説明\n\nここは新構成に直して/);
  // section が空なら Section 行を省略
  assert.match(out, /## コメント 2\n> 二つ目\n\n誤字/);
  assert.match(out, /上記のコメントすべてに対応してください。$/);
});

test('複数行の quote は各行が > で引用される', () => {
  const out = formatReviewResult({
    decision: 'comments',
    filePath: 'a.md',
    comments: [{ quote: '1行目\n2行目', section: '', text: 'x' }],
  });
  assert.match(out, /> 1行目\n> 2行目/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/format-review.test.js`
Expected: FAIL (`Cannot find module .../src/format-review.js`)

- [ ] **Step 3: 実装**

`src/format-review.js`:

```js
// dp review の stdout 契約。Claude (エージェント) がこの出力を解釈するので
// 文言・構造を変えるときは .claude/skills/dp-review/SKILL.md も合わせて変える。
export const APPROVED_TEXT = 'The user approved.';
export const DISMISSED_TEXT = 'Review session closed without feedback.';

export function formatReviewResult({ decision, filePath, comments = [] }) {
  if (decision === 'approve') return APPROVED_TEXT;
  if (decision === 'dismiss') return DISMISSED_TEXT;
  const parts = ['# レビューコメント', '', `File: ${filePath}`, ''];
  comments.forEach((c, i) => {
    parts.push(`## コメント ${i + 1}`);
    if (c.section) parts.push(`Section: ${c.section}`);
    parts.push(...c.quote.split('\n').map((line) => `> ${line}`));
    parts.push('', c.text, '');
  });
  parts.push('上記のコメントすべてに対応してください。');
  return parts.join('\n');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/format-review.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/format-review.js test/format-review.test.js
git commit -m "feat: レビュー結果 → stdout テキストの整形関数を追加"
```

---

### Task 2: レビューページの組み立て (`buildReviewPage`)

**Files:**
- Modify: `src/render.js` (末尾に関数追加)
- Test: `test/render.test.js` (末尾にテスト追加)

**Interfaces:**
- Consumes: `escapeHtml` (render.js 内部)
- Produces: `buildReviewPage({ title, contentHtml, filePath }) => string` (完全 HTML ページ)
  - `body[data-dp-mode="review"]`、`#content`、`#dp-comment-list`、`#dp-btn-approve`、`#dp-btn-submit`、`#dp-review-status` を含む
  - `/assets/review.css` と `/assets/review.js` を読み込む

- [ ] **Step 1: 失敗するテストを書く**

`test/render.test.js` の末尾に追加:

```js
test('buildReviewPage はレビュー UI の骨格を含む完全ページを返す', async () => {
  const { buildReviewPage } = await import('../src/render.js');
  const html = buildReviewPage({
    title: 'design.md',
    contentHtml: '<h1>Doc</h1>',
    filePath: 'docs/design.md',
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /data-dp-mode="review"/);
  assert.match(html, /data-dp-file="docs\/design\.md"/);
  assert.match(html, /id="content"/);
  assert.match(html, /id="dp-comment-list"/);
  assert.match(html, /id="dp-btn-approve"/);
  assert.match(html, /id="dp-btn-submit"/);
  assert.match(html, /id="dp-review-status"/);
  assert.match(html, /\/assets\/review\.css/);
  assert.match(html, /\/assets\/review\.js/);
  assert.match(html, /\/assets\/mermaid\.min\.js/);
});

test('buildReviewPage は title / filePath をエスケープする', async () => {
  const { buildReviewPage } = await import('../src/render.js');
  const html = buildReviewPage({
    title: '<x>.md',
    contentHtml: '',
    filePath: 'a"b.md',
  });
  assert.doesNotMatch(html, /<title>レビュー: <x>/);
  assert.match(html, /data-dp-file="a&quot;b\.md"/);
});
```

(既存 render.test.js のインポート形式に合わせること。既にトップレベルで `import` している場合は動的 import ではなくそちらに追記してよい)

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/render.test.js`
Expected: FAIL (`buildReviewPage is not a function`)

- [ ] **Step 3: 実装**

`src/render.js` の末尾に追加:

```js
export function buildReviewPage({ title, contentHtml, filePath }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>レビュー: ${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/assets/review.css">
</head>
<body data-dp-mode="review" data-dp-file="${escapeHtml(filePath)}">
<header class="dp-review-bar">
<span class="dp-review-file">${escapeHtml(filePath)}</span>
<span id="dp-review-status" class="dp-review-status"></span>
<button type="button" id="dp-btn-submit" disabled>コメントを送信 (0)</button>
<button type="button" id="dp-btn-approve">✓ 承認</button>
</header>
<div class="dp-review-layout">
<main id="content">
${contentHtml}
</main>
<aside id="dp-comment-list"></aside>
</div>
<script src="/assets/mermaid.min.js"></script>
<script src="/assets/review.js"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/render.test.js`
Expected: PASS (既存テスト含め全件)

- [ ] **Step 5: コミット**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: buildReviewPage (レビュー UI の完全ページ組み立て) を追加"
```

---

### Task 3: ブラウザ側レビュー UI (`public/review.js` / `public/review.css`)

**Files:**
- Create: `public/review.js`
- Create: `public/review.css`

**Interfaces:**
- Consumes: Task 2 のページ骨格 (`#content` / `#dp-comment-list` / `#dp-btn-approve` / `#dp-btn-submit` / `#dp-review-status`)、`POST /api/decision` (Task 4 で実装)
- Produces: `POST /api/decision` に送る JSON: `{ decision: 'approve' }` / `{ decision: 'comments', comments: [{ quote, section, text }] }` / `{ decision: 'dismiss' }` (sendBeacon)

ブラウザ専用コードなので自動テストはなし (構文チェックのみ)。挙動は Task 6 の手動確認で検証する。

- [ ] **Step 1: `public/review.js` を作成**

```js
/* global mermaid */
(() => {
  const content = document.getElementById('content');
  const listEl = document.getElementById('dp-comment-list');
  const btnApprove = document.getElementById('dp-btn-approve');
  const btnSubmit = document.getElementById('dp-btn-submit');
  const statusEl = document.getElementById('dp-review-status');

  const comments = []; // { id, quote, section, text, marks: [Element] }
  let nextId = 1;
  let finished = false;

  // --- mermaid (client.js と同じ方式でクライアント側描画) ---
  if (typeof mermaid !== 'undefined') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
    });
    let seq = 0;
    (async () => {
      for (const block of content.querySelectorAll('pre.mermaid')) {
        const code = block.textContent;
        const id = `dp-mermaid-${seq++}`;
        try {
          const { svg } = await mermaid.render(id, code);
          const div = document.createElement('div');
          div.className = 'mermaid-rendered';
          div.innerHTML = svg;
          block.replaceWith(div);
        } catch (err) {
          const pre = document.createElement('pre');
          pre.className = 'mermaid-error';
          pre.textContent = `mermaid エラー: ${err.message}\n\n${code}`;
          block.replaceWith(pre);
          document.getElementById('d' + id)?.remove();
        }
      }
    })();
  }

  // --- 選択 → フローティング「コメント」ボタン ---
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'dp-comment-fab';
  fab.textContent = 'コメント';
  fab.hidden = true;
  document.body.appendChild(fab);

  let pendingRange = null;

  document.addEventListener('mouseup', (e) => {
    if (finished || fab.contains(e.target)) return;
    // mouseup 直後は selection が未確定のことがあるので次のタスクで判定する
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return hideFab();
      const range = sel.getRangeAt(0);
      if (!content.contains(range.commonAncestorContainer)) return hideFab();
      if (!range.toString().trim()) return hideFab();
      pendingRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      fab.style.top = `${window.scrollY + rect.bottom + 6}px`;
      fab.style.left = `${window.scrollX + rect.left}px`;
      fab.hidden = false;
    }, 0);
  });

  function hideFab() {
    fab.hidden = true;
  }

  fab.addEventListener('click', () => {
    hideFab();
    if (pendingRange) openEditor(pendingRange);
  });

  // --- コメント入力ポップオーバー ---
  const editor = document.createElement('div');
  editor.id = 'dp-comment-editor';
  editor.hidden = true;
  editor.innerHTML =
    '<textarea rows="3" placeholder="コメントを入力"></textarea>' +
    '<div class="dp-editor-actions">' +
    '<button type="button" class="dp-save">保存</button>' +
    '<button type="button" class="dp-cancel">キャンセル</button>' +
    '</div>';
  document.body.appendChild(editor);
  const textarea = editor.querySelector('textarea');
  let editorRange = null;

  function openEditor(range) {
    editorRange = range;
    const rect = range.getBoundingClientRect();
    editor.style.top = `${window.scrollY + rect.bottom + 6}px`;
    editor.style.left = `${window.scrollX + rect.left}px`;
    editor.hidden = false;
    textarea.value = '';
    textarea.focus();
  }

  editor.querySelector('.dp-cancel').addEventListener('click', () => {
    editor.hidden = true;
  });
  editor.querySelector('.dp-save').addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text || !editorRange) return;
    addComment(editorRange, text);
    editor.hidden = true;
    window.getSelection()?.removeAllRanges();
  });

  // --- コメントの追加・削除 ---
  function nearestHeading(range) {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    let best = null;
    for (const h of content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      // DOCUMENT_POSITION_FOLLOWING = node が h より後ろ → h は選択位置より前の見出し
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
    }
    return best ? `${'#'.repeat(Number(best.tagName[1]))} ${best.textContent.trim()}` : '';
  }

  // 選択 Range に交差するテキストノードを個別に <mark> で包む。
  // ノード単位に閉じた Range にしてから surroundContents するので、
  // 要素境界をまたぐ選択でも DOM が壊れない。
  function highlightRange(range, id) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (range.intersectsNode(n) && n.data.length > 0) nodes.push(n);
    }
    const marks = [];
    for (const node of nodes) {
      const r = document.createRange();
      r.selectNodeContents(node);
      if (node === range.startContainer) r.setStart(node, range.startOffset);
      if (node === range.endContainer) r.setEnd(node, range.endOffset);
      if (r.collapsed || !r.toString()) continue;
      const mark = document.createElement('mark');
      mark.className = 'dp-annotation';
      mark.dataset.commentId = String(id);
      try {
        r.surroundContents(mark);
        marks.push(mark);
      } catch {
        // 特殊なノード構造で失敗してもコメント自体は成立させる
      }
    }
    return marks;
  }

  function addComment(range, text) {
    const id = nextId++;
    const quote = range.toString();
    const section = nearestHeading(range);
    const marks = highlightRange(range, id);
    comments.push({ id, quote, section, text, marks });
    renderList();
  }

  function removeComment(id) {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return;
    for (const mark of comments[idx].marks) {
      mark.replaceWith(...mark.childNodes);
    }
    content.normalize();
    comments.splice(idx, 1);
    renderList();
  }

  function renderList() {
    listEl.textContent = '';
    for (const c of comments) {
      const card = document.createElement('div');
      card.className = 'dp-comment-card';
      const quote = document.createElement('blockquote');
      quote.textContent = c.quote.length > 120 ? `${c.quote.slice(0, 120)}…` : c.quote;
      const body = document.createElement('p');
      body.textContent = c.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '削除';
      del.addEventListener('click', () => removeComment(c.id));
      card.append(quote, body, del);
      listEl.appendChild(card);
    }
    btnSubmit.textContent = `コメントを送信 (${comments.length})`;
    btnSubmit.disabled = comments.length === 0;
  }

  // --- 決定の送信 ---
  async function sendDecision(payload) {
    if (finished) return;
    finished = true;
    btnApprove.disabled = true;
    btnSubmit.disabled = true;
    try {
      await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      statusEl.textContent = '送信しました。このタブは閉じてください。';
      document.body.classList.add('dp-review-done');
    } catch {
      finished = false;
      btnApprove.disabled = false;
      renderList();
      statusEl.textContent = '送信に失敗しました。もう一度お試しください。';
    }
  }

  btnApprove.addEventListener('click', () => sendDecision({ decision: 'approve' }));
  btnSubmit.addEventListener('click', () =>
    sendDecision({
      decision: 'comments',
      comments: comments.map(({ quote, section, text }) => ({ quote, section, text })),
    })
  );

  // タブを閉じた / 離れた → dismissed (サーバー側は先勝ちなので送信後でも無害)
  window.addEventListener('pagehide', () => {
    if (!finished) navigator.sendBeacon('/api/decision', JSON.stringify({ decision: 'dismiss' }));
  });

  renderList();
})();
```

- [ ] **Step 2: `public/review.css` を作成**

```css
/* dp review モード専用スタイル (style.css の変数を利用) */
body[data-dp-mode='review'] {
  margin: 0;
}

.dp-review-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.dp-review-file {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dp-review-status {
  margin-left: auto;
  font-size: 13px;
  color: var(--muted);
}
.dp-review-bar button {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
}
.dp-review-bar button:disabled {
  opacity: 0.5;
  cursor: default;
}
#dp-btn-approve {
  border-color: #1f883d;
  color: #1f883d;
  font-weight: 600;
}

.dp-review-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
}

#dp-comment-list {
  position: sticky;
  top: 60px;
  align-self: start;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dp-comment-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.dp-comment-card blockquote {
  margin: 0 0 6px;
  padding-left: 8px;
  border-left: 3px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dp-comment-card p {
  margin: 0 0 8px;
  white-space: pre-wrap;
}
.dp-comment-card button {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}

mark.dp-annotation {
  background: rgba(255, 213, 0, 0.35);
  color: inherit;
  border-bottom: 2px solid rgba(212, 167, 44, 0.9);
}

#dp-comment-fab,
#dp-comment-editor {
  position: absolute;
  z-index: 200;
}
#dp-comment-fab {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
#dp-comment-editor {
  width: 320px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
}
#dp-comment-editor textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--fg);
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.dp-editor-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
.dp-editor-actions button {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
}

.dp-review-done #content {
  opacity: 0.6;
  pointer-events: none;
  user-select: none;
}

@media (max-width: 900px) {
  .dp-review-layout {
    grid-template-columns: 1fr;
  }
  #dp-comment-list {
    position: static;
    max-height: none;
  }
}
```

- [ ] **Step 3: 構文チェック**

Run: `node --check public/review.js`
Expected: エラーなし (exit 0)

- [ ] **Step 4: コミット**

```bash
git add public/review.js public/review.css
git commit -m "feat: レビュー UI (テキスト選択コメント) のブラウザ側実装を追加"
```

---

### Task 4: レビューサーバー (`src/review-server.js`)

**Files:**
- Create: `src/assets.js` (server.js との共有部を抽出)
- Modify: `src/server.js` (抽出した共有部を import に置き換え)
- Create: `src/review-server.js`
- Test: `test/review-server.test.js`

**Interfaces:**
- Consumes: `renderMarkdown` / `buildReviewPage` (render.js)、Task 3 の `public/review.js` / `public/review.css`
- Produces:
  - `src/assets.js`: `export const publicDir` / `export const MIME` / `export function resolveMermaidDist()`
  - `src/review-server.js`: `createReviewServer({ filePath, displayPath }) => { server, decision, close }`
    - `filePath`: 対象 .md の絶対パス (存在は呼び出し側で検証済み前提。読めなければ throw)
    - `displayPath`: ページ表示用のパス文字列 (省略時 filePath)
    - `decision`: `Promise<{ decision: 'approve'|'comments'|'dismiss', comments: Array<{quote,section,text}> }>`
    - `server` は既存 `startServer` にそのまま渡せる `http.Server`

- [ ] **Step 1: 共有部を `src/assets.js` に抽出する**

`src/assets.js`:

```js
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function resolveMermaidDist() {
  try {
    return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
  } catch {
    return fileURLToPath(new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url));
  }
}

export const MIME = {
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
```

`src/server.js` を修正: 冒頭の `publicDir` 定義・`resolveMermaidDist` 関数・`MIME` 定数を削除し、import に置き換える。

```js
// 削除するもの: const publicDir = ..., function resolveMermaidDist() {...}, const MIME = {...}
// 追加する import:
import { publicDir, resolveMermaidDist, MIME } from './assets.js';
```

`import { createRequire } from 'node:module';` と `import { fileURLToPath } from 'node:url';` が server.js 内で他に未使用になったら削除する。

- [ ] **Step 2: リファクタで既存テストが壊れていないことを確認**

Run: `npm test`
Expected: 全テスト PASS (この時点で review-server.test.js はまだない)

- [ ] **Step 3: コミット (リファクタ単独)**

```bash
git add src/assets.js src/server.js
git commit -m "refactor: 静的資産の共有定義を src/assets.js に抽出"
```

- [ ] **Step 4: 失敗するテストを書く**

`test/review-server.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReviewServer } from '../src/review-server.js';
import { startServer } from '../src/server.js';

let dir;
let srv; // { server, decision, close }
let port;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dp-review-test-'));
  await writeFile(
    path.join(dir, 'doc.md'),
    '# Title\n\n## Section A\n\nhello world\n\n![img](img.png)\n'
  );
  await writeFile(path.join(dir, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await mkdir(path.join(dir, 'sub'));
  srv = createReviewServer({ filePath: path.join(dir, 'doc.md'), displayPath: 'doc.md' });
  port = await startServer(srv.server, { port: 0 });
});

after(() => srv.close());

const base = () => `http://127.0.0.1:${port}`;
const get = (p) => fetch(`${base()}${p}`);
const postDecision = (body) =>
  fetch(`${base()}/api/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('/ はレンダリング済み本文 + レビュー UI を返す', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-dp-mode="review"/);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /id="dp-btn-approve"/);
});

test('/assets/review.js と review.css を配信する', async () => {
  assert.equal((await get('/assets/review.js')).status, 200);
  assert.equal((await get('/assets/review.css')).status, 200);
  assert.equal((await get('/assets/style.css')).status, 200);
});

test('md 内の相対パス静的ファイルを配信する', async () => {
  const res = await get('/img.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
});

test('パストラバーサルは 400', async () => {
  const res = await get('/../secret.txt');
  assert.equal(res.status, 400);
});

test('不正 JSON は 400、不正 decision も 400', async () => {
  assert.equal((await postDecision('{oops')).status, 400);
  assert.equal((await postDecision({ decision: 'nope' })).status, 400);
});

test('decision POST で Promise が解決し、2 回目は 409 (先勝ち)', async () => {
  const res = await postDecision({
    decision: 'comments',
    comments: [{ quote: 'hello world', section: '## Section A', text: '直して' }],
  });
  assert.equal(res.status, 200);
  const result = await srv.decision;
  assert.equal(result.decision, 'comments');
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].quote, 'hello world');

  const again = await postDecision({ decision: 'approve' });
  assert.equal(again.status, 409);
});

test('存在しないファイルで createReviewServer は throw する', async () => {
  assert.throws(() => createReviewServer({ filePath: path.join(dir, 'nai.md') }));
});
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `node --test test/review-server.test.js`
Expected: FAIL (`Cannot find module .../src/review-server.js`)

- [ ] **Step 6: 実装**

`src/review-server.js`:

```js
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicDir, resolveMermaidDist, MIME } from './assets.js';
import { renderMarkdown, buildReviewPage } from './render.js';

const ASSETS = {
  'review.js': { file: path.join(publicDir, 'review.js'), type: 'text/javascript; charset=utf-8' },
  'review.css': { file: path.join(publicDir, 'review.css'), type: 'text/css; charset=utf-8' },
  'style.css': { file: path.join(publicDir, 'style.css'), type: 'text/css; charset=utf-8' },
  'mermaid.min.js': { file: resolveMermaidDist(), type: 'text/javascript; charset=utf-8' },
};

const DECISIONS = new Set(['approve', 'comments', 'dismiss']);
const MAX_BODY = 1_000_000;

export function createReviewServer({ filePath, displayPath = filePath }) {
  const absFile = path.resolve(filePath);
  const root = path.dirname(absFile);
  // スナップショット: 起動時に 1 回だけ読む。以降ファイルが変わっても表示は不変。
  const page = buildReviewPage({
    title: path.basename(absFile),
    contentHtml: renderMarkdown(readFileSync(absFile, 'utf8')),
    filePath: displayPath,
  });

  let resolveDecision;
  let decided = false;
  const decision = new Promise((resolve) => {
    resolveDecision = resolve;
  });

  function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  }

  function safeResolve(relPath) {
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  async function handleDecision(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) return send(res, 413, 'Payload too large');
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return send(res, 400, 'Bad JSON');
    }
    if (!payload || !DECISIONS.has(payload.decision)) return send(res, 400, 'Bad decision');
    // 先勝ち: 最初の決定で確定。承認直後に届く pagehide の dismiss は 409 で無視される。
    if (decided) return send(res, 409, 'Already decided');
    decided = true;
    const comments = Array.isArray(payload.comments)
      ? payload.comments.map((c) => ({
          quote: String(c?.quote ?? ''),
          section: String(c?.section ?? ''),
          text: String(c?.text ?? ''),
        }))
      : [];
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    resolveDecision({ decision: payload.decision, comments });
  }

  async function handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (pathname.includes('..')) return send(res, 400, 'Bad path');

    if (req.method === 'POST' && pathname === '/api/decision') return handleDecision(req, res);

    if (pathname === '/') return send(res, 200, page, 'text/html; charset=utf-8');

    if (pathname.startsWith('/assets/')) {
      const asset = ASSETS[pathname.slice('/assets/'.length)];
      if (!asset) return send(res, 404, 'Not Found');
      try {
        return send(res, 200, await readFile(asset.file), asset.type);
      } catch {
        return send(res, 404, 'Not Found');
      }
    }

    // md 内の相対パス画像などの静的配信 (対象ファイルのディレクトリ起点)
    const abs = safeResolve(pathname.slice(1));
    if (!abs) return send(res, 400, 'Bad path');
    try {
      const buf = await readFile(abs);
      return send(res, 200, buf, MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    } catch {
      return send(res, 404, 'Not Found');
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, `Internal Server Error: ${err.message}`);
    });
  });

  function close() {
    server.closeAllConnections?.();
    server.close();
  }

  return { server, decision, close };
}
```

- [ ] **Step 7: テストが通ることを確認**

Run: `node --test test/review-server.test.js`
Expected: PASS (7 tests)

- [ ] **Step 8: 全テスト実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 9: コミット**

```bash
git add src/review-server.js test/review-server.test.js
git commit -m "feat: レビュー専用サーバー (スナップショット配信 + /api/decision) を追加"
```

---

### Task 5: CLI サブコマンド `dp review`

**Files:**
- Modify: `bin/dp.js`
- Test: `test/review-cli.test.js`

**Interfaces:**
- Consumes: `createReviewServer` (Task 4)、`formatReviewResult` / `DISMISSED_TEXT` (Task 1)、既存 `startServer` / `openBrowser`
- Produces: `dp review <file.md> [--port N] [--no-open]` コマンド。stdout に結果契約を出力して exit 0

- [ ] **Step 1: 失敗するテストを書く**

`test/review-cli.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/dp.js', import.meta.url));

async function makeDoc() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dp-review-cli-'));
  const file = path.join(dir, 'doc.md');
  await writeFile(file, '# Title\n\n## Section A\n\nhello world\n');
  return file;
}

// spawn して stderr から URL (ポート) が出るのを待つ
function spawnReview(file) {
  const child = spawn('node', [bin, 'review', file, '--no-open', '--port', '0']);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const url = new Promise((resolve, reject) => {
    const check = (d) => {
      const m = stderr.match(/(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (m) {
        child.stderr.removeListener('data', check);
        resolve(m[1]);
      }
    };
    child.stderr.on('data', check);
    child.on('close', () => reject(new Error(`exited early: ${stderr}`)));
  });
  const exited = new Promise((resolve) =>
    child.on('close', (code) => resolve({ code, stdout: () => stdout, stderr: () => stderr }))
  );
  return { child, url, exited, stdout: () => stdout };
}

const postDecision = (url, body) =>
  fetch(`${url}api/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('review: ファイル未指定はエラー終了', async () => {
  const r = await run('node', [bin, 'review']).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.md/);
});

test('review: md 以外はエラー終了', async () => {
  const r = await run('node', [bin, 'review', bin]).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.md ファイルのみ/);
});

test('review: 承認 → stdout は The user approved. のみ', async () => {
  const file = await makeDoc();
  const s = spawnReview(file);
  const url = await s.url;
  await postDecision(url, { decision: 'approve' });
  const { code, stdout } = await s.exited;
  assert.equal(code, 0);
  assert.equal(stdout().trim(), 'The user approved.');
});

test('review: コメント送信 → stdout に整形済みコメント', async () => {
  const file = await makeDoc();
  const s = spawnReview(file);
  const url = await s.url;
  await postDecision(url, {
    decision: 'comments',
    comments: [{ quote: 'hello world', section: '## Section A', text: 'ここ直して' }],
  });
  const { code, stdout } = await s.exited;
  assert.equal(code, 0);
  assert.match(stdout(), /# レビューコメント/);
  assert.match(stdout(), /> hello world/);
  assert.match(stdout(), /ここ直して/);
  assert.match(stdout(), /上記のコメントすべてに対応してください。/);
});

test('review: dismiss → 中断文言', async () => {
  const file = await makeDoc();
  const s = spawnReview(file);
  const url = await s.url;
  await postDecision(url, { decision: 'dismiss' });
  const { code, stdout } = await s.exited;
  assert.equal(code, 0);
  assert.equal(stdout().trim(), 'Review session closed without feedback.');
});

test('review: SIGTERM → 中断文言で正常終了', async () => {
  const file = await makeDoc();
  const s = spawnReview(file);
  await s.url;
  s.child.kill('SIGTERM');
  const { code, stdout } = await s.exited;
  assert.equal(code, 0);
  assert.equal(stdout().trim(), 'Review session closed without feedback.');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/review-cli.test.js`
Expected: FAIL (review が未知の positional として扱われ「パスが存在しません: review」等になる)

- [ ] **Step 3: `bin/dp.js` に review 分岐を実装**

USAGE を更新し、port 検証を分岐前に移動して、`positionals[0] === 'review'` の分岐を追加する。変更後の `bin/dp.js` 全体:

```js
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
```

注意: 通常プレビュー側のポート検証は分岐前に移動済みなので、既存の検証コード (旧 80-84 行) は残さない。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/review-cli.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 既存 CLI テスト含め全テスト実行**

Run: `npm test`
Expected: 全件 PASS (特に test/cli.test.js の「不正な --port」「対象外拡張子」が引き続き通ること)

- [ ] **Step 6: コミット**

```bash
git add bin/dp.js test/review-cli.test.js
git commit -m "feat: dp review サブコマンドを追加 (ブロッキングレビュー + stdout 契約)"
```

---

### Task 6: Claude 用スキル同梱と手動 E2E 確認

**Files:**
- Create: `.claude/skills/dp-review/SKILL.md`

**Interfaces:**
- Consumes: `dp review` の stdout 契約 (Task 1 / Task 5)
- Produces: Claude が成果物レビューを依頼するときの手順書

- [ ] **Step 1: SKILL.md を作成**

`.claude/skills/dp-review/SKILL.md`:

```markdown
---
name: dp-review
description: md の成果物 (設計書・レポート・ドキュメント) を書き終えてユーザーの確認を得たいとき、または「レビューさせて」と言われたときに、dp review でブラウザレビューを依頼する
---

# dp review — 成果物のブラウザレビュー依頼

md の成果物を書き終えたら、ユーザーにブラウザ上でレビューしてもらう。
ユーザーは本文のテキストを選択して箇所ごとにコメントを付けられる。

## 実行方法

Bash ツールで実行する。**必ず timeout を最大 (600000ms) にする**
(ユーザーがレビューを終えるまでコマンドはブロックするため):

    dp review <対象ファイル.md>

ブラウザが自動で開き、ユーザーの操作を待つ。

## 出力 (stdout) の解釈

| 出力 | 意味 | 次にすること |
|---|---|---|
| `The user approved.` | 承認された | 完了を報告して次の作業へ |
| `# レビューコメント` で始まる一覧 | 修正依頼 | 全コメントに対応し、修正後に再度 `dp review` で再提出。承認まで繰り返す |
| `Review session closed without feedback.` | 中断された | 作業を止めてユーザーの指示を待つ |

コメントには `Section:` (見出し) と `>` (本文の引用) が付く。引用テキストを
ソース md から検索して該当箇所を特定すること。

## 注意

- コマンドが 10 分でタイムアウトした場合はレビュー未完了として扱い、
  ユーザーに再実行するか尋ねる (長くレビューしたい場合は
  `BASH_MAX_TIMEOUT_MS` を settings で延ばせる)。
- 対象は .md のみ。HTML には使えない。
```

- [ ] **Step 2: コミット**

```bash
git add .claude/skills/dp-review/SKILL.md
git commit -m "feat: Claude 用 dp-review スキルを同梱"
```

- [ ] **Step 3: 手動 E2E 確認 (人間のブラウザ操作が必要)**

実行者向け手順 (自動化不可。ユーザーに依頼するか、確認項目として報告する):

```bash
node bin/dp.js review docs/superpowers/specs/2026-07-04-review-mode-design.md
```

確認項目:
1. ブラウザが開き、md がレンダリングされて上部バーとサイドバーが表示される
2. テキストをドラッグ選択 → 「コメント」ボタン → 入力・保存でハイライトとカードが付く
3. 見出しをまたぐ選択・太字/リンクをまたぐ選択でも DOM が壊れない
4. 削除ボタンでハイライトが消える
5. 「コメントを送信」→ ターミナルの stdout に整形済みコメントが出て exit
6. 再実行して「✓ 承認」→ `The user approved.`
7. 再実行してタブを閉じる → `Review session closed without feedback.`
8. ダークモードでも表示が破綻しない

---

### Task 7: ドキュメント更新 (README / CLAUDE.md)

**Files:**
- Modify: `README.md` (使い方セクションに review を追記)
- Modify: `CLAUDE.md` (コマンド・アーキテクチャ・設計上の約束事に追記)

- [ ] **Step 1: README.md に review モードの節を追加**

既存の使い方セクションの後に追加 (README の既存構成に合わせて調整可。内容は以下を必ず含める):

```markdown
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
- Claude Code 用のスキルを `.claude/skills/dp-review/` に同梱している。
  Bash timeout (既定最大 10 分) を超えるレビューには `BASH_MAX_TIMEOUT_MS` を設定する
```

- [ ] **Step 2: CLAUDE.md を更新**

以下を反映する:

- 「コマンド」セクションに追記:

```bash
node bin/dp.js review <file.md> [--no-open]  # レビューモード (ユーザーの決定までブロック)
```

- 「アーキテクチャ」セクションに追記 (server.js / watcher.js の説明と同列に):

```markdown
- **`src/review-server.js`** — `createReviewServer({ filePath })` がレビュー専用サーバーを返す。
  起動時に md を 1 回だけ読むスナップショット方式 (watcher/SSE なし)。
  `POST /api/decision` (approve / comments / dismiss、先勝ちで 2 回目以降は 409) で
  `decision` Promise が解決し、CLI が `src/format-review.js` で整形して stdout に出力する。
  stdout は結果契約専用で、URL などの案内は stderr に出す。
- **`public/review.js`** — レビュー UI。テキスト選択で `<mark>` ハイライト
  (Range に交差するテキストノードを個別に包む方式) + コメント、
  タブクローズは pagehide + sendBeacon で dismiss を通知する。
- **`src/assets.js`** — publicDir / MIME / mermaid 解決の共有定義 (server.js と review-server.js が使う)。
```

- 「設計上の制約・約束事」に追記:

```markdown
- **`dp review` の stdout は結果契約専用**: `The user approved.` /
  `Review session closed without feedback.` / `# レビューコメント` 形式のみを出力する。
  文言を変えるときは `.claude/skills/dp-review/SKILL.md` と README も合わせて変える。
  案内ログは stderr に出すこと。
```

- [ ] **Step 3: 全テスト最終確認**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 4: コミット**

```bash
git add README.md CLAUDE.md
git commit -m "docs: レビューモードの使い方とアーキテクチャを追記"
```

---

## 完了後

CLAUDE.md の開発ワークフローに従う:

1. `git push -u origin feat/review-mode` して PR を作成 (spec / plan のコミットも同ブランチに含まれる)
2. PR のマージ状態を Monitor で監視
3. マージ後: `git checkout main && git pull --ff-only origin main`、ブランチ削除
