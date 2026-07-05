# ToC サイドバー機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** md プレビューに h1–h3 の固定サイドバー ToC (クリックジャンプ + scroll spy + 開閉トグル) を追加する。

**Architecture:** 見出し ID はサーバー側 (`src/render.js` の markdown-it core ruler、自作・依存追加なし) で付与し、ToC の UI・scroll spy はクライアント側 (`public/client.js`) が DOM から組み立てる。ライブ更新 (`/raw/` 断片で `#content` を差し替え) 後は ToC を再構築するだけで追従できる。

**Tech Stack:** Node.js >= 20 (ESM / node:test)、markdown-it、素の DOM API + CSS。フレームワーク・新規依存なし。

**Spec:** `docs/superpowers/specs/2026-07-04-toc-design.md`

## Global Constraints

- Node.js >= 20、ESM、ビルド工程なし。**新規 npm 依存を追加しない**。
- ToC UI を出すのは **md モードのみ** (`data-dp-mode="md"`)。index / html / review モードの見た目は変えない (ID 付与は `renderMarkdown` 共通で入る)。
- ToC に載せる見出しは **h1–h3**。ID 付与自体は h1–h6 全部。
- `/raw/` は本文断片のみを返す契約を変えない。ToC の HTML をサーバーで生成しない。
- 属性値のエスケープは markdown-it の `attrSet` → `renderAttrs` に乗せる (自前で属性文字列を組み立てない)。
- テストは `node --test` (`npm test`)。client.js はブラウザテスト基盤がないため自動テスト対象外 (手動確認)。
- コミットは feat/toc ブランチに行う。コミットメッセージ末尾に以下を付ける:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PDuRXwGd9Gr1DHirafRG4
  ```

---

### Task 1: 見出し ID 付与 (サーバー側)

**Files:**
- Modify: `src/render.js` (28 行目 `const md = new MarkdownIt(...)` の後にルールを追加)
- Test: `test/render.test.js` (末尾に追加)
- Test: `test/server.test.js` (末尾に追加)

**Interfaces:**
- Consumes: 既存の `renderMarkdown(mdText)` (module-level `md` インスタンス)
- Produces: `renderMarkdown` の出力で全見出し (h1–h6) が `id` 属性を持つ。スラッグ規則: 小文字化 → ASCII 記号除去 → 空白類を `-` に。日本語はそのまま。重複は `-2`, `-3` 付番。空なら `section-N` (N は見出しの出現順、1 始まり)。Task 2 のクライアントはこの `id` を `href="#..."` に使う。

- [ ] **Step 1: 失敗するテストを書く**

`test/render.test.js` の末尾に追加:

```js
test('見出しに GitHub 風スラッグの id が付く', () => {
  const html = renderMarkdown('# Hello World');
  assert.match(html, /<h1 id="hello-world">Hello World<\/h1>/);
});

test('h1–h6 すべてに id が付く', () => {
  const html = renderMarkdown('# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f');
  for (const [tag, id] of [['h1', 'a'], ['h2', 'b'], ['h3', 'c'], ['h4', 'd'], ['h5', 'e'], ['h6', 'f']]) {
    assert.match(html, new RegExp(`<${tag} id="${id}">`));
  }
});

test('日本語見出しはそのまま id になる', () => {
  const html = renderMarkdown('## 使い方\n\n### インストール手順');
  assert.match(html, /<h2 id="使い方">/);
  assert.match(html, /<h3 id="インストール手順">/);
});

test('見出しの ASCII 記号は除去され空白は - になる', () => {
  const html = renderMarkdown('## Hello, World! (v2.0)');
  assert.match(html, /<h2 id="hello-world-v20">/);
});

test('重複する見出しは -2, -3 と付番される', () => {
  const html = renderMarkdown('## Setup\n\n## Setup\n\n## Setup');
  assert.match(html, /<h2 id="setup">/);
  assert.match(html, /<h2 id="setup-2">/);
  assert.match(html, /<h2 id="setup-3">/);
});

