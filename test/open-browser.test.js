import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserCandidates,
  listInteropSockets,
  findInteractiveInterop,
} from '../src/open-browser.js';

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

// --- WSL_INTEROP が無い環境 (systemd 配下で動く herdr など) ---
// WSL_INTEROP が無いと Windows 側プロセスはセッション 0 で起動され、
// ブラウザが画面に出ない。画面のあるセッションに繋がるソケットを探して使う。

test('WSL_INTEROP を渡すと WSL の候補すべての env に入る', () => {
  const env = { HOME: '/home/u' };
  const got = browserCandidates(URL, {
    ...base,
    env,
    platform: 'linux',
    wsl: true,
    exists: (p) => p === '/mnt/c/Windows/System32/cmd.exe',
    interop: '/run/WSL/1229_interop',
  });
  for (const c of got) {
    assert.deepEqual(c.env, { HOME: '/home/u', WSL_INTEROP: '/run/WSL/1229_interop' });
  }
});

test('interop を渡さなければ env は付けない', () => {
  const got = browserCandidates(URL, { ...base, platform: 'linux', wsl: true });
  for (const c of got) assert.equal(c.env, undefined);
});

test('interop ソケットは生きている /init のものを新しい (pid が大きい) 順に並べる', () => {
  const got = listInteropSockets({
    readdir: () => ['1_interop', '2564_interop', '311_interop', '1229_interop', '999_interop', 'other'],
    alive: (pid) => pid !== 999,
  });
  assert.deepEqual(got, [
    '/run/WSL/2564_interop',
    '/run/WSL/1229_interop',
    '/run/WSL/311_interop',
    '/run/WSL/1_interop',
  ]);
});

test('/run/WSL が読めなければ空', () => {
  const got = listInteropSockets({
    readdir: () => {
      throw new Error('ENOENT');
    },
    alive: () => true,
  });
  assert.deepEqual(got, []);
});

test('セッション 0 のソケットは飛ばし、最初に見つかった画面のあるセッションのものを返す', async () => {
  const sessions = { '/run/WSL/311_interop': 0, '/run/WSL/1229_interop': 1, '/run/WSL/2564_interop': 1 };
  const probed = [];
  const got = await findInteractiveInterop({
    sockets: ['/run/WSL/311_interop', '/run/WSL/1229_interop', '/run/WSL/2564_interop'],
    probe: async (s) => {
      probed.push(s);
      return sessions[s];
    },
  });
  assert.equal(got, '/run/WSL/1229_interop');
  assert.deepEqual(probed, ['/run/WSL/311_interop', '/run/WSL/1229_interop']);
});

test('調べられなかったソケットは飛ばし、全滅なら null', async () => {
  const got = await findInteractiveInterop({
    sockets: ['/run/WSL/311_interop', '/run/WSL/1_interop'],
    probe: async (s) => (s === '/run/WSL/1_interop' ? 0 : null),
  });
  assert.equal(got, null);
});
