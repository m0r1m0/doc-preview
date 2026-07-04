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
