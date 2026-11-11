#!/usr/bin/env node
/**
 * test-api.mjs — 真实端到端验收 server/api.mjs（零依赖）。
 *
 *   node server/test-api.mjs
 *
 * 覆盖：
 *   1. GET /health 契约
 *   2. POST /jobs 合法 spec → 202 + job id
 *   3. 轮询 GET /jobs/<id> → done（真实调用 scripts/compile.mjs 渲染 4s / 120 帧）
 *   4. stats 与 plan.json 一致（duration=4 / frames=120 / segments=5）
 *   5. ffprobe master.mp4 精确 120 帧
 *   6. GET /jobs/<id>/master.mp4 → 200 且 > 100KB；Range → 206
 *   7. GET 不存在的 job → 404
 *   8. POST 非法 spec → 400 + issues[]
 *   9. job id 路径穿越尝试 → 404
 *  10. DELETE 运行中的 job → cancelled，子进程被清理
 *
 * 退出码 0/1。只连本机 127.0.0.1，随机端口，不联网。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`);
  }
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  return { res, body, text };
}

/** 4 秒 / 1 轮 / 无 flash 的合法 spec：5 段 = 30+12+18+30+30 = 120 帧 @30fps */
function buildSpec() {
  return {
    specVersion: 1,
    meta: { name: 'api-test-4s', brand: 'TEST', cta: '', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: 4 },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120, vo: null },
    structure: {
      opening: 1,
      round: 1,
      card: 0.4,
      ending: 1,
      moreCard: 1,
      flash: { count: 0, each: 0.25 },
    },
    opening: { page: 'templates/segment.html', name: 'opening' },
    rounds: [{
      id: 'r01',
      name: 'api-round',
      card: {
        layout: 0,
        first: '测试',
        keyword: 'API？',
        page: 'templates/big-card.html',
      },
      style: {
        page: 'templates/segment.html',
        t0: 0.3,
        speed: 1.3,
      },
    }],
    moreCard: { page: 'templates/big-card.html', first: '还有', keyword: '更多？' },
    flash: { page: 'templates/segment.html' },
    ending: { page: 'templates/segment.html', name: 'ending' },
    assets: [],
    patches: [],
    render: { quality: 'master', preset: 'bilibili', concurrency: 2, outDir: 'out' },
  };
}

function probeFrames(file) {
  const ffprobe = process.env.FFPROBE || 'ffprobe';
  const r = spawnSync(ffprobe, [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `ffprobe failed: ${String(r.stderr || '').trim()}`);
  return Number(String(r.stdout).trim());
}

async function pollJob(base, id, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const { res, body } = await jsonFetch(`${base}/jobs/${id}`);
    assert.equal(res.status, 200, `GET /jobs/${id} -> ${res.status}`);
    last = body;
    if (['done', 'failed', 'cancelled'].includes(body.status)) return body;
    await sleep(500);
  }
  throw new Error(`job ${id} timed out after ${timeoutMs}ms (last status: ${last && last.status})`);
}

