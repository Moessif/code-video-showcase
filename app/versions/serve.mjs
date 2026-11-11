#!/usr/bin/env node
/**
 * app/versions/serve.mjs — C2-07 版本树页面。
 *
 *   node app/versions/serve.mjs           # http://127.0.0.1:5184/app/versions/
 *   node app/versions/serve.mjs --port 5194
 *
 * 静态服务逻辑与 app/script/serve.mjs 共用（同一份路径穿越防护 / MIME 表）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer, REPO_ROOT } from '../script/serve.mjs';

export const DEFAULT_PORT = 5184;

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
    console.log(`Usage: node app/versions/serve.mjs [--port ${DEFAULT_PORT}] [--host 127.0.0.1]`);
    process.exit(0);
  }
  const port = Number(args.port || process.env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[serve] 非法端口：${args.port}`);
    process.exit(1);
  }
  startStaticServer({ root: REPO_ROOT, port, host: String(args.host || '127.0.0.1'), redirect: '/app/versions/' });
}
