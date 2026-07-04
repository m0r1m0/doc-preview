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
