import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserCandidates } from '../src/open-browser.js';

const URL = 'http://127.0.0.1:3000/';
const never = () => false;
const base = { exists: never, env: {} };
const cmds = (got) => got.map((c) => c.cmd);

test('macOS は open のみ', () => {
  const got = browserCandidates(URL, { ...base, platform: 'darwin' });
  assert.deepEqual(got, [{ cmd: 'open', args: [URL] }]);
});

test('WSL でない Linux は xdg-open のみ', () => {
  const got = browserCandidates(URL, { ...base, platform: 'linux', wsl: false });
  assert.deepEqual(got, [{ cmd: 'xdg-open', args: [URL] }]);
});

test('WSL は wslview → cmd.exe → cmd.exe の絶対パスの順に試す', () => {
  const got = browserCandidates(URL, {
    ...base,
    platform: 'linux',
    wsl: true,
    exists: (p) => p === '/mnt/c/Windows/System32/cmd.exe',
  });
  assert.deepEqual(cmds(got), ['wslview', 'cmd.exe', '/mnt/c/Windows/System32/cmd.exe']);
  // Windows 側の PATH が無い環境でも動くよう、絶対パス候補が必要。
  // cwd は Windows から見えるディレクトリにして UNC 警告を避ける。
  assert.deepEqual(got[2].args, ['/c', 'start', '', URL]);
  assert.equal(got[2].cwd, '/mnt/c/Windows/System32');
});

test('存在しない cmd.exe の絶対パスは候補に入れない', () => {
  const got = browserCandidates(URL, { ...base, platform: 'linux', wsl: true });
  assert.deepEqual(cmds(got), ['wslview', 'cmd.exe']);
});

test('Orca 配下では orca tab create を最優先で使う', () => {
  const env = { ORCA_RELAY_SOCKET_PATH: '/home/u/.orca-remote/relay.sock', HOME: '/home/u' };
  const got = browserCandidates(URL, { ...base, platform: 'linux', wsl: true, env });
  assert.equal(got[0].cmd, 'orca');
  assert.deepEqual(got[0].args, ['tab', 'create', '--url', 'http://localhost:3000/']);
  // 終了コードで成否が分かるので、失敗時は次の候補に進めるよう待つ
  assert.equal(got[0].waitExit, true);
  assert.deepEqual(cmds(got).slice(1), ['wslview', 'cmd.exe']);
});

test('Orca には 127.0.0.1 ではなく localhost を渡す', () => {
  // Orca のブラウザは SOCKS 越しなのでリテラルの 127.0.0.1 は開けない
  const env = { ORCA_RELAY_SOCKET_PATH: '/home/u/.orca-remote/relay.sock', HOME: '/home/u' };
  const got = browserCandidates('http://127.0.0.1:3000/', { ...base, platform: 'darwin', env });
  assert.deepEqual(got[0].args, ['tab', 'create', '--url', 'http://localhost:3000/']);
  // OS の既定ブラウザ側は書き換えない
  assert.deepEqual(got[1], { cmd: 'open', args: ['http://127.0.0.1:3000/'] });
});

test('Orca 配下で orca が PATH に無くても絶対パスを候補にする', () => {
  const env = { ORCA_RELAY_SOCKET_PATH: '/home/u/.orca-remote/relay.sock', HOME: '/home/u' };
  const got = browserCandidates(URL, {
    ...base,
    platform: 'darwin',
    env,
    exists: (p) => p === '/home/u/.orca-relay/bin/orca',
  });
  assert.deepEqual(cmds(got), ['orca', '/home/u/.orca-relay/bin/orca', 'open']);
});

test('Orca の環境変数が無ければ orca は候補に入らない', () => {
  const got = browserCandidates(URL, { ...base, platform: 'darwin', env: { HOME: '/home/u' } });
  assert.deepEqual(cmds(got), ['open']);
});
