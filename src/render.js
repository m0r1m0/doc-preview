import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// 言語指定があり hljs が知っていればサーバー側でハイライト。
// 未知の言語や指定なしはエスケープのみのプレーンなコードブロックにする。
// (ブラウザ側 JS は不要 = オフラインでも色が付く)
function highlightCode(str, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      return `<pre><code class="hljs language-${lang}">${out}</code></pre>`;
    } catch {
      // fall through to plain
    }
  }
  return `<pre><code class="hljs">${escapeHtml(str)}</code></pre>`;
}

const md = new MarkdownIt({ html: true, linkify: true, highlight: highlightCode });
md.use(taskLists);

// 見出しに GitHub 風スラッグの id を付与する core ruler (自作、依存追加なし)。
// ToC (client.js) のアンカー先および #見出し 直リンクに使う。
const SLUG_PUNCT_RE = /[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g;

function slugify(text) {
  return text.trim().toLowerCase().replace(SLUG_PUNCT_RE, '').replace(/\s+/g, '-');
}

md.core.ruler.push('dp_heading_ids', (state) => {
  const used = new Set();
  let n = 0;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    n++;
    const inline = tokens[i + 1];
    const text = inline?.type === 'inline'
      ? inline.children
          .filter((t) => t.type === 'text' || t.type === 'code_inline')
          .map((t) => t.content)
          .join('')
      : '';
    const base = slugify(text) || `section-${n}`;
    let slug = base;
    for (let k = 2; used.has(slug); k++) slug = `${base}-${k}`;
    used.add(slug);
    tokens[i].attrSet('id', slug);
  }
});

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

export function injectReloadScript(html, relPath) {
  const pathLiteral = JSON.stringify(relPath).replaceAll('<', '\\u003c');
  const script = `<script>(()=>{const p=${pathLiteral};const es=new EventSource("/events");es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.path===p)location.reload();};})();</script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + script;
  return html.slice(0, idx) + script + html.slice(idx);
}

export function buildReviewPage({ title, contentHtml, filePath }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>レビュー: ${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/assets/review.css">
</head>
<body data-dp-mode="review" data-dp-file="${escapeHtml(filePath)}">
<header class="dp-review-bar">
<span class="dp-review-file">${escapeHtml(filePath)}</span>
<span id="dp-review-status" class="dp-review-status"></span>
<button type="button" id="dp-btn-submit" disabled>コメントを送信 (0)</button>
<button type="button" id="dp-btn-approve">✓ 承認</button>
</header>
<div class="dp-review-layout">
<main id="content">
${contentHtml}
</main>
<aside id="dp-comment-list"></aside>
</div>
<script src="/assets/mermaid.min.js"></script>
<script src="/assets/review.js"></script>
</body>
</html>`;
}
