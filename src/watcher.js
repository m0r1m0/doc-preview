import chokidar from 'chokidar';
import path from 'node:path';

const DOC_EXTS = new Set(['.md', '.html', '.htm']);

export function startWatcher({ rootDir, onEvent }) {
  const root = path.resolve(rootDir);
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => {
      const base = path.basename(p);
      return (base.startsWith('.') && p !== root) || base === 'node_modules';
    },
  });
  for (const event of ['change', 'add', 'unlink']) {
    watcher.on(event, (absPath) => {
      if (!DOC_EXTS.has(path.extname(absPath).toLowerCase())) return;
      const rel = path.relative(root, absPath).split(path.sep).join('/');
      onEvent({ event, path: rel });
    });
  }
  return watcher;
}
