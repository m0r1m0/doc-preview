import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startWatcher } from '../src/watcher.js';

test('md の追加と変更がイベントになり、txt は無視される', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dp-watch-'));
  const events = [];
  const watcher = startWatcher({ rootDir: dir, onEvent: (e) => events.push(e) });
  await new Promise((resolve) => watcher.on('ready', resolve));

  await writeFile(path.join(dir, 'x.md'), '# a');
  await writeFile(path.join(dir, 'skip.txt'), 'ignored');

  // ポーリング (最大 5 秒) で add イベント到着を待つ
  for (let i = 0; i < 50 && !events.some((e) => e.event === 'add'); i++) await sleep(100);
  assert.ok(
    events.some((e) => e.event === 'add' && e.path === 'x.md'),
    `add イベントが来ること: ${JSON.stringify(events)}`
  );

  await writeFile(path.join(dir, 'x.md'), '# b');
  for (let i = 0; i < 50 && !events.some((e) => e.event === 'change'); i++) await sleep(100);
  assert.ok(
    events.some((e) => e.event === 'change' && e.path === 'x.md'),
    `change イベントが来ること: ${JSON.stringify(events)}`
  );

  assert.ok(!events.some((e) => e.path === 'skip.txt'), 'txt は無視されること');
  await watcher.close();
});
