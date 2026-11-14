#!/usr/bin/env node
/**
 * still-cyber-pixel.mjs — 赛博像素配方（C6-01）的三张静帧 + 确定性检查。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *     node scripts/still-cyber-pixel.mjs
 *
 * 做什么：
 *   1. 复用 templates/render-segment.mjs --still，渲染 t = 0.3 / 1.5 / 2.7 到 out/cyber-pixel/
 *   2. 打印每个文件的字节数（并确认非空）
 *   3. 同一组 t 再从零渲染一遍到 out/cyber-pixel/determinism-b/，两两比 sha256
 *      —— 同 t 必须逐字节一致；不一致时退回 CDP，比较 canvas.toDataURL('image/png')
 *   4. 退出码 0 = 全部通过；1 = 缺文件 / 空文件 / 哈希或像素不一致
 *
 * 依赖：Node ≥ 20、系统 Chrome（CHROME_EXE）、ffmpeg 仅静帧路径不需要。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'out', 'cyber-pixel');
const OUT_B = path.join(OUT, 'determinism-b');
const PAGE = 'templates/cyber-pixel.html?theme=cyber-neon';
const TIMES = [0.3, 1.5, 2.7];
const FPS = 30;
const CHROME = process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1920, VH = 1080;

const stillName = (t) => `still-${t.toFixed(2).replace('.', '_')}.png`;
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const human = (n) => `${n.toLocaleString('en-US')} B (${(n / 1024).toFixed(1)} KiB)`;

function runNode(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, CHROME_EXE: CHROME },
      windowsHide: true,
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    p.on('error', (e) => resolve({ code: 1, out: out + String(e) }));
    p.on('close', (code) => resolve({ code: code == null ? 1 : code, out }));
  });
}

async function renderStills(outdirRel) {
  const args = [
    'templates/render-segment.mjs',
    '--page', PAGE,
    '--still', TIMES.join(','),
    '--format', 'png',
    '--root', '.',
    '--outdir', outdirRel,
    '--timeout', '180000',
  ];
  console.log(`\n$ node ${args.join(' ')}`);
  return runNode(args);
}

/* ─────────────────────────── 兜底：CDP 读 canvas.toDataURL ─────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (urlPath === '/favicon.ico') { res.writeHead(204).end(); return; }
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        const file = path.resolve(root, '.' + urlPath);
        if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
        fs.stat(file, (err, st) => {
          if (err || !st.isFile()) { res.writeHead(404).end('404'); return; }
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(file).pipe(res);
        });
      } catch { res.writeHead(400).end('bad request'); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function chromeDataUrls(pageUrl) {
  const { launchRetry, evaluate, waitFor } = await import(
    pathToFileURL(path.join(ROOT, 'templates', 'cdp.mjs')).href
  );
  const exe = fs.existsSync(CHROME) ? CHROME : undefined;
  const b = await launchRetry({ executablePath: exe, width: VW, height: VH, timeout: 30000 });
  try {
    await b.client.send('Page.navigate', { url: pageUrl }, b.sessionId);
    await waitFor(b.client, b.sessionId, 'window.__ready === true || !!window.__bootError', {
      timeout: 120000, label: 'cyber-pixel __ready',
    });
    const boot = await evaluate(b.client, b.sessionId, () => window.__bootError || null);
    if (boot) throw new Error('page boot error: ' + boot);
    await evaluate(b.client, b.sessionId, () => document.fonts.ready.then(() => true));

    const urls = new Map();
    for (const t of TIMES) {
      const url = await evaluate(b.client, b.sessionId, (a) => {
        window.renderFrame(a.tt);
        const c = document.querySelector('canvas');
        return c.toDataURL('image/png');
      }, { tt: t });
      urls.set(t, String(url));
    }
    return urls;
  } finally {
    await b.close().catch(() => {});
  }
}

function compareCanvasUrls(a, b) {
  const report = [];
  let ok = true;
  for (const t of TIMES) {
    const ua = a.get(t);
    const ub = b.get(t);
    const same = ua === ub;
    if (!same) ok = false;
    report.push({
      t,
      same,
      lenA: ua ? ua.length : 0,
      lenB: ub ? ub.length : 0,
      shaA: ua ? sha256(Buffer.from(ua)) : '-',
      shaB: ub ? sha256(Buffer.from(ub)) : '-',
    });
  }
  return { ok, report };
}

/* ─────────────────────────────── main ─────────────────────────────── */

