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
  assert.match(html, /<h1 id="hello">Hello<\/h1>/);
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
  assert.match(html, /<h1 id="hello">Hello<\/h1>/);
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
  assert.match(html, /<h1 id="hello">Hello<\/h1>/);
  s2.close();
});

test('dir モード: /view の md に一覧へ戻るヘッダーが付き、html には付かない', async () => {
  const mdHtml = await (await get('/view/a.md')).text();
  assert.match(mdHtml, /一覧に戻る/);
  const rawHtml = await (await get('/view/b.html')).text();
  assert.doesNotMatch(rawHtml, /一覧に戻る/);
});

test('dir モード: /raw の断片には戻るヘッダーが付かない', async () => {
  const frag = await (await get('/raw/a.md')).text();
  assert.doesNotMatch(frag, /一覧に戻る/);
});

test('file モード: / のプレビューに戻るヘッダーは付かない', async () => {
  const s5 = createPreviewServer({ rootDir: dir, entry: 'a.md', mode: 'file' });
  const p5 = await startServer(s5.server, { port: 0 });
  const html = await (await fetch(`http://127.0.0.1:${p5}/`)).text();
  assert.doesNotMatch(html, /一覧に戻る/);
  s5.close();
});

test('startServer は使用中ポートを +1 して再試行する', async () => {
  const s3 = createPreviewServer({ rootDir: dir, mode: 'dir' });
  const p3 = await startServer(s3.server, { port });
  assert.notEqual(p3, port);
  assert.ok(p3 > port);
  s3.close();
});

test('startServer 後の server に error リスナーが付いていてクラッシュしない', async () => {
  const s4 = createPreviewServer({ rootDir: dir, mode: 'dir' });
  await startServer(s4.server, { port: 0 });
  assert.ok(s4.server.listenerCount('error') >= 1);
  s4.server.emit('error', new Error('boom'));
  s4.close();
});

test('/raw/<md> の断片の見出しに id が付く (ライブ更新後も ToC アンカーが成立する)', async () => {
  const frag = await (await get('/raw/a.md')).text();
  assert.match(frag, /<h1 id="hello">Hello<\/h1>/);
});
