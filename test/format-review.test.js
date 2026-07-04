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