test('付番は renderMarkdown 呼び出しごとにリセットされる', () => {
  renderMarkdown('## Setup');
  const html = renderMarkdown('## Setup');
  assert.match(html, /<h2 id="setup">/);
  assert.doesNotMatch(html, /id="setup-2"/);
});

test('インライン記法入りの見出しはテキストだけで id を作る', () => {
  const html = renderMarkdown('## Use `dp review` **now**');
  assert.match(html, /<h2 id="use-dp-review-now">/);
});

test('記号のみの見出しは section-N にフォールバックする', () => {
  const html = renderMarkdown('# Intro\n\n## !!!');
  assert.match(html, /<h2 id="section-2">/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/render.test.js`
Expected: 上で追加したテストが FAIL (`<h1>Hello World</h1>` に id が無い)

- [ ] **Step 3: 最小実装**

`src/render.js` の `md.use(taskLists);` (29 行目) の直後に追加:

```js
// 見出しに GitHub 風スラッグの id を付与する core ruler (自作、依存追加なし)。
// ToC (client.js) のアンカー先および #見出し 直リンクに使う。
const SLUG_PUNCT_RE = /[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g;

function slugify(text) {
  return text.trim().toLowerCase().replace(SLUG_PUNCT_RE, '').replace(/\s+/g, '-');
}

md.core.ruler.push('dp_heading_ids', (state) => {
  const used = new Set();
  let n = 0;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    n++;
    const inline = tokens[i + 1];
    const text = inline?.type === 'inline'
      ? inline.children
          .filter((t) => t.type === 'text' || t.type === 'code_inline')
          .map((t) => t.content)
          .join('')
      : '';
    const base = slugify(text) || `section-${n}`;
    let slug = base;
    for (let k = 2; used.has(slug); k++) slug = `${base}-${k}`;
    used.add(slug);
    tokens[i].attrSet('id', slug);
  }
});
```

補足:
- `attrSet` を使うことで属性値のエスケープは markdown-it の `renderAttrs` (escapeHtml) に乗る。
- 付番状態 (`used`, `n`) はルール実行 (= レンダリング 1 回) ごとのローカル変数なので自動的にリセットされる。
- `used` に付番後のスラッグも登録するため、`a`, `a`, `a-2` のような二次衝突でも重複 id にならない (`a`, `a-2`, `a-2-2` になる)。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/render.test.js`
Expected: Step 1 で追加したテストは全 PASS。ただし既存の「見出しとテーブルを HTML に変換する」テスト (5 行目) は `<h1>Title</h1>` が `<h1 id="title">Title</h1>` になるため FAIL する — 次の Step で更新する。

- [ ] **Step 5: id 付与で壊れる既存テストを更新**

`test/render.test.js` 5–9 行目の既存テストを更新:

```js
test('見出しとテーブルを HTML に変換する', () => {
  const html = renderMarkdown('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<table>/);
});
```

`test/server.test.js` にも `<h1>Hello</h1>` を期待する箇所が 2 つある (42 行目と 113 行目)。それぞれ `/<h1 id="hello">Hello<\/h1>/` に更新する。

- [ ] **Step 6: /raw/ 断片に id が含まれる統合テストを追加**

`test/server.test.js` の末尾に追加:

```js
test('/raw/<md> の断片の見出しに id が付く (ライブ更新後も ToC アンカーが成立する)', async () => {
  const frag = await (await get('/raw/a.md')).text();
  assert.match(frag, /<h1 id="hello">Hello<\/h1>/);
});
```

- [ ] **Step 7: 全テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 8: コミット**

```bash
git add src/render.js test/render.test.js test/server.test.js
git commit -m "feat: 見出しに GitHub 風スラッグの id を付与する core ruler を追加"
```

---

### Task 2: ToC サイドバー UI (クライアント側)

**Files:**
- Modify: `public/client.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: Task 1 が付与した `#content` 内の h1–h3 の `id` 属性。既存の `mode` (`body.dataset.dpMode`)、`refresh()`、`renderMermaidBlocks()`。
- Produces: `buildToc()` — `#content` から `<nav id="dp-toc">` と再表示ボタン `#dp-toc-reopen` を (再) 構築して body に挿入する関数。`updateTocActive()` — 現在セクションの ToC 項目に `.active` を付ける関数 (Task 3 でスクロールに接続)。body クラス `dp-has-toc` / `dp-toc-collapsed`。localStorage キー `dp-toc-collapsed` (`'1'` = 閉)。

- [ ] **Step 1: client.js に ToC 構築ロジックを追加**

`public/client.js` の `function showMissing()` の前に追加:

```js
// ---- ToC サイドバー (md モードのみ) ----
const TOC_COLLAPSED_KEY = 'dp-toc-collapsed';
let tocHeadings = [];

function setTocCollapsed(collapsed, { save = true } = {}) {
  body.classList.toggle('dp-toc-collapsed', collapsed);
  if (save) localStorage.setItem(TOC_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function updateTocActive() {
  if (tocHeadings.length === 0) return;
  let active = tocHeadings[0];
  for (const h of tocHeadings) {
    if (h.getBoundingClientRect().top <= 80) active = h;
    else break;
  }
  for (const a of document.querySelectorAll('#dp-toc a')) {
    a.classList.toggle('active', a.dataset.dpTarget === active.id);
  }
}

function buildToc() {
  document.getElementById('dp-toc')?.remove();
  document.getElementById('dp-toc-reopen')?.remove();
  body.classList.remove('dp-has-toc');
  tocHeadings = mode === 'md'
    ? [...document.querySelectorAll('#content h1[id], #content h2[id], #content h3[id]')]
    : [];
  if (tocHeadings.length === 0) return;

  const nav = document.createElement('nav');
  nav.id = 'dp-toc';
  const head = document.createElement('div');
  head.className = 'dp-toc-head';
  const label = document.createElement('span');
  label.textContent = '目次';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '⟨';
  closeBtn.title = '目次を閉じる';
  closeBtn.addEventListener('click', () => setTocCollapsed(true));
  head.append(label, closeBtn);

  const list = document.createElement('ul');
  for (const h of tocHeadings) {
    const li = document.createElement('li');
    li.className = `dp-toc-${h.tagName.toLowerCase()}`;
    const a = document.createElement('a');
    a.href = `#${encodeURIComponent(h.id)}`;
    a.dataset.dpTarget = h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.append(head, list);

  const reopen = document.createElement('button');
  reopen.id = 'dp-toc-reopen';
  reopen.type = 'button';
  reopen.textContent = '☰ 目次';
  reopen.title = '目次を開く';
  reopen.addEventListener('click', () => setTocCollapsed(false));

  body.append(nav, reopen);
  body.classList.add('dp-has-toc');
  setTocCollapsed(localStorage.getItem(TOC_COLLAPSED_KEY) === '1', { save: false });
  updateTocActive();
}
```

- [ ] **Step 2: 初期表示とライブ更新後に buildToc を呼ぶ**

`refresh()` 内の `await renderMermaidBlocks(content);` の直後に 1 行追加:

```js
    await renderMermaidBlocks(content);
    buildToc(); // 見出し構成が変わっている可能性があるので再構築
```

ファイル末尾の `renderMermaidBlocks(document);` の直後に 1 行追加:

```js
  renderMermaidBlocks(document);
  buildToc();
```

`showMissing()` の直後にも ToC を消すため、`showMissing` を次のように変更:

```js
  function showMissing() {
    document.getElementById('content').innerHTML =
      '<p class="dp-missing">ファイルが見つかりません</p>';
    buildToc(); // 見出しが消えたので ToC も消える
  }
```

- [ ] **Step 3: style.css にサイドバーのスタイルを追加**

`public/style.css` の末尾に追加:

```css
/* ---- ToC サイドバー (md モード、client.js が生成) ---- */
#dp-toc {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 240px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg);
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 0.8rem 0.6rem 2rem;
}
/* dir モードの sticky ヘッダー (一覧に戻る) と重ならないよう下げる */
body:has(> .dp-header) #dp-toc { top: 2.4rem; }
.dp-toc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--muted);
  font-weight: 600;
  padding: 0 0.4em 0.5em;
}
.dp-toc-head button,
#dp-toc-reopen {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.1em 0.5em;
}
.dp-toc-head button:hover,
#dp-toc-reopen:hover { color: var(--link); }
#dp-toc ul { list-style: none; padding: 0; margin: 0; }
#dp-toc a {
  display: block;
  padding: 0.25em 0.4em;
  border-radius: 4px;
  color: var(--muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#dp-toc a:hover { background: var(--code-bg); color: var(--fg); }
#dp-toc a.active { color: var(--link); font-weight: 600; }
#dp-toc .dp-toc-h2 { padding-left: 0.9em; }
#dp-toc .dp-toc-h3 { padding-left: 1.9em; }
body.dp-has-toc:not(.dp-toc-collapsed) main#content {
  margin-left: 264px;
  margin-right: auto;
}
#dp-toc-reopen {
  display: none;
  position: fixed;
  left: 0.5rem;
  top: 0.5rem;
  z-index: 5;
}
body:has(> .dp-header) #dp-toc-reopen { top: 2.9rem; }
body.dp-toc-collapsed #dp-toc { display: none; }
body.dp-has-toc.dp-toc-collapsed #dp-toc-reopen { display: block; }
@media (max-width: 900px) {
  #dp-toc, #dp-toc-reopen { display: none !important; }
  body.dp-has-toc main#content { margin-left: auto; }
}
```

- [ ] **Step 4: 回帰確認 (自動テスト)**

Run: `npm test`
Expected: 全 PASS (client.js / style.css はサーバーテストに影響しない)

- [ ] **Step 5: 手動確認**

サンプルを作って起動:

```bash
cat > /tmp/claude-1000/-home-yukiw-repos-doc-preview/7ca1165f-6034-43fb-8722-f7ecd98dbb8c/scratchpad/toc-sample.md <<'EOF'
# ToC サンプル

