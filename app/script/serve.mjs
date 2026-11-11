#!/usr/bin/env node
/**
 * app/script/serve.mjs — 仓库根静态服务器（C2-06 剧本表格）。
 *
 *   node app/script/serve.mjs            # http://127.0.0.1:5183/app/script/
 *   node app/script/serve.mjs --port 5190
 *
 * 零依赖，只做三件事：静态文件、目录 index、路径穿越防护。
 * app/versions/serve.mjs 复用这里导出的 startStaticServer()。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const DEFAULT_PORT = 5183;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const contentType = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** 解析并限制在 root 内；返回 null 表示越界或非法编码。 */
export function resolveInside(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // 非法 %xx
  }
  const full = path.resolve(root, '.' + path.posix.normalize(decoded));
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * @param {{root?:string, redirect?:string, noCache?:boolean}} opts
 * @returns {http.Server}
 */
export function createStaticServer({ root = REPO_ROOT, redirect = '/app/script/', noCache = true } = {}) {
  const base = path.resolve(root);

  return http.createServer((req, res) => {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed\n');
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request\n');
      return;
    }

    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { Location: redirect });
      res.end();
      return;
    }

    const file = resolveInside(base, pathname);
    if (!file) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden\n');
      return;
    }

    fs.stat(file, (err, stat) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}\n`);
        return;
      }
      let target = file;
      if (stat.isDirectory()) {
        target = path.join(file, 'index.html');
        if (!fs.existsSync(target)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`404 Not Found: ${pathname}\n`);
          return;
        }
      }
      const headers = {
        'Content-Type': contentType(target),
        'Cache-Control': noCache ? 'no-store' : 'public, max-age=60',
      };
      if (method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      const stream = fs.createReadStream(target);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error\n');
      });
      res.writeHead(200, headers);
      stream.pipe(res);
    });
  });
}

/**
 * 启动并打印地址。返回 server（测试里可直接 close）。
 * @param {{root?:string, port?:number, host?:string, redirect?:string, quiet?:boolean}} opts
 */
export function startStaticServer({ root = REPO_ROOT, port = DEFAULT_PORT, host = '127.0.0.1', redirect = '/app/script/', quiet = false } = {}) {
  const server = createStaticServer({ root, redirect });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[serve] 端口 ${port} 已被占用；用 --port 换一个。`);
    } else {
      console.error(`[serve] ${err.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    if (!quiet) {
      const addr = server.address();
      console.log(`[serve] root   ${path.resolve(root)}`);
      console.log(`[serve] listen http://${host}:${addr.port}${redirect}`);
    }
  });
  return server;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[k.slice(2)] = true;
    else { args[k.slice(2)] = next; i++; }
  }
  return args;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node app/script/serve.mjs [--port ${DEFAULT_PORT}] [--host 127.0.0.1]`);
    process.exit(0);
  }
  const port = Number(args.port || process.env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[serve] 非法端口：${args.port}`);
    process.exit(1);
  }
  startStaticServer({ port, host: String(args.host || '127.0.0.1'), redirect: '/app/script/' });
}
