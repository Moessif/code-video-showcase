#!/usr/bin/env node
/**
 * api.mjs — 零依赖本地编译 API：spec → job → 成片。
 *
 *   node server/api.mjs                       # http://127.0.0.1:5190
 *   node server/api.mjs --port 5191
 *   node server/api.mjs --concurrency 2
 *
 * 契约（C7-03）：
 *   POST   /jobs                    spec v1 JSON（≤1MB）→ 202 {id,status:'queued'}
 *   GET    /jobs/<id>               {id,status,exitCode,startedAt,finishedAt,stats,logTail}
 *   GET    /jobs/<id>/master.mp4    流式返回（支持 Range）；未完成 409
 *   DELETE /jobs/<id>               排队中移除 / 运行中 kill → cancelled
 *   GET    /health                  {ok:true,queue,concurrency}
 *
 * 仅绑定 127.0.0.1；job id 白名单 ^[a-z0-9-]+$；所有响应 JSON（mp4 除外）。
 * 以 import 方式使用时不会自动监听（供 server/test-api.mjs 复用 startServer）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPlanFromSpec } from '../templates/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..');
export const DEFAULT_PORT = 5190;
export const MAX_BODY_BYTES = 1024 * 1024;
export const ID_RE = /^[a-z0-9-]+$/;
const ID_MAX = 128;
const LOG_TAIL_BYTES = 16 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

// ── 子进程清理（进程退出兜底） ───────────────────────────────────────────────

/** @type {Set<import('node:child_process').ChildProcess>} */
const LIVE_CHILDREN = new Set();
let exitHookInstalled = false;

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch { /* fall through */ }
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function trackChild(child) {
  LIVE_CHILDREN.add(child);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const c of LIVE_CHILDREN) killTree(c);
      LIVE_CHILDREN.clear();
    });
  }
}

// ── 小工具 ──────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message, code = 'E_HTTP') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function sendJson(res, status, body, extra = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...CORS_HEADERS,
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new HttpError(413, `request body exceeds ${limit} bytes`, 'E_BODY_TOO_LARGE'));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        req.resume(); // 继续排空，让 413 响应能写回去
        reject(new HttpError(413, `request body exceeds ${limit} bytes`, 'E_BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

function readLogTail(file, maxBytes = LOG_TAIL_BYTES) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return '';
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, st.size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '') {
    if (m[2] === '') return null;
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { unsatisfiable: true };
    if (end >= size) end = size - 1;
  }
  if (!Number.isFinite(size) || size <= 0) return { unsatisfiable: true };
  if (start < 0 || start >= size || start > end) return { unsatisfiable: true };
  return { start, end };
}

// ── job 队列 ────────────────────────────────────────────────────────────────

function createQueue({ concurrency, onRun, onError }) {
  const pending = [];
  const active = new Set();
  const api = {
    concurrency,
    pending,
    active,
    push(job) {
      pending.push(job);
      api.pump();
    },
    remove(job) {
      const i = pending.indexOf(job);
      if (i < 0) return false;
      pending.splice(i, 1);
      return true;
    },
    counts() {
      return { queued: pending.length, running: active.size };
    },
    pump() {
      while (active.size < concurrency && pending.length) {
        const job = pending.shift();
        if (!job || job.status !== 'queued') continue;
        active.add(job);
        Promise.resolve()
          .then(() => onRun(job))
          .catch((e) => onError(job, e))
          .finally(() => {
            active.delete(job);
            api.pump();
          });
      }
    },
  };
  return api;
}

// ── server ──────────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string} [opts.root]        仓库根（页面/脚本解析基准）
 * @param {string} [opts.outDir]      job 目录，默认 <root>/out/api
 * @param {number} [opts.concurrency] 并发编译数，默认 1
 */
