/* global mermaid */
(() => {
  const body = document.body;
  const mode = body.dataset.dpMode; // 'md' | 'index'
  const current = body.dataset.dpPath || '';
  const encPath = current.split('/').map(encodeURIComponent).join('/');

  let mermaidReady = false;
  if (typeof mermaid !== 'undefined') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
    });
    mermaidReady = true;
  }

  let seq = 0;
  async function renderMermaidBlocks(root) {
    if (!mermaidReady) return;
    for (const block of root.querySelectorAll('pre.mermaid')) {
      const code = block.textContent;
      const id = `dp-mermaid-${seq++}`;
      try {
        const { svg } = await mermaid.render(id, code);
        const div = document.createElement('div');
        div.className = 'mermaid-rendered';
        div.innerHTML = svg;
        block.replaceWith(div);
      } catch (err) {
        // 失敗したブロックだけエラー表示にして、ページ全体は壊さない
        const pre = document.createElement('pre');
        pre.className = 'mermaid-error';
        pre.textContent = `mermaid エラー: ${err.message}\n\n${code}`;
        block.replaceWith(pre);
        document.getElementById('d' + id)?.remove();
      }
    }
  }

  function showMissing() {
    document.getElementById('content').innerHTML =
      '<p class="dp-missing">ファイルが見つかりません</p>';
  }

  async function refresh() {
    const res = await fetch(`/raw/${encPath}`);
    if (!res.ok) {
      showMissing();
      return;
    }
    const html = await res.text();
    const content = document.getElementById('content');
    content.innerHTML = html; // 本文だけ差し替えるのでスクロール位置は保たれる
    await renderMermaidBlocks(content);
  }

  const es = new EventSource('/events');
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (mode === 'index') {
      if (data.event === 'add' || data.event === 'unlink') location.reload();
      return;
    }
    if (data.path !== current) return;
    if (data.event === 'unlink') showMissing();
    else refresh();
  };

  renderMermaidBlocks(document);
})();
