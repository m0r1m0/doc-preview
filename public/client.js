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

  // ---- ToC サイドバー (md モードのみ) ----
  const TOC_COLLAPSED_KEY = 'dp-toc-collapsed';
  let tocHeadings = [];

  function setTocCollapsed(collapsed, { save = true } = {}) {
    body.classList.toggle('dp-toc-collapsed', collapsed);
    if (save) localStorage.setItem(TOC_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function updateTocActive() {
    if (tocHeadings.length === 0) return;
    let active = tocHeadings[0];
    for (const h of tocHeadings) {
      if (h.getBoundingClientRect().top <= 80) active = h;
      else break;
    }
    for (const a of document.querySelectorAll('#dp-toc a')) {
      a.classList.toggle('active', a.dataset.dpTarget === active.id);
    }
  }

  function buildToc() {
    document.getElementById('dp-toc')?.remove();
    document.getElementById('dp-toc-reopen')?.remove();
    body.classList.remove('dp-has-toc', 'dp-toc-collapsed');
    tocHeadings = mode === 'md'
      ? [...document.querySelectorAll('#content h1[id], #content h2[id], #content h3[id]')]
      : [];
    if (tocHeadings.length === 0) return;

    const nav = document.createElement('nav');
    nav.id = 'dp-toc';
    nav.setAttribute('aria-label', '目次');
    const head = document.createElement('div');
    head.className = 'dp-toc-head';
    const label = document.createElement('span');
    label.textContent = '目次';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '⟨';
    closeBtn.title = '目次を閉じる';
    closeBtn.addEventListener('click', () => setTocCollapsed(true));
    head.append(label, closeBtn);

    const list = document.createElement('ul');
    for (const h of tocHeadings) {
      const li = document.createElement('li');
      li.className = `dp-toc-${h.tagName.toLowerCase()}`;
      const a = document.createElement('a');
      a.href = `#${encodeURIComponent(h.id)}`;
      a.dataset.dpTarget = h.id;
      a.textContent = h.textContent;
      li.appendChild(a);
      list.appendChild(li);
    }
    nav.append(head, list);

    const reopen = document.createElement('button');
    reopen.id = 'dp-toc-reopen';
    reopen.type = 'button';
    reopen.textContent = '☰ 目次';
    reopen.title = '目次を開く';
    reopen.addEventListener('click', () => setTocCollapsed(false));

    body.append(nav, reopen);
    body.classList.add('dp-has-toc');
    setTocCollapsed(localStorage.getItem(TOC_COLLAPSED_KEY) === '1', { save: false });
    updateTocActive();
  }

  function showMissing() {
    document.getElementById('content').innerHTML =
      '<p class="dp-missing">ファイルが見つかりません</p>';
    buildToc(); // 見出しが消えたので ToC も消える
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
    buildToc(); // 見出し構成が変わっている可能性があるので再構築
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
  buildToc();

  // scroll spy: 現在セクションの ToC 項目をハイライト
  document.addEventListener('scroll', updateTocActive, { passive: true });
})();
