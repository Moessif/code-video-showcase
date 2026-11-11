#!/usr/bin/env node
/**
 * serve.mjs — 评审页的零依赖静态服务器（复用 app/canvas 的 createStaticServer）。
 *
 *   node app/review/serve.mjs                 # http://127.0.0.1:5185/app/review/
 *   node app/review/serve.mjs --port 5195
 *   node app/review/serve.mjs --root .
 *
 * 只读 GET/HEAD；默认服务仓库根，因此评审页可直接读取
 * /out/api/<job>/project.spec.json 与 /out/api/<job>/master.mp4。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../canvas/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_PORT = 5185;

export function createReviewServer(root = DEFAULT_ROOT) {
  return createStaticServer(root);
}

export function startReviewServer({ root = DEFAULT_ROOT, port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const server = createReviewServer(root);
  return new Promise((resolve, reject) => {
    const onError = (e) => reject(e);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://${host}:${actual}` });
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
    console.log('Usage: node app/review/serve.mjs [--port 5185] [--root <dir>]');
    process.exit(0);
  }
  const port = Number.isFinite(args.port) ? args.port : DEFAULT_PORT;
  const root = path.resolve(args.root || DEFAULT_ROOT);
  startReviewServer({ root, port })
    .then(({ server, url }) => {
      console.log(`[review] root: ${root}`);
      console.log(`[review] ${url}/app/review/`);
      const stop = () => server.close(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error('[review] failed:', (e && e.message) || e);
      process.exit(1);
    });
}
