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

export function buildMarkdownPage({ title, contentHtml, relPath }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-dp-mode="md" data-dp-path="${escapeHtml(relPath)}">
<main id="content">
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

export function injectReloadScript(html, relPath) {
  const script = `<script>(()=>{const p=${JSON.stringify(relPath)};const es=new EventSource("/events");es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.path===p)location.reload();};})();</script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + script;
  return html.slice(0, idx) + script + html.slice(idx);
}
