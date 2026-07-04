/* global mermaid */
(() => {
  const content = document.getElementById('content');
  const listEl = document.getElementById('dp-comment-list');
  const btnApprove = document.getElementById('dp-btn-approve');
  const btnSubmit = document.getElementById('dp-btn-submit');
  const statusEl = document.getElementById('dp-review-status');

  const comments = []; // { id, quote, section, text, marks: [Element] }
  let nextId = 1;
  let finished = false;

  // --- mermaid (client.js と同じ方式でクライアント側描画) ---
  if (typeof mermaid !== 'undefined') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
    });
    let seq = 0;
    (async () => {
      for (const block of content.querySelectorAll('pre.mermaid')) {
        const code = block.textContent;
        const id = `dp-mermaid-${seq++}`;
        try {
          const { svg } = await mermaid.render(id, code);
          const div = document.createElement('div');
          div.className = 'mermaid-rendered';
          div.innerHTML = svg;
          block.replaceWith(div);
        } catch (err) {
          const pre = document.createElement('pre');
          pre.className = 'mermaid-error';
          pre.textContent = `mermaid エラー: ${err.message}\n\n${code}`;
          block.replaceWith(pre);
          document.getElementById('d' + id)?.remove();
        }
      }
    })();
  }

  // --- 選択 → フローティング「コメント」ボタン ---
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'dp-comment-fab';
  fab.textContent = 'コメント';
  fab.hidden = true;
  document.body.appendChild(fab);

  let pendingRange = null;

  document.addEventListener('mouseup', (e) => {
    if (finished || fab.contains(e.target)) return;
    // mouseup 直後は selection が未確定のことがあるので次のタスクで判定する
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return hideFab();
      const range = sel.getRangeAt(0);
      if (!content.contains(range.commonAncestorContainer)) return hideFab();
      if (!range.toString().trim()) return hideFab();
      pendingRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      fab.style.top = `${window.scrollY + rect.bottom + 6}px`;
      fab.style.left = `${window.scrollX + rect.left}px`;
      fab.hidden = false;
    }, 0);
  });

  function hideFab() {
    fab.hidden = true;
  }

  fab.addEventListener('click', () => {
    hideFab();
    if (pendingRange) openEditor(pendingRange);
  });

  // --- コメント入力ポップオーバー ---
  const editor = document.createElement('div');
  editor.id = 'dp-comment-editor';
  editor.hidden = true;
  editor.innerHTML =
    '<textarea rows="3" placeholder="コメントを入力"></textarea>' +
    '<div class="dp-editor-actions">' +
    '<button type="button" class="dp-save">保存</button>' +
    '<button type="button" class="dp-cancel">キャンセル</button>' +
    '</div>';
  document.body.appendChild(editor);
  const textarea = editor.querySelector('textarea');
  let editorRange = null;

  function openEditor(range) {
    editorRange = range;
    const rect = range.getBoundingClientRect();
    editor.style.top = `${window.scrollY + rect.bottom + 6}px`;
    editor.style.left = `${window.scrollX + rect.left}px`;
    editor.hidden = false;
    textarea.value = '';
    textarea.focus();
  }

  editor.querySelector('.dp-cancel').addEventListener('click', () => {
    editor.hidden = true;
  });
  editor.querySelector('.dp-save').addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text || !editorRange) return;
    addComment(editorRange, text);
    editor.hidden = true;
    window.getSelection()?.removeAllRanges();
  });

  // --- コメントの追加・削除 ---
  function nearestHeading(range) {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    let best = null;
    for (const h of content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      // DOCUMENT_POSITION_FOLLOWING = node が h より後ろ → h は選択位置より前の見出し
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
    }
    return best ? `${'#'.repeat(Number(best.tagName[1]))} ${best.textContent.trim()}` : '';
  }

  // 選択 Range に交差するテキストノードを個別に <mark> で包む。
  // ノード単位に閉じた Range にしてから surroundContents するので、
  // 要素境界をまたぐ選択でも DOM が壊れない。
  function highlightRange(range, id) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (range.intersectsNode(n) && n.data.length > 0) nodes.push(n);
    }
    const marks = [];
    for (const node of nodes) {
      const r = document.createRange();
      r.selectNodeContents(node);
      if (node === range.startContainer) r.setStart(node, range.startOffset);
      if (node === range.endContainer) r.setEnd(node, range.endOffset);
      if (r.collapsed || !r.toString()) continue;
      const mark = document.createElement('mark');
      mark.className = 'dp-annotation';
      mark.dataset.commentId = String(id);
      try {
        r.surroundContents(mark);
        marks.push(mark);
      } catch {
        // 特殊なノード構造で失敗してもコメント自体は成立させる
      }
    }
    return marks;
  }

  function addComment(range, text) {
    const id = nextId++;
    const quote = range.toString();
    const section = nearestHeading(range);
    const marks = highlightRange(range, id);
    comments.push({ id, quote, section, text, marks });
    renderList();
  }

  function removeComment(id) {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return;
    for (const mark of comments[idx].marks) {
      mark.replaceWith(...mark.childNodes);
    }
    content.normalize();
    comments.splice(idx, 1);
    renderList();
  }

  function renderList() {
    listEl.textContent = '';
    for (const c of comments) {
      const card = document.createElement('div');
      card.className = 'dp-comment-card';
      const quote = document.createElement('blockquote');
      quote.textContent = c.quote.length > 120 ? `${c.quote.slice(0, 120)}…` : c.quote;
      const body = document.createElement('p');
      body.textContent = c.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '削除';
      del.addEventListener('click', () => removeComment(c.id));
      card.append(quote, body, del);
      listEl.appendChild(card);
    }
    btnSubmit.textContent = `コメントを送信 (${comments.length})`;
    btnSubmit.disabled = comments.length === 0;
  }

  // --- 決定の送信 ---
  async function sendDecision(payload) {
    if (finished) return;
    finished = true;
    btnApprove.disabled = true;
    btnSubmit.disabled = true;
    try {
      await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      statusEl.textContent = '送信しました。このタブは閉じてください。';
      document.body.classList.add('dp-review-done');
    } catch {
      finished = false;
      btnApprove.disabled = false;
      renderList();
      statusEl.textContent = '送信に失敗しました。もう一度お試しください。';
    }
  }

  btnApprove.addEventListener('click', () => sendDecision({ decision: 'approve' }));
  btnSubmit.addEventListener('click', () =>
    sendDecision({
      decision: 'comments',
      comments: comments.map(({ quote, section, text }) => ({ quote, section, text })),
    })
  );

  // タブを閉じた / 離れた → dismissed (サーバー側は先勝ちなので送信後でも無害)
  window.addEventListener('pagehide', () => {
    if (!finished) navigator.sendBeacon('/api/decision', JSON.stringify({ decision: 'dismiss' }));
  });

  renderList();
})();
