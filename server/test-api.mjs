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
 *  11. CORS 默认关闭：带 Origin 的请求不回 Access-Control-Allow-Origin
 *  12. CORS 显式放行（--cors/opts.cors）：白名单 origin 回显 + Vary: Origin，非白名单不回
 *  13. 越界 Range → 416 + Content-Range: bytes *​/size
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
      assert.equal(body.errorCode, null, 'done job must have no errorCode');
      assert.match(body.artifactPath || '', /master\.mp4$/, `artifactPath=${body.artifactPath}`);
    });

    await test('done job 不受陈旧 error.json 影响（不报假红）', async () => {
      // 复现：outDir 里躺着上一次构建的失败记录。成功的 job 不该顶着旧错误码。
      const stale = path.join(ROOT, 'out', 'api', jobId, 'error.json');
      fs.writeFileSync(stale, JSON.stringify({
        ok: false, phase: 'render', code: 'E_RENDER', message: 'stale failure from a previous build',
        failedSegment: '00-opening', failedSegments: ['00-opening'],
      }));
      try {
        const { body } = await jsonFetch(`${base}/jobs/${jobId}`);
        assert.equal(body.status, 'done');
        assert.equal(body.errorCode, null, `stale error.json leaked errorCode=${body.errorCode}`);
        assert.equal(body.phase, null, `stale error.json leaked phase=${body.phase}`);
        assert.deepEqual(body.failedSegments, []);
        assert.match(body.artifactPath || '', /master\.mp4$/);
      } finally {
        fs.rmSync(stale, { force: true });
      }
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

    await test('越界 Range 返回 416 且带 Content-Range', async () => {
      assert.ok(jobId, 'no job id');
      const res = await fetch(`${base}/jobs/${jobId}/master.mp4`, { headers: { Range: 'bytes=99999999999-' } });
      assert.equal(res.status, 416, `got ${res.status}`);
      assert.match(res.headers.get('content-range') || '', /^bytes \*\/\d+$/);
    });

    await test('CORS 默认关闭：带 Origin 的请求不回 ACAO', async () => {
      const res = await fetch(`${base}/health`, { headers: { Origin: 'http://evil.example' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), null, 'ACAO must be absent by default');
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

    await test('失败 job 暴露 errorCode / phase / logPath / errorPath（P1-04）', async () => {
      // 页面在 renderFrame 里主动抛错：plan 校验通过，渲染阶段必失败。
      const failPage = path.join(ROOT, 'out', 'api-fail', 'page-throws.html');
      fs.mkdirSync(path.dirname(failPage), { recursive: true });
      fs.writeFileSync(failPage, `<!doctype html><meta charset="utf-8"><body><canvas id="c"></canvas>
<script>
window.renderFrame = () => { throw new Error('intentional api-test render failure'); };
window.__ready = true;
</script></body>`);
      const spec = buildSpec();
      spec.opening.page = 'out/api-fail/page-throws.html';
      spec.opening.name = 'throws';
      const post = await jsonFetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      assert.equal(post.res.status, 202, JSON.stringify(post.body));
      // 预算 300s：这个 job 有 5 段真渲染 + 失败段 3 次尝试 + 一次浏览器重启，
      // 独立实测约 75s；全套并发负载下会翻倍。旧预算 120s 恰好等于渲染器的
      // --timeout（页面 ready 预算），两者同时到点，看起来像「挂死」其实是预算不够。
      const job = await pollJob(base, post.body.id, 300000);
      assert.equal(job.status, 'failed', `expected failed, got ${job.status}`);
      assert.equal(typeof job.errorCode, 'string', 'errorCode missing');
      assert.equal(job.phase, 'render', `phase=${job.phase}`);
      assert.match(job.logPath || '', /build\.log$/, `logPath=${job.logPath}`);
      // logPath 是构建日志，detailPath 才是阶段诊断产物；两者不能混用一个名字。
      assert.match(job.detailPath || '', /render-manifest\.json$/, `detailPath=${job.detailPath}`);
      assert.match(job.errorPath || '', /error\.json$/, `errorPath=${job.errorPath}`);
      assert.equal(job.artifactPath, null, 'failed job must not claim an artifact');
      assert.ok(Array.isArray(job.failedSegments), 'failedSegments must be an array');
    });
  } finally {
    await boot.server.shutdown();
  }

  // ── CORS 显式放行（单进程内第二个 server：白名单按 server 生效） ────────────
  {
    const boot2 = await startServer({ port: 0, host: '127.0.0.1', root: ROOT, cors: ['http://ok.example'] });
    try {
      await test('CORS 放行白名单 origin 并带 Vary: Origin', async () => {
        const res = await fetch(`${boot2.url}/health`, { headers: { Origin: 'http://ok.example' } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), 'http://ok.example');
        assert.equal(res.headers.get('vary'), 'Origin');
      });

      await test('CORS 不放行非白名单 origin', async () => {
        const res = await fetch(`${boot2.url}/health`, { headers: { Origin: 'http://nope.example' } });
        assert.equal(res.headers.get('access-control-allow-origin'), null);
      });

      await test('OPTIONS 预检：白名单回 CORS 头，非白名单不回', async () => {
        const ok = await fetch(`${boot2.url}/jobs`, { method: 'OPTIONS', headers: { Origin: 'http://ok.example' } });
        assert.equal(ok.status, 204);
        assert.equal(ok.headers.get('access-control-allow-origin'), 'http://ok.example');
        const no = await fetch(`${boot2.url}/jobs`, { method: 'OPTIONS', headers: { Origin: 'http://nope.example' } });
        assert.equal(no.headers.get('access-control-allow-origin'), null);
      });
    } finally {
      await boot2.server.shutdown();
    }
  }

  // ── CSRF / 内容类型 / 远程页面（v2.3.5 安全收紧） ──────────────────────────
  {
    const boot3 = await startServer({ port: 0, host: '127.0.0.1', root: ROOT });
    try {
      await test('POST /jobs 缺 Content-Type: application/json → 415', async () => {
        const r = await jsonFetch(`${boot3.url}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', Origin: 'http://evil.example' },
          body: JSON.stringify(buildSpec()),
        });
        assert.equal(r.res.status, 403); // Origin 先于 Content-Type 被拒
        assert.equal(r.body.code, 'E_ORIGIN');

        const r2 = await jsonFetch(`${boot3.url}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(buildSpec()),
        });
        assert.equal(r2.res.status, 415);
        assert.equal(r2.body.code, 'E_CONTENT_TYPE');
      });

      await test('跨源 Origin 的 JSON POST → 403 E_ORIGIN（不创建 job）', async () => {
        const before = (await jsonFetch(`${boot3.url}/health`)).body.jobs;
        const r = await jsonFetch(`${boot3.url}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
          body: JSON.stringify(buildSpec()),
        });
        assert.equal(r.res.status, 403);
        assert.equal(r.body.code, 'E_ORIGIN');
        const after = (await jsonFetch(`${boot3.url}/health`)).body.jobs;
        assert.equal(after, before);
      });

      await test('HTTP 客户端不能自带 allowRemotePages（SSRF 闸门）', async () => {
        const spec = buildSpec();
        spec.opening.page = 'http://169.254.169.254/latest/meta-data/';
        spec.render = { ...(spec.render || {}), allowRemotePages: true };
        const r = await jsonFetch(`${boot3.url}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        });
        assert.equal(r.res.status, 400);
        assert.ok(JSON.stringify(r.body.issues).includes('E_PAGE_REMOTE'), JSON.stringify(r.body.issues));
      });

      await test('非回环 host 且无 token → 拒绝启动', async () => {
        await assert.rejects(startServer({ port: 0, host: '0.0.0.0', root: ROOT }), /non-loopback/i);
      });
    } finally {
      await boot3.server.shutdown();
    }
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
