import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

// Windows 側の PATH が継承されない環境では `cmd.exe` が名前で解決できないので
// 絶対パスの候補も試す。
const WIN_CMD_PATHS = ['/mnt/c/Windows/System32/cmd.exe', '/c/Windows/System32/cmd.exe'];

// Orca (SSH 越しにターミナルを提供するアプリ) の中では、OS の既定ブラウザを
// 起こしてもユーザーの画面には出ない。SSH 経由なのでプロセスが対話セッションの
// 外 (Windows ならセッション 0) で起動され、ウィンドウが見えないため。
// Orca 配下では専用 CLI に開いてもらう。
// Orca のブラウザは SOCKS プロキシ越しに接続するため、リテラルの 127.0.0.1 は
// ERR_SOCKS_CONNECTION_FAILED で開けない (ホスト名はプロキシ側で解決される)。
// localhost に書き換える。
function orcaUrl(url) {
  return url.replace('://127.0.0.1', '://localhost');
}

function orcaCandidates(url, env, exists) {
  if (!env.ORCA_RELAY_SOCKET_PATH) return [];
  const args = ['tab', 'create', '--url', orcaUrl(url)];
  const fallback = env.HOME ? path.join(env.HOME, '.orca-relay/bin/orca') : null;
  return [
    // orca は終了コードで成否を返すので、失敗したら次の候補に進む。
    { cmd: 'orca', args, waitExit: true },
    ...(fallback && exists(fallback) ? [{ cmd: fallback, args, waitExit: true }] : []),
  ];
}

// テスト用に純関数として切り出す (実際の spawn はしない)。
export function browserCandidates(url, overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const wsl = overrides.wsl ?? isWsl();
  const exists = overrides.exists ?? existsSync;
  const env = overrides.env ?? process.env;

  const orca = orcaCandidates(url, env, exists);
  if (platform === 'darwin') return [...orca, { cmd: 'open', args: [url] }];
  if (!wsl) return [...orca, { cmd: 'xdg-open', args: [url] }];

  // wslview 優先。無ければ cmd.exe 経由で Windows 側の既定ブラウザを開く。
  // cmd.exe は cwd が WSL パスだと UNC 警告を出すので、見つけた exe の
  // ディレクトリ (Windows から見えるパス) を cwd にする。
  const startArgs = ['/c', 'start', '', url];
  return [
    ...orca,
    { cmd: 'wslview', args: [url] },
    { cmd: 'cmd.exe', args: startArgs },
    ...WIN_CMD_PATHS.filter(exists).map((cmd) => ({
      cmd,
      args: startArgs,
      cwd: path.dirname(cmd),
    })),
  ];
}

function trySpawn({ cmd, args, cwd, waitExit }, onError) {
  let done = false;
  // error と exit が両方飛ぶことがあるので、フォールバックは 1 回だけ。
  const fail = () => {
    if (done) return;
    done = true;
    onError();
  };
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: !waitExit, cwd });
    child.on('error', fail);
    if (waitExit) {
      child.on('exit', (code) => {
        if (code === 0) done = true;
        else fail();
      });
    } else {
      child.unref();
    }
  } catch {
    // spawn は同期例外も投げうる (例: /mnt/c が壊れていて EIO)。
    // ブラウザが開けなくてもサーバは生かし、URL の手動オープンに委ねる。
    fail();
  }
}

// 候補を上から試し、失敗 (ENOENT や非 0 終了) したら次にフォールバックする。
// 全部失敗してもプロセスは落とさない (URL の手動オープンに委ねる)。
function trySpawnChain([head, ...rest]) {
  if (!head) return;
  trySpawn(head, () => trySpawnChain(rest));
}

export function openBrowser(url) {
  trySpawnChain(browserCandidates(url));
}
