import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, buildMarkdownPage, buildIndexPage, injectReloadScript } from '../src/render.js';

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