## 概要

本文。

## 使い方

### インストール

本文。

### 起動

本文。

## 使い方

重複見出しのテスト。

## 設計

### `render.js` の役割

本文。
EOF
node bin/dp.js /tmp/claude-1000/-home-yukiw-repos-doc-preview/7ca1165f-6034-43fb-8722-f7ecd98dbb8c/scratchpad/toc-sample.md --no-open
```

ブラウザで `http://127.0.0.1:3000/` を開き確認:
- [ ] 左に「目次」サイドバーが出て h1–h3 が階層インデント付きで並ぶ
- [ ] 重複見出し「使い方」の 2 つ目もクリックで正しい位置に飛ぶ (`#使い方-2`)
- [ ] ⟨ で閉じると本文が広がり「☰ 目次」ボタンが出る。リロードしても閉じたまま (localStorage)
- [ ] 見出しのない md (例: 本文だけの md) では ToC もボタンも出ない
- [ ] ファイルに見出しを追記して保存すると、ToC に即時反映されスクロール位置は保たれる
- [ ] ウィンドウ幅を 900px 未満にすると ToC が消え本文が中央に戻る

- [ ] **Step 6: コミット**

```bash
git add public/client.js public/style.css
git commit -m "feat: md プレビューに ToC サイドバーを追加 (開閉トグル・ライブ更新追従)"
```

