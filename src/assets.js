import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function resolveMermaidDist() {
  try {
    return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
  } catch {
    return fileURLToPath(new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url));
  }
}

export const MIME = {
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
