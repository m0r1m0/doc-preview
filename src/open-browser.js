import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function trySpawn(cmd, args, onError) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', onError ?? (() => {}));
  child.unref();
}

export function openBrowser(url) {
  if (process.platform === 'darwin') return trySpawn('open', [url]);
  if (isWsl()) {
    // wslview 優先。無ければ cmd.exe 経由で Windows 側の既定ブラウザを開く
    return trySpawn('wslview', [url], () => {
      trySpawn('cmd.exe', ['/c', 'start', '', url]);
    });
  }
  return trySpawn('xdg-open', [url]);
}
