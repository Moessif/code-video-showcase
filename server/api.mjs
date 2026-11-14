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

/** 队列上限：防止一个页面（或一个脚本）无限灌任务把磁盘和 CPU 吃光。 */
export const MAX_QUEUE = 32;
/** 历史上保留的 job 数上限（超出后淘汰最老的已完成 job）。 */
export const MAX_JOBS = 200;

/**
 * CORS：默认**不开**。
 *
 * 之前是 `Access-Control-Allow-Origin: *`，意味着用户在浏览器里随便打开一个
 * 恶意页面，它就能往 127.0.0.1:5190 灌 job、读 spec 与 build.log、甚至下载
 * 成片。服务只监听回环地址，但 CORS 头让别的源也能访问它。
 *
 * 现在默认同源（不发 CORS 头）。需要跨源时用 --cors <origin> 显式指定。
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

/** 允许的跨源白名单（空 = 不允许跨源）。 */
let ALLOWED_ORIGINS = new Set();
/** 可选 bearer token：--host 非回环时强制要求。 */
let AUTH_TOKEN = '';

/** Host 头是否指向本机（含端口）。 */
export function isLoopbackHost(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  return h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * CSRF 防线：写操作必须来自同源。
 *
 * 只靠「监听 127.0.0.1」不够——浏览器里的任意网页都能向 127.0.0.1:5190
 * 发一个 text/plain POST（simple request，不触发预检），服务端照样解析 body。
 * 所以：有 Origin 就必须是回环或 CORS 白名单；Host 必须是回环。
 */
function assertRequestOrigin(req) {
  const origin = req.headers?.origin;
  if (origin) {
    let ok = false;
    try { ok = isLoopbackHost(new URL(origin).host); } catch { ok = false; }
    if (!ok && !ALLOWED_ORIGINS.has(String(origin))) {
      throw new HttpError(403, `origin not allowed: ${origin}`, 'E_ORIGIN');
    }
  }
  if (!isLoopbackHost(req.headers?.host)) {
    throw new HttpError(403, `host not allowed: ${req.headers?.host}`, 'E_HOST');
  }
}

/** 当前请求允许的 CORS 头：白名单命中才发。 */
function corsHeaders(req) {
  const origin = req && req.headers && req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

/**
 * 剥掉可能泄露的绝对路径：把 `E:\...` / `/home/user/...` 之类替换成占位符。
 * 错误信息对使用者仍然有用（知道是哪个文件），但不暴露本机目录结构。
 */
export function scrubMessage(msg) {
  return String(msg == null ? '' : msg)
    .replace(/[A-Za-z]:[\\/][^\s'"]*/g, '<path>')
    .replace(/(?:\/home\/|\/Users\/|\/var\/|\/tmp\/|\/root\/)[^\s'"]*/g, '<path>');
}

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

function sendJson(res, status, body, extra = {}, req = null) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...CORS_HEADERS,
    ...corsHeaders(req),
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
 * @param {string|string[]} [opts.cors] 允许的跨源 origin（默认空 = 同源）
 */
export function createJobServer(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const jobsDir = path.resolve(opts.outDir || path.join(root, 'out', 'api'));
  const concurrency = Math.max(1, Math.min(16, Math.floor(Number(opts.concurrency)) || 1));
  const compileScript = path.join(root, 'scripts', 'compile.mjs');

  // CORS 白名单：默认空（同源）。--cors <origin[,origin]> / opts.cors 显式放行。
  if (opts.cors) {
    const list = Array.isArray(opts.cors) ? opts.cors : String(opts.cors).split(',');
    ALLOWED_ORIGINS = new Set(list.map((s) => String(s).trim()).filter(Boolean));
  }
  if (opts.token) AUTH_TOKEN = String(opts.token);

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

  /** 机器可读的失败对象（v2.4/P1-04）：compile 写的 <job>/error.json 原样投影。 */
  function jobFailure(job) {
    let e = null;
    try { e = JSON.parse(fs.readFileSync(path.join(job.dir, 'error.json'), 'utf8')); } catch { /* 旧 job / 非 compile 失败 */ }
    if (!e || typeof e !== 'object') {
      if (!job.error) return null;
      // 无 error.json（spawn 失败/硬杀）也要给出 logPath——build.log 通常仍在。
      const logPath = fs.existsSync(path.join(job.dir, 'build.log'))
        ? path.relative(root, path.join(job.dir, 'build.log')).split(path.sep).join('/') : null;
      return { code: 'E_JOB', phase: null, message: scrubMessage(job.error), failedSegment: null, failedSegments: [], logPath, detailPath: null, errorPath: null };
    }
    const rel = (p) => (typeof p === 'string' && p ? path.relative(root, p).split(path.sep).join('/') : null);
    return {
      code: e.code || 'E_JOB',
      phase: e.phase || null,
      message: scrubMessage(e.message || job.error || ''),
      failedSegment: e.failedSegment || (Array.isArray(e.failedSegments) ? e.failedSegments[0] : null) || null,
      failedSegments: Array.isArray(e.failedSegments) ? e.failedSegments : (e.failedSegment ? [e.failedSegment] : []),
      // logPath 恒指构建日志（评审页 logTail 读的就是它）；阶段诊断产物走 detailPath。
      // 兼容 v2.4 早期 error.json：那时 compile 把 manifest 写在 logPath 名下。
      logPath: fs.existsSync(path.join(job.dir, 'build.log')) ? rel(path.join(job.dir, 'build.log')) : null,
      detailPath: rel(e.detailPath || e.logPath),
      errorPath: rel(path.join(job.dir, 'error.json')),
    };
  }

  function jobView(job) {
    // 成功的 job 不投影失败字段：outDir 里可能躺着上一次构建的 error.json，
    // 不看状态就读它，等于让成功的 job 顶着旧错误码（假红）。
    const failure = job.status === 'done' ? null : jobFailure(job);
    return {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode ?? null,
      createdAt: job.createdAt || null,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      stats: readStats(job),
      logTail: scrubMessage(readLogTail(path.join(job.dir, 'build.log'))),
      // job.error 可能是绝对路径/完整堆栈（failJob），与 logTail/message 一样要 scrub。
      error: scrubMessage(job.error || '') || null,
      // 失败契约：CI 可以只看这几个字段分流，不必 grep 日志正文。
      errorCode: failure ? failure.code : null,
      phase: failure ? failure.phase : null,
      failedSegment: failure ? failure.failedSegment : null,
      failedSegments: failure ? failure.failedSegments : [],
      logPath: failure ? failure.logPath : null,
      detailPath: failure ? failure.detailPath : null,
      errorPath: failure ? failure.errorPath : null,
      artifactPath: job.status === 'done' && fs.existsSync(path.join(job.dir, 'master.mp4'))
        ? path.relative(root, path.join(job.dir, 'master.mp4')).split(path.sep).join('/')
        : null,
      // spec 路径不再让前端猜（--outdir/--root 变体会猜错）；存在才投影。
      specPath: fs.existsSync(path.join(job.dir, 'project.spec.json'))
        ? path.relative(root, path.join(job.dir, 'project.spec.json')).split(path.sep).join('/')
        : null,
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
      // R2-19（N04-F6）：尊重 spec.render.concurrency，不再硬编 2。
      // render-farm 侧的 CPU 钳制（R2-10）会兜底防过订。
      let specConc = 2;
      try {
        const sj = JSON.parse(fs.readFileSync(path.join(job.dir, 'project.spec.json'), 'utf8'));
        specConc = Math.max(1, Number(sj.render?.concurrency) || 2);
      } catch { /* 读不到就用默认 */ }
      const args = [
        'scripts/compile.mjs',
        '--spec', relSpec,
        '--root', root,
        '--outdir', relOut,
        '--no-qa',
        '--concurrency', String(specConc),
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
    // 只接受 application/json：跨源页面无法在不触发预检的情况下伪造这个类型，
    // 再配合 Origin 校验，普通网页就灌不进 job 了。
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') {
      throw new HttpError(415, 'Content-Type must be application/json', 'E_CONTENT_TYPE');
    }
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
    // 远程页面只能由服务启动者用 CLI 开关放行，不能由 HTTP 客户端自带。
    // 否则任意网页可以提交 allowRemotePages + 169.254.169.254，让无头 Chrome 替它打内网。
    if (body.render && typeof body.render === 'object') delete body.render.allowRemotePages;

    // 校验与真实编译走同一个编译点（root = 仓库根）
    let built;
    try {
      built = buildPlanFromSpec(body, { root });
    } catch (e) {
      const issues = Array.isArray(e && e.issues) && e.issues.length
        ? e.issues
        : [{ code: (e && e.code) || 'E_SPEC', path: '', message: String((e && e.message) || e), level: 'error' }];
      sendJson(res, 400, { error: 'invalid spec', issues }, {}, req);
      return;
    }

    const id = newJobId(built.spec);
    const dir = path.join(jobsDir, id);
    if (!isInside(jobsDir, dir)) throw new HttpError(400, 'bad job id', 'E_JOB_ID');

    // 队列上限：挡住「无限灌任务」的脚本/页面。每个排队任务都要落 1 MB spec
    // 并最终起一个渲染子进程，没有上限就能把磁盘和 CPU 打满。
    const counts = queue.counts();
    if (counts.queued + counts.running >= MAX_QUEUE) {
      throw new HttpError(429, `queue is full (${MAX_QUEUE} jobs); retry later`, 'E_QUEUE_FULL');
    }

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
    evictOldJobs();
    persist(job);
    queue.push(job);
    sendJson(res, 202, { id, status: 'queued' }, {}, req);
  }

  /** 淘汰超出 MAX_JOBS 的历史 job（只清已完成/已取消的，运行中的不动）。 */
  function evictOldJobs() {
    if (jobs.size <= MAX_JOBS) return;
    const finished = [...jobs.values()]
      .filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
      .sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || '')));
    let excess = jobs.size - MAX_JOBS;
    for (const j of finished) {
      if (excess <= 0) break;
      jobs.delete(j.id);
      // R2-19（N04-F6）：同步清磁盘——旧版只删内存 Map，job 目录无限堆积，
      // 长跑服务撑爆 outDir，且被裁掉的 job 仍在盘上但 GET 返回 404（不一致）。
      try {
        if (j.dir && isInside(jobsDir, j.dir)) fs.rmSync(j.dir, { recursive: true, force: true });
      } catch { /* 清理失败不影响淘汰 */ }
      excess--;
    }
  }

  function getJobOr404(id) {
    const job = jobs.get(id) || loadJobFromDisk(id);
    if (!job) throw new HttpError(404, 'job not found', 'E_NOT_FOUND');
    if (!jobs.has(id)) jobs.set(id, job);
    return job;
  }

  function serveMaster(req, res, job) {
    if (job.status !== 'done') {
      sendJson(res, 409, { error: 'job not finished', id: job.id, status: job.status }, {}, req);
      return;
    }
    const file = path.join(job.dir, 'master.mp4');
    if (!isInside(jobsDir, file)) {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status }, {}, req);
      return;
    }
    let st;
    try { st = fs.statSync(file); } catch {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status }, {}, req);
      return;
    }
    if (!st.isFile()) {
      sendJson(res, 404, { error: 'master.mp4 not found', id: job.id, status: job.status }, {}, req);
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
        sendJson(res, 416, { error: 'range not satisfiable', size }, { 'Content-Range': `bytes */${size}` }, req);
        return;
      }
      status = 206;
      start = parsed.start;
      end = parsed.end;
    }

    const headers = {
      ...CORS_HEADERS,
      ...corsHeaders(req),
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

    if (AUTH_TOKEN && method !== 'OPTIONS') {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Bearer ${AUTH_TOKEN}`) throw new HttpError(401, 'missing or invalid bearer token', 'E_AUTH');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) assertRequestOrigin(req);

    if (method === 'OPTIONS') {
      const pre = corsHeaders(req);
      res.writeHead(204, pre['Access-Control-Allow-Origin']
        ? { ...CORS_HEADERS, ...pre, 'Access-Control-Max-Age': '600' }
        : { 'Content-Length': '0' });
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
      }, {}, req);
      return;
    }

    if (parts.length === 1 && parts[0] === 'jobs') {
      if (method !== 'POST') throw new HttpError(405, 'method not allowed', 'E_METHOD');
      await handleJobsCreate(req, res);
      return;
    }

    if (parts[0] !== 'jobs' || parts.length < 2) {
      sendJson(res, 404, { error: 'not found' }, {}, req);
      return;
    }

    const id = parts[1];
    if (!ID_RE.test(id) || id.length > ID_MAX) {
      // 路径穿越 / 非法 id 一律按不存在处理，不触碰文件系统
      sendJson(res, 404, { error: 'job not found' }, {}, req);
      return;
    }

    if (parts.length === 2) {
      if (method === 'GET' || method === 'HEAD') {
        const job = getJobOr404(id);
        sendJson(res, 200, jobView(job), {}, req);
        return;
      }
      if (method === 'DELETE') {
        const job = getJobOr404(id);
        cancelJob(job);
        sendJson(res, 200, { id: job.id, status: job.status }, {}, req);
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

    sendJson(res, 404, { error: 'not found' }, {}, req);
  }

  loadPersistedJobs();

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) { try { res.destroy(); } catch { /* ignore */ } return; }
      const status = Number(e && e.status) || 500;
      const code = (e && e.code) || 'E_INTERNAL';
      if (status >= 500) console.error('[api]', e && e.stack || e);
      sendJson(res, status, { error: scrubMessage((e && e.message) || e), code }, {}, req);
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
export function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', root, outDir, concurrency, cors, token } = {}) {
  // 非回环监听必须有鉴权：否则 `--host 0.0.0.0` 等于把源码、out/、spec 全公开。
  if (!isLoopbackHost(host) && !token) {
    return Promise.reject(new Error('refusing to listen on a non-loopback host without --token'));
  }
  const server = createJobServer({ root, outDir, concurrency, cors, token });
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
    else if (a === '--cors') out.cors = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--token') out.token = argv[++i];
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
                      [--host 127.0.0.1] [--token <token>] [--cors <origin>]

  POST   /jobs                    validate spec + enqueue a compile job
  GET    /jobs/<id>               job status, stats, build log tail
  GET    /jobs/<id>/master.mp4    finished film (Range supported)
  DELETE /jobs/<id>               cancel a queued/running job
  GET    /health                  { ok, queue, running, concurrency }

  CORS 默认关闭（同源可用）。需要跨源访问时用 --cors <origin> 显式放行。
  写操作校验 Origin/Host 且只接受 application/json（CSRF 防护）。
  --host 非回环时必须同时给 --token，否则拒绝启动。`);
    process.exit(0);
  }
  const port = Number.isFinite(args.port) ? args.port : DEFAULT_PORT;
  const concurrency = Number.isFinite(args.concurrency) ? Math.max(1, Math.floor(args.concurrency)) : 1;
  startServer({ port, host: args.host, token: args.token, root: args.root, outDir: args.outDir, concurrency, cors: args.cors })
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
