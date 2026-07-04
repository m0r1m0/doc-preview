import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
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
  assert.match(html, /<h1 id="title">Title<\/h1>/);
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
  // fetch は ../ を正規化してしまう (server.test.js と同じ理由) ので生ソケットで送る
  const raw = await new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET /..%2Fsecret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    let buf = '';
    sock.on('data', (d) => (buf += d));
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
  assert.match(raw, /^HTTP\/1\.1 400/);
});

test('不正 JSON は 400、不正 decision も 400', async () => {
  assert.equal((await postDecision('{oops')).status, 400);
  assert.equal((await postDecision({ decision: 'nope' })).status, 400);
});

test('MAX_BODY 超過は 413 で拒否され、接続破棄後も後続リクエストは正常', async () => {
  const big = JSON.stringify({
    decision: 'comments',
    comments: [{ quote: 'x'.repeat(1_100_000), section: '', text: '' }],
  });
  // 413 送信後に req.destroy() するため、環境によっては応答受信前に
  // 接続が切れてエラーになりうる。413 受信またはリクエスト失敗を許容する。
  try {
    const res = await postDecision(big);
    assert.equal(res.status, 413);
  } catch (err) {
    assert.ok(err instanceof TypeError, `unexpected error: ${err}`);
  }
  // 接続破棄が後続の通常リクエストに影響しないこと
  assert.equal((await get('/')).status, 200);
});

test('Origin が localhost 以外だと 403 になり、decision は消費されない', async () => {
  // 自前の別インスタンスで検証し、共有 srv の decided 状態に影響しないようにする
  const localDir = await mkdtemp(path.join(tmpdir(), 'dp-review-origin-'));
  await writeFile(path.join(localDir, 'doc.md'), '# Title\n\nhello\n');
  const local = createReviewServer({ filePath: path.join(localDir, 'doc.md'), displayPath: 'doc.md' });
  const localPort = await startServer(local.server, { port: 0 });
  try {
    const evil = await fetch(`http://127.0.0.1:${localPort}/api/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(evil.status, 403);

    // 拒否リクエストは先勝ちスロットを消費しないので、後続の正規 POST は 200 で通る
    const ok = await fetch(`http://127.0.0.1:${localPort}/api/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(ok.status, 200);
    const result = await local.decision;
    assert.equal(result.decision, 'approve');
  } finally {
    local.close();
  }
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
