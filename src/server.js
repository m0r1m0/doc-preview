import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderMarkdown,
  buildMarkdownPage,
  buildIndexPage,
  injectReloadScript,
  escapeHtml,
} from './render.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

function resolveMermaidDist() {
  try {
    return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
  } catch {
    return fileURLToPath(new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url));
  }
}

const ASSETS = {
  'client.js': { file: path.join(publicDir, 'client.js'), type: 'text/javascript; charset=utf-8' },
  'style.css': { file: path.join(publicDir, 'style.css'), type: 'text/css; charset=utf-8' },
  'mermaid.min.js': { file: resolveMermaidDist(), type: 'text/javascript; charset=utf-8' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const DOC_EXTS = ['.md', '.html', '.htm'];

async function listDocFiles(root, dir = root) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listDocFiles(root, abs)));
    else if (DOC_EXTS.includes(path.extname(e.name).toLowerCase()))
      out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

export function createPreviewServer({ rootDir, entry = '', mode }) {
  const root = path.resolve(rootDir);
  const clients = new Set();

  function broadcast(payload) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function safeResolve(relPath) {
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  }

  function sendMissingPage(res, relPath) {
    send(
      res,
      404,
      buildMarkdownPage({
        title: relPath,
        contentHtml: `<p class="dp-missing">ファイルが見つかりません: ${escapeHtml(relPath)}</p>`,
        relPath,
      }),
      'text/html; charset=utf-8'
    );
  }

  async function serveStatic(res, abs) {
    try {
      const buf = await readFile(abs);
      const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
      send(res, 200, buf, type);
    } catch {
      send(res, 404, 'Not Found');
    }
  }

  async function servePreview(res, relPath) {
    const abs = safeResolve(relPath);
    if (!abs) return send(res, 400, 'Bad path');
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.md') {
      let text;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        return sendMissingPage(res, relPath);
      }
      return send(
        res,
        200,
        buildMarkdownPage({ title: path.basename(abs), contentHtml: renderMarkdown(text), relPath }),
        'text/html; charset=utf-8'
      );
    }
    if (ext === '.html' || ext === '.htm') {
      let text;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        return sendMissingPage(res, relPath);
      }
      return send(res, 200, injectReloadScript(text, relPath), 'text/html; charset=utf-8');
    }
    return serveStatic(res, abs);
  }

  async function serveRaw(res, relPath) {
    const abs = safeResolve(relPath);
    if (!abs) return send(res, 400, 'Bad path');
    const ext = path.extname(abs).toLowerCase();
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      return send(res, 404, 'Not Found');
    }
    if (ext === '.md') return send(res, 200, renderMarkdown(text), 'text/html; charset=utf-8');
    return send(res, 200, injectReloadScript(text, relPath), 'text/html; charset=utf-8');
  }

  function serveEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (pathname.includes('..')) return send(res, 400, 'Bad path');

    if (pathname === '/events') return serveEvents(req, res);

    if (pathname.startsWith('/assets/')) {
      const asset = ASSETS[pathname.slice('/assets/'.length)];
      if (!asset) return send(res, 404, 'Not Found');
      try {
        return send(res, 200, await readFile(asset.file), asset.type);
      } catch {
        return send(res, 404, 'Not Found');
      }
    }

    if (pathname === '/') {
      if (mode === 'file') return servePreview(res, entry);
      const files = await listDocFiles(root);
      return send(
        res,
        200,
        buildIndexPage({ title: path.basename(root), files }),
        'text/html; charset=utf-8'
      );
    }

    if (pathname.startsWith('/view/')) return servePreview(res, pathname.slice('/view/'.length));
    if (pathname.startsWith('/raw/')) return serveRaw(res, pathname.slice('/raw/'.length));

    // それ以外は起点ディレクトリ配下の静的配信 (md 内の相対パス画像など)
    const abs = safeResolve(pathname.slice(1));
    if (!abs) return send(res, 400, 'Bad path');
    return serveStatic(res, abs);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, `Internal Server Error: ${err.message}`);
    });
  });

  function close() {
    for (const res of clients) res.end();
    clients.clear();
    server.closeAllConnections?.();
    server.close();
  }

  return { server, broadcast, close };
}

export function startServer(server, { port = 3000, host = '127.0.0.1', maxTries = 10 } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryListen = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && ++tries < maxTries) tryListen(p + 1);
        else reject(err);
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        server.on('error', (err) => {
          console.error(`server error: ${err.message}`);
        });
        resolve(server.address().port);
      });
    };
    tryListen(port);
  });
}
