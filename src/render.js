import MarkdownIt from 'markdown-it';

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const md = new MarkdownIt({ html: true, linkify: true });

const defaultFence = md.renderer.rules.fence;

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    return `<pre class="mermaid">${escapeHtml(token.content)}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export function renderMarkdown(mdText) {
  return md.render(mdText);
}

export function buildMarkdownPage({ title, contentHtml, relPath, backHref }) {
  const header = backHref
    ? `<header class="dp-header"><a href="${escapeHtml(backHref)}">← 一覧に戻る</a></header>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-dp-mode="md" data-dp-path="${escapeHtml(relPath)}">
${header}<main id="content">
${contentHtml}
</main>
<script src="/assets/mermaid.min.js"></script>
<script src="/assets/client.js"></script>
</body>
</html>`;
}

function encodeRelPath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

export function buildIndexPage({ title, files }) {
  const items = files
    .map((f) => `<li><a href="/view/${encodeRelPath(f)}">${escapeHtml(f)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-dp-mode="index" data-dp-path="">
<main id="content">
<h1>${escapeHtml(title)}</h1>
<ul class="dp-file-list">
${items}
</ul>
</main>
<script src="/assets/client.js"></script>
</body>
</html>`;
}

export function injectReloadScript(html, relPath, backHref) {
  const pathLiteral = JSON.stringify(relPath).replaceAll('<', '\\u003c');
  const script = `<script>(()=>{const p=${pathLiteral};const es=new EventSource("/events");es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.path===p)location.reload();};})();</script>`;
  // ユーザー HTML の CSS に依存しないよう、ヘッダーはインラインスタイルの固定バーで重ねる
  const header = backHref
    ? `<div id="dp-back-header" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;box-sizing:border-box;display:flex;align-items:center;height:32px;padding:0 12px;background:rgba(127,127,127,.18);backdrop-filter:blur(6px);font:13px/1 -apple-system,'Hiragino Sans',sans-serif;"><a href="${escapeHtml(backHref)}" style="color:inherit;text-decoration:none;">← 一覧に戻る</a></div>`
    : '';
  const injection = header + script;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + injection;
  return html.slice(0, idx) + injection + html.slice(idx);
}