async function main() {
  let failed = false;
  const log = (ok, msg) => {
    console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${msg}`);
    if (!ok) failed = true;
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(OUT_B, { recursive: true, force: true });

  // 1) 第一次：正式静帧
  const runA = await renderStills(rel(OUT));
  log(runA.code === 0, `render-segment --still (pass A) exit=${runA.code}`);

  const filesA = TIMES.map((t) => path.join(OUT, stillName(t)));
  const sizesA = filesA.map((f) => (fs.existsSync(f) ? fs.statSync(f).size : 0));
  console.log('\n[stills]');
  TIMES.forEach((t, i) => {
    console.log(`  t=${t.toFixed(2)}s  ${rel(filesA[i])}  ${sizesA[i] > 0 ? human(sizesA[i]) : 'MISSING'}`);
  });
  log(sizesA.every((s) => s > 1024), '3 张静帧存在且非空');

  // 2) 第二次：从零再渲染一遍（不同目录 = 不同文件名）
  const runB = await renderStills(rel(OUT_B));
  log(runB.code === 0, `render-segment --still (pass B) exit=${runB.code}`);

  const filesB = TIMES.map((t) => path.join(OUT_B, stillName(t)));
  log(filesB.every((f) => fs.existsSync(f) && fs.statSync(f).size > 1024), '第二遍 3 张静帧存在且非空');

  // 3) sha256 对比
  console.log('\n[determinism · sha256]');
  let allSame = true;
  TIMES.forEach((t, i) => {
    const a = fs.existsSync(filesA[i]) ? fs.readFileSync(filesA[i]) : Buffer.alloc(0);
    const b = fs.existsSync(filesB[i]) ? fs.readFileSync(filesB[i]) : Buffer.alloc(0);
    const ha = sha256(a);
    const hb = sha256(b);
    const same = a.length > 0 && a.length === b.length && ha === hb;
    if (!same) allSame = false;
    console.log(`  t=${t.toFixed(2)}s  A=${ha.slice(0, 16)}… (${a.length}B)  B=${hb.slice(0, 16)}… (${b.length}B)  ${same ? 'SAME' : 'DIFF'}`);
  });

  if (allSame) {
    log(true, '同 t 两次渲染逐字节一致（PNG sha256 相同）');
  } else {
    console.log('\n[warn] PNG 字节不一致，退回 CDP 比较 canvas.toDataURL …');
    const server = await startServer(ROOT);
    try {
      const port = server.address().port;
      const pageUrl = `http://127.0.0.1:${port}/${PAGE}&seg=1&t0=0&speed=1&dur=3`;
      console.log(`[fallback] ${pageUrl}`);
      const ua = await chromeDataUrls(pageUrl);
      const ub = await chromeDataUrls(pageUrl);
      const cmp = compareCanvasUrls(ua, ub);
      for (const r of cmp.report) {
        console.log(`  t=${r.t.toFixed(2)}s  dataURL ${r.same ? 'SAME' : 'DIFF'}  len ${r.lenA}/${r.lenB}  sha ${r.shaA.slice(0, 16)}…/${r.shaB.slice(0, 16)}…`);
      }
      log(cmp.ok, cmp.ok
        ? 'PNG 编码不稳定，但 canvas.toDataURL 两次一致（像素确定，哈希差异来自编码层）'
        : 'canvas.toDataURL 两次不一致：渲染不是 t 的纯函数');
    } finally {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }
  }

  // 4) 给出整段验收命令（1s × 30fps = 30 帧）
  console.log(`\n[next] node templates/render-segment.mjs --page "${PAGE}" --out out/cyber-pixel/test.mp4 --duration 1`);
  console.log(`[next] expect ${FPS} frames @ ${FPS}fps`);

  console.log(`\n${failed ? '[result] FAIL' : '[result] PASS'} — out/cyber-pixel/`);
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error('[fatal]', (e && e.stack) || e); process.exit(1); });