export function createJobServer(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const jobsDir = path.resolve(opts.outDir || path.join(root, 'out', 'api'));
  const concurrency = Math.max(1, Math.min(16, Math.floor(Number(opts.concurrency)) || 1));
  const compileScript = path.join(root, 'scripts', 'compile.mjs');

  /** @type {Map<string, any>} */
  const jobs = new Map();
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();

  function persist(job) {
    try {
      fs.mkdirSync(job.dir, { recursive: true });
      const meta = {
        id: job.id,
        status: job.status,
        exitCode: job.exitCode ?? null,
        createdAt: job.createdAt || null,
        startedAt: job.startedAt || null,
        finishedAt: job.finishedAt || null,
        error: job.error || null,
        root,
        outDir: path.relative(root, job.dir).split(path.sep).join('/'),
      };
      fs.writeFileSync(path.join(job.dir, 'job.json'), JSON.stringify(meta, null, 2) + '\n');
    } catch { /* 状态持久化是 best-effort，不影响任务执行 */ }
  }

  function readStats(job) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(job.dir, 'plan.json'), 'utf8'));
      const st = plan.stats || {};
      return {
        duration: st.duration ?? null,
        frames: st.frames ?? null,
        segments: st.segments ?? null,
        fps: st.fps ?? null,
      };
    } catch {
      return null;
    }
  }

  function jobView(job) {
    return {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode ?? null,
      createdAt: job.createdAt || null,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      stats: readStats(job),
      logTail: readLogTail(path.join(job.dir, 'build.log')),
      error: job.error || null,
    };
  }

  function loadJobFromDisk(id) {
    if (!ID_RE.test(id) || id.length > ID_MAX) return null;
    const dir = path.join(jobsDir, id);
    if (!isInside(jobsDir, dir)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
      if (!meta || meta.id !== id) return null;
      return { ...meta, dir, child: null, cancelRequested: false };
    } catch {
      return null;
    }
  }

  function loadPersistedJobs() {
    let entries = [];
    try { entries = fs.readdirSync(jobsDir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (!ent.isDirectory() || !ID_RE.test(ent.name)) continue;
      const job = loadJobFromDisk(ent.name);
      if (!job) continue;
      // 上一个进程留下的 queued/running 已经不可能继续执行：如实标记失败
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.exitCode = job.exitCode ?? null;
        job.finishedAt = job.finishedAt || nowIso();
        job.error = 'server restarted before the job finished';
        persist(job);
      }
      jobs.set(job.id, job);
    }
  }

  function newJobId(spec) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    for (let i = 0; i < 20; i++) {
      const hash = crypto.createHash('sha256')
        .update(JSON.stringify(spec))
        .update(String(Date.now()))
        .update(crypto.randomBytes(8))
        .digest('hex')
        .slice(0, 6);
      const id = `j-${ts}-${hash}`;
      if (!jobs.has(id) && !fs.existsSync(path.join(jobsDir, id))) return id;
    }
    throw new Error('could not allocate a unique job id');
  }

  function validCompileScript() {
    try { return fs.statSync(compileScript).isFile(); } catch { return false; }
  }

  function runJob(job) {
    return new Promise((resolve) => {
      job.status = 'running';
      job.startedAt = nowIso();
      job.finishedAt = null;
      job.exitCode = null;
      job.error = null;
      persist(job);

      if (!validCompileScript()) {
        job.status = 'failed';
        job.finishedAt = nowIso();
        job.error = `compile script not found: ${compileScript}`;
        persist(job);
        resolve();
        return;
      }

      const logPath = path.join(job.dir, 'build.log');
      let logStream;
      try {
        logStream = fs.createWriteStream(logPath, { flags: 'w' });
      } catch (e) {
        job.status = 'failed';
        job.finishedAt = nowIso();
        job.error = `cannot open build.log: ${e.message}`;
        persist(job);
        resolve();
        return;
      }
      logStream.on('error', () => { /* 日志写失败不阻断编译 */ });

      const relSpec = path.relative(root, path.join(job.dir, 'project.spec.json')).split(path.sep).join('/');
      const relOut = path.relative(root, job.dir).split(path.sep).join('/');
      const args = [
        'scripts/compile.mjs',
        '--spec', relSpec,
        '--root', root,
        '--outdir', relOut,
        '--no-qa',
        '--concurrency', '2',
      ];
      job.command = `${process.execPath} ${args.join(' ')}`;

      let child;
      try {
        child = spawn(process.execPath, args, {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });
      } catch (e) {
        logStream.end();
        job.status = 'failed';
        job.finishedAt = nowIso();
        job.error = `spawn failed: ${e.message}`;
        persist(job);
        resolve();
        return;
      }

      job.child = child;
      children.add(child);
      trackChild(child);

      child.stdout.on('data', (d) => logStream.write(d));
      child.stderr.on('data', (d) => logStream.write(d));

      let settled = false;
      const finish = (code, spawnError) => {
        if (settled) return;
        settled = true;
        children.delete(child);
        job.child = null;
        job.exitCode = code === undefined ? null : code;
        job.finishedAt = nowIso();
        if (spawnError && !job.error) job.error = String(spawnError.message || spawnError);
        job.status = job.cancelRequested ? 'cancelled' : (code === 0 ? 'done' : 'failed');
        if (job.status === 'failed' && !job.error) job.error = `compile exited with code ${code}`;
        if (job.status === 'cancelled') job.error = null;
        logStream.end(() => {
          persist(job);
          resolve();
        });
      };

      child.on('error', (e) => finish(null, e));
      child.on('close', (code) => finish(code));
    });
  }

  function failJob(job, error) {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
    job.status = 'failed';
    job.finishedAt = nowIso();
    job.error = String((error && error.stack) || error);
    persist(job);
  }

  const queue = createQueue({ concurrency, onRun: runJob, onError: failJob });

  function cancelJob(job) {
    if (job.status === 'queued') {
      queue.remove(job);
      job.status = 'cancelled';
      job.finishedAt = nowIso();
      persist(job);
      return;
    }
    if (job.status === 'running') {
      job.cancelRequested = true;
      job.status = 'cancelled';
      job.finishedAt = nowIso();
      persist(job);
      if (job.child) killTree(job.child);
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async function handleJobsCreate(req, res) {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw.toString('utf8') || 'null');
    } catch (e) {
      throw new HttpError(400, `invalid JSON: ${e.message}`, 'E_JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'spec must be a JSON object', 'E_SPEC');
    }

    // 校验与真实编译走同一个编译点（root = 仓库根）
    let built;
    try {
      built = buildPlanFromSpec(body, { root });
    } catch (e) {
      const issues = Array.isArray(e && e.issues) && e.issues.length
        ? e.issues
        : [{ code: (e && e.code) || 'E_SPEC', path: '', message: String((e && e.message) || e), level: 'error' }];
      sendJson(res, 400, { error: 'invalid spec', issues });
      return;
    }

    const id = newJobId(built.spec);
    const dir = path.join(jobsDir, id);
    if (!isInside(jobsDir, dir)) throw new HttpError(400, 'bad job id', 'E_JOB_ID');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.spec.json'), JSON.stringify(built.spec, null, 2) + '\n');

    const job = {
      id,
      dir,
      status: 'queued',
      exitCode: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      error: null,
      child: null,
      cancelRequested: false,
    };
    jobs.set(id, job);
    persist(job);
    queue.push(job);
    sendJson(res, 202, { id, status: 'queued' });
  }

  function getJobOr404(id) {
    const job = jobs.get(id) || loadJobFromDisk(id);
    if (!job) throw new HttpError(404, 'job not found', 'E_NOT_FOUND');
    if (!jobs.has(id)) jobs.set(id, job);
    return job;
  }

  function serveMaster(req, res, job) {
    if (job.status !== 'done') {
      sendJson(res, 409, { error: 'job not finished', id: job.id, status: job.status });
      return;
    }
    const file = path.join(job.dir, 'master.mp4');
    if (!isInside(jobsDir, file)) {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status });
      return;
    }
    let st;
    try { st = fs.statSync(file); } catch {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status });
      return;
    }
    if (!st.isFile()) {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status });
      return;
    }

    const size = st.size;
    const rangeHeader = req.headers.range;
    let status = 200;
    let start = 0;
    let end = size - 1;

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, size);
      if (!parsed || parsed.unsatisfiable) {
        sendJson(res, 416, { error: 'range not satisfiable', size }, { 'Content-Range': `bytes */${size}` });
        return;
      }
      status = 206;
      start = parsed.start;
      end = parsed.end;
    }

    const headers = {
      ...CORS_HEADERS,
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }

    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  async function route(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      throw new HttpError(400, 'malformed URL', 'E_URL');
    }
    const parts = pathname.split('/').filter(Boolean);
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Max-Age': '600' });
      res.end();
      return;
    }

    if (parts.length === 1 && parts[0] === 'health') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed', 'E_METHOD');
      const counts = queue.counts();
      sendJson(res, 200, {
        ok: true,
        queue: counts.queued,
        running: counts.running,
        concurrency: queue.concurrency,
        jobs: jobs.size,
      });
      return;
    }

    if (parts.length === 1 && parts[0] === 'jobs') {
      if (method !== 'POST') throw new HttpError(405, 'method not allowed', 'E_METHOD');
      await handleJobsCreate(req, res);
      return;
    }

    if (parts[0] !== 'jobs' || parts.length < 2) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    const id = parts[1];
    if (!ID_RE.test(id) || id.length > ID_MAX) {
      // 路径穿越 / 非法 id 一律按不存在处理，不触碰文件系统
      sendJson(res, 404, { error: 'job not found' });
      return;
    }

    if (parts.length === 2) {
      if (method === 'GET' || method === 'HEAD') {
        const job = getJobOr404(id);
        sendJson(res, 200, jobView(job));
        return;
      }
      if (method === 'DELETE') {
        const job = getJobOr404(id);
        cancelJob(job);
        sendJson(res, 200, { id: job.id, status: job.status });
        return;
      }
      throw new HttpError(405, 'method not allowed', 'E_METHOD');
    }

    if (parts.length === 3 && parts[2] === 'master.mp4') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed', 'E_METHOD');
      const job = getJobOr404(id);
      serveMaster(req, res, job);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  loadPersistedJobs();

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) { try { res.destroy(); } catch { /* ignore */ } return; }
      const status = Number(e && e.status) || 500;
      const code = (e && e.code) || 'E_INTERNAL';
      if (status >= 500) console.error('[api]', e && e.stack || e);
      sendJson(res, status, { error: String((e && e.message) || e), code });
    });
  });

  server.jobs = jobs;
  server.queue = queue;
  server.jobsDir = jobsDir;
  server.root = root;
  server.concurrency = concurrency;

  server.shutdown = async () => {
    for (const job of jobs.values()) {
      if (job.status === 'running') {
        job.cancelRequested = true;
        job.status = 'cancelled';
        job.finishedAt = job.finishedAt || nowIso();
        persist(job);
        if (job.child) killTree(job.child);
      } else if (job.status === 'queued') {
        queue.remove(job);
        job.status = 'cancelled';
        job.finishedAt = nowIso();
        persist(job);
      }
    }
    for (const child of LIVE_CHILDREN) killTree(child);
    LIVE_CHILDREN.clear();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      server.close(finish);
      server.closeIdleConnections?.();
      const timer = setTimeout(() => {
        server.closeAllConnections?.();
        finish();
      }, 1000);
      timer.unref?.();
    });
  };

  return server;
}

