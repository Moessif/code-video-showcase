#!/usr/bin/env node
/**
 * serve.mjs — 编辑画布的零依赖静态服务器（服务仓库根目录）。
 *
 *   node app/canvas/serve.mjs                 # http://127.0.0.1:5182/app/canvas/
 *   node app/canvas/serve.mjs --port 5190
 *   node app/canvas/serve.mjs --root .
 *
 * 只读 GET/HEAD，不写文件、不联网、不依赖任何 npm 包。
 * 以 `import` 方式使用时不会自动监听（供 scripts/test-inspect.mjs 复用 createStaticServer）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_PORT = 5182;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

/**
 * @param {string} [root] 静态根目录，默认仓库根
 * @returns {http.Server}
 */
export function createStaticServer(root = DEFAULT_ROOT) {
  const ROOT = path.resolve(root);

  return http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end('method not allowed');
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }

      const hadSlash = pathname.endsWith('/');
      if (hadSlash) pathname += 'index.html';

      let file = path.resolve(ROOT, '.' + pathname);
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }

      fs.stat(file, (err, st) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404'); return; }
        if (st.isDirectory()) {
          if (!hadSlash) {
            res.writeHead(301, { Location: pathname + '/' }).end();
            return;
          }
          res.writeHead(404).end('404');
          return;
        }
        if (!st.isFile()) { res.writeHead(404).end('404'); return; }
        const headers = {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        };
        res.writeHead(200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
      });
    } catch {
      res.writeHead(400).end('bad request');
    }
  });
}

/**
 * 监听并返回 { server, port, url }。port=0 时用系统分配的端口（测试用）。
 */
export function startServer({ root = DEFAULT_ROOT, port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const server = createStaticServer(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({ server, port: server.address().port, url: `http://${host}:${server.address().port}` });
    });
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = path.resolve(fileURLToPath(import.meta.url));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
})();

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node app/canvas/serve.mjs [--port 5182] [--root <dir>]');
    process.exit(0);
  }
  const port = Number.isFinite(args.port) ? args.port : DEFAULT_PORT;
  startServer({ root: args.root || DEFAULT_ROOT, port })
    .then(({ server, port: p, url }) => {
      console.log(`[canvas] root: ${path.resolve(args.root || DEFAULT_ROOT)}`);
      console.log(`[canvas] ${url}/app/canvas/`);
      const stop = () => server.close(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => { console.error('[canvas] failed:', e && e.message || e); process.exit(1); });
}