---

### Task 3: scroll spy + スムーズスクロール

**Files:**
- Modify: `public/client.js`
- Modify: `public/style.css`
- Modify: `docs/superpowers/specs/2026-07-04-toc-design.md` (scroll spy の実装方式の記述を実装に合わせる)

**Interfaces:**
- Consumes: Task 2 の `updateTocActive()` と `tocHeadings`。
- Produces: スクロールに連動した `.active` ハイライト。CSS `scroll-behavior: smooth` と `scroll-margin-top`。

- [ ] **Step 1: スクロールイベントで updateTocActive を呼ぶ**

`public/client.js` の末尾 (`buildToc();` の直後) に追加:

```js
  // scroll spy: 現在セクションの ToC 項目をハイライト
  document.addEventListener('scroll', updateTocActive, { passive: true });
```

判定ロジック自体は Task 2 の `updateTocActive()` (ビューポート上端から 80px 以内に達した最後の見出しを現在地とする) をそのまま使う。

- [ ] **Step 2: スムーズスクロールと見出しのオフセットを CSS に追加**

`public/style.css` の `* { box-sizing: border-box; }` (38 行目) の直後に追加:

```css
html { scroll-behavior: smooth; }
h1, h2, h3, h4, h5, h6 { scroll-margin-top: 3rem; }
```

