import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/dp.js', import.meta.url));

async function runCli(args) {
  try {
    const { stdout, stderr } = await run('node', [bin, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('引数なしはエラー終了 (code 1) で usage を出す', async () => {
  const r = await runCli([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Usage/);
});

test('存在しないパスはエラー終了', async () => {
  const r = await runCli(['/no/such/path.md']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /存在しません/);
});

test('対象外拡張子はエラー終了', async () => {
  const r = await runCli([bin]); // .js ファイルを渡す
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.md \/ \.html/);
});

test('不正な --port はエラー終了 (code 1) でスタックトレースを出さない', async () => {
  const r = await runCli(['.', '--port', 'abc', '--no-open']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ポート番号が不正です/);
  assert.doesNotMatch(r.stderr, /ERR_SOCKET_BAD_PORT/);
});

test('--help は usage を出して正常終了', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage/);
});

test('--version はバージョンを出して正常終了', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\d+\.\d+\.\d+/);
});