/**
 * 监听并返回 { server, port, url }。port=0 时由系统分配（测试用）。
 */
export function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', root, outDir, concurrency } = {}) {
  const server = createJobServer({ root, outDir, concurrency });
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

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--outdir') out.outDir = argv[++i];
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
    console.log(`Usage: node server/api.mjs [--port 5190] [--concurrency 1] [--root <dir>] [--outdir <dir>]

  POST   /jobs                    validate spec + enqueue a compile job
  GET    /jobs/<id>               job status, stats, build log tail
  GET    /jobs/<id>/master.mp4    finished film (Range supported)
  DELETE /jobs/<id>               cancel a queued/running job
  GET    /health                  { ok, queue, running, concurrency }`);
    process.exit(0);
  }
  const port = Number.isFinite(args.port) ? args.port : DEFAULT_PORT;
  const concurrency = Number.isFinite(args.concurrency) ? Math.max(1, Math.floor(args.concurrency)) : 1;
  startServer({ port, root: args.root, outDir: args.outDir, concurrency })
    .then(({ server, port: actual, url }) => {
      console.log(`[api] root: ${server.root}`);
      console.log(`[api] jobs: ${server.jobsDir}`);
      console.log(`[api] ${url}  (concurrency=${server.concurrency})`);
      const stop = () => {
        server.shutdown().finally(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error('[api] failed:', (e && e.message) || e);
      process.exit(1);
    });
}
