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
