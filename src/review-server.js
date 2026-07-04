import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicDir, resolveMermaidDist, MIME } from './assets.js';
import { renderMarkdown, buildReviewPage } from './render.js';

const ASSETS = {
  'review.js': { file: path.join(publicDir, 'review.js'), type: 'text/javascript; charset=utf-8' },
  'review.css': { file: path.join(publicDir, 'review.css'), type: 'text/css; charset=utf-8' },
  'style.css': { file: path.join(publicDir, 'style.css'), type: 'text/css; charset=utf-8' },
  'mermaid.min.js': { file: resolveMermaidDist(), type: 'text/javascript; charset=utf-8' },
};

const DECISIONS = new Set(['approve', 'comments', 'dismiss']);
const MAX_BODY = 1_000_000;

export function createReviewServer({ filePath, displayPath = filePath }) {
  const absFile = path.resolve(filePath);
  const root = path.dirname(absFile);
  // スナップショット: 起動時に 1 回だけ読む。以降ファイルが変わっても表示は不変。
  const page = buildReviewPage({
    title: path.basename(absFile),
    contentHtml: renderMarkdown(readFileSync(absFile, 'utf8')),
    filePath: displayPath,
  });

  let resolveDecision;
  let decided = false;
  const decision = new Promise((resolve) => {
    resolveDecision = resolve;
  });

  function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  }

  function safeResolve(relPath) {
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  async function handleDecision(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) return send(res, 413, 'Payload too large');
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return send(res, 400, 'Bad JSON');
    }
    if (!payload || !DECISIONS.has(payload.decision)) return send(res, 400, 'Bad decision');
    // 先勝ち: 最初の決定で確定。承認直後に届く pagehide の dismiss は 409 で無視される。
    if (decided) return send(res, 409, 'Already decided');
    decided = true;
    const comments = Array.isArray(payload.comments)
      ? payload.comments.map((c) => ({
          quote: String(c?.quote ?? ''),
          section: String(c?.section ?? ''),
          text: String(c?.text ?? ''),
        }))
      : [];
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    resolveDecision({ decision: payload.decision, comments });
  }

  async function handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (pathname.includes('..')) return send(res, 400, 'Bad path');

    if (req.method === 'POST' && pathname === '/api/decision') return handleDecision(req, res);

    if (pathname === '/') return send(res, 200, page, 'text/html; charset=utf-8');

    if (pathname.startsWith('/assets/')) {
      const asset = ASSETS[pathname.slice('/assets/'.length)];
      if (!asset) return send(res, 404, 'Not Found');
      try {
        return send(res, 200, await readFile(asset.file), asset.type);
      } catch {
        return send(res, 404, 'Not Found');
      }
    }

    // md 内の相対パス画像などの静的配信 (対象ファイルのディレクトリ起点)
    const abs = safeResolve(pathname.slice(1));
    if (!abs) return send(res, 400, 'Bad path');
    try {
      const buf = await readFile(abs);
      return send(res, 200, buf, MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    } catch {
      return send(res, 404, 'Not Found');
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, `Internal Server Error: ${err.message}`);
    });
  });

  function close() {
    server.closeAllConnections?.();
    server.close();
  }

  return { server, decision, close };
}
