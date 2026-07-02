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
