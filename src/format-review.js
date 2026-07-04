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