`scroll-margin-top` は dir モードの sticky ヘッダーの高さ + 余白ぶん。file モードでも視認性のための上余白として機能する。

- [ ] **Step 3: 設計書の scroll spy 記述を実装に合わせる**

`docs/superpowers/specs/2026-07-04-toc-design.md` の scroll spy に関する記述
(「設計詳細 > 2. クライアント側」の scroll spy 項、および「ライブ更新追従」項の
「IntersectionObserver も張り直す」) を以下の趣旨に置き換える:

```
- **scroll spy**: scroll イベント (passive) で、ビューポート上端から 80px 以内に達した最後の見出しを現在セクションと判定し、ToC の該当項目に `.active` クラスを付ける。
```

理由: IntersectionObserver は「見出し間の長い本文をスクロール中」の現在地判定に別途状態管理が要り、単純なスクロール判定のほうが少ないコードで決定的に動くため。

- [ ] **Step 4: 回帰確認 (自動テスト)**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: 手動確認**

Task 2 Step 5 と同じサンプルで起動し、ブラウザで確認:
- [ ] ToC 項目クリックでスムーズにスクロールし、見出しが上端に張り付かず 3rem の余白を持つ
- [ ] URL に `#スラッグ` が付き、その URL を再読み込みすると同じ位置に飛ぶ
- [ ] スクロールすると現在セクションの ToC 項目がハイライトされ、最上部では先頭項目、最下部では最後のセクションが active になる

- [ ] **Step 6: コミット**

```bash
git add public/client.js public/style.css docs/superpowers/specs/2026-07-04-toc-design.md
git commit -m "feat: ToC に scroll spy とスムーズスクロールを追加"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `README.md` (機能一覧・使い方に ToC を追記)
- Modify: `CLAUDE.md` (アーキテクチャ節の `public/client.js` と `src/render.js` の説明に ToC を追記)

**Interfaces:**
- Consumes: Task 1–3 の完成した挙動。
- Produces: なし (ドキュメントのみ)。

- [ ] **Step 1: README.md に ToC 機能を追記**

README.md の機能紹介セクション (現状の記述スタイルに合わせる) に以下の趣旨を追加:

```markdown
- **目次サイドバー**: md プレビューで h1–h3 の目次を左サイドバーに表示。
  クリックでジャンプ、スクロールに追従して現在位置をハイライト、⟨ ボタンで開閉できる
  (状態は記憶される)。見出しには GitHub 風のスラッグ id が付くので `#見出し` の直リンクも使える。
```

- [ ] **Step 2: CLAUDE.md のアーキテクチャ説明を更新**

- `src/render.js` の説明に「全見出しに GitHub 風スラッグの `id` を付与する core ruler (`dp_heading_ids`) を持つ」を追記。
- `public/client.js` の説明に「md モードでは h1–h3 から ToC サイドバーを組み立て、scroll spy と開閉トグル (localStorage) を提供する。`/raw/` 差し替え後に再構築してライブ更新に追従する」を追記。

- [ ] **Step 3: 全テスト + 表記確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 4: コミット**

```bash
git add README.md CLAUDE.md
git commit -m "docs: ToC サイドバー機能を README / CLAUDE.md に追記"
```