async function main() {
  console.log(`[test-api] root: ${ROOT}`);
  const boot = await startServer({ port: 0, host: '127.0.0.1', root: ROOT, concurrency: 1 });
  const base = boot.url;
  console.log(`[test-api] server: ${base}`);

  let jobId = null;
  try {
    await test('GET /health reports ok, queue and concurrency', async () => {
      const { res, body } = await jsonFetch(`${base}/health`);
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.concurrency, 1);
      assert.equal(typeof body.queue, 'number');
    });

    await test('POST /jobs accepts a valid spec and returns 202 + id', async () => {
      const { res, body } = await jsonFetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSpec()),
      });
      assert.equal(res.status, 202, `body: ${JSON.stringify(body)}`);
      assert.match(body.id, /^[a-z0-9-]+$/);
      assert.equal(body.status, 'queued');
      jobId = body.id;
      assert.ok(fs.existsSync(path.join(ROOT, 'out', 'api', jobId, 'project.spec.json')), 'project.spec.json missing');
    });

    await test('job reaches done through the real compiler', async () => {
      assert.ok(jobId, 'no job id from previous step');
      const job = await pollJob(base, jobId, 240000);
      assert.equal(job.status, 'done', `job failed: ${JSON.stringify({ exitCode: job.exitCode, error: job.error, logTail: job.logTail })}`);
      assert.equal(job.exitCode, 0);
      assert.ok(job.startedAt && job.finishedAt, 'timestamps missing');
      assert.ok(typeof job.logTail === 'string' && job.logTail.length > 0, 'logTail empty');
    });

    await test('stats reflect plan.json (4s / 120 frames / 5 segments)', async () => {
      const { body } = await jsonFetch(`${base}/jobs/${jobId}`);
      assert.ok(body.stats, 'stats is null');
      assert.equal(body.stats.duration, 4);
      assert.equal(body.stats.frames, 120);
      assert.equal(body.stats.segments, 5);
      assert.equal(body.stats.fps, 30);
    });

    await test('master.mp4 has exactly 120 frames', async () => {
      const master = path.join(ROOT, 'out', 'api', jobId, 'master.mp4');
      assert.ok(fs.existsSync(master), `missing ${master}`);
      assert.equal(probeFrames(master), 120);
    });

    await test('GET master.mp4 returns 200 and more than 100KB', async () => {
      const res = await fetch(`${base}/jobs/${jobId}/master.mp4`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'video/mp4');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 100 * 1024, `only ${buf.length} bytes`);
    });

    await test('GET master.mp4 honours a byte Range with 206', async () => {
      const res = await fetch(`${base}/jobs/${jobId}/master.mp4`, { headers: { Range: 'bytes=0-99' } });
      assert.equal(res.status, 206);
      assert.match(res.headers.get('content-range') || '', /^bytes 0-99\/\d+$/);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.length, 100);
    });

    await test('GET unknown job returns 404', async () => {
      const { res, body } = await jsonFetch(`${base}/jobs/does-not-exist-000`);
      assert.equal(res.status, 404);
      assert.equal(body.error, 'job not found');
    });

    await test('POST invalid spec returns 400 with issues[]', async () => {
      const { res, body } = await jsonFetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specVersion: 1, meta: { name: 'bad' }, format: { width: 1920, height: 1080, fps: 30 }, rounds: [] }),
      });
      assert.equal(res.status, 400, `body: ${JSON.stringify(body)}`);
      assert.ok(Array.isArray(body.issues) && body.issues.length > 0, 'issues[] missing');
      assert.ok(body.issues.some((i) => i.level === 'error' && i.code), 'no error issue with a code');
    });

    await test('path traversal in job id is rejected with 404', async () => {
      const { res } = await jsonFetch(`${base}/jobs/..%2F..%2Fpackage.json`);
      assert.equal(res.status, 404);
    });

    await test('DELETE a running job kills it and marks cancelled', async () => {
      const post = await jsonFetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSpec()),
      });
      assert.equal(post.res.status, 202);
      const id = post.body.id;
      const del = await jsonFetch(`${base}/jobs/${id}`, { method: 'DELETE' });
      assert.equal(del.res.status, 200, `DELETE -> ${del.res.status}`);
      assert.equal(del.body.status, 'cancelled');
      const job = await pollJob(base, id, 15000);
      assert.equal(job.status, 'cancelled');
      // 队列已被清理：随后再查询仍然稳定为 cancelled，不会复活
      await sleep(600);
      const again = await jsonFetch(`${base}/jobs/${id}`);
      assert.equal(again.body.status, 'cancelled');
    });
  } finally {
    await boot.server.shutdown();
  }

  const total = passed + failed;
  console.log(`\nRan ${total} tests`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('[test-api] fatal:', e && e.stack || e);
  process.exit(1);
});
