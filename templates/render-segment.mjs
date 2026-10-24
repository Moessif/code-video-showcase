#!/usr/bin/env node
// render-segment.mjs — render one HTML segment to MP4 frame-by-frame.
//
//   node render-segment.mjs --page segments/01.html --out out/01.mp4 --duration 3
//   node render-segment.mjs --page segments/09.html --out out/09.mp4 --duration 3 --t0 0.35 --speed 1.4
//   node render-segment.mjs --page segments/01.html --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills
//
// Design:
//   page.evaluate(window.renderFrame(t)) -> CDP Page.captureScreenshot(JPEG q95)
//   -> ffmpeg image2pipe -> libx264 crf16 yuv420p
//
// Segment mode: a relative --page is served by the embedded server with
// ?seg=1&t0=<--t0>&speed=<--speed>&dur=<--duration> appended, so pages using
// common.js createSegment() map clip time u to scene time t = t0 + u*speed.
// An absolute http(s) --page URL is used verbatim (put the query string there).
//
// Cross-platform browser resolution: CHROME_EXE env > Chrome for Testing (Linux)
// > Playwright bundled Chromium > channel msedge/chromium.
// Requires: npm i playwright (or playwright-core) and ffmpeg on PATH or FFMPEG_EXE.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ---------- tiny arg parser ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args[key] = true;
  else { args[key] = next; i++; }
}
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const str = (k, d) => (args[k] === undefined ? d : String(args[k]));

if (args.help || (!args.page)) {
  console.log(`Usage: node render-segment.mjs --page <path-or-url> [options]
  --out <file.mp4>        output video (required unless --still)
  --duration <sec>        clip duration, default 3
  --t0 <sec>              scene offset appended to the page URL, default 0
  --speed <x>             scene playback speed, default 1
  --fps <n>               default 30
  --root <dir>            static root, default cwd
  --port <n>              static server port, default 0 (ephemeral)
  --crf <n>               libx264 crf, default 16
  --preset <name>         libx264 preset, default medium
  --quality <n>           jpeg quality, default 95
  --still <t1,t2,...>     render still JPEGs instead of video
  --outdir <dir>          stills directory, default out/stills
  --headed                show the browser (debug)
  --timeout <ms>          ready timeout, default 120000
Relative --page paths get ?seg=1&t0=&speed=&dur= appended automatically.`);
  process.exit(args.help ? 0 : 1);
}

const PAGE = str('page');
const OUT = args.out ? path.resolve(str('out')) : null;
const DURATION = num('duration', 3);
const T0 = num('t0', 0);
const SPEED = num('speed', 1);
const FPS = num('fps', 30);
const ROOT = path.resolve(str('root', process.cwd()));
const CRF = num('crf', 16);
const PRESET = str('preset', 'medium');
const QUALITY = num('quality', 95);
const HEADED = !!args.headed;
const TIMEOUT = num('timeout', 120000);
const STILLS = args.still ? String(args.still).split(',').map(Number).filter(Number.isFinite) : null;
const OUTDIR = path.resolve(str('outdir', path.join(ROOT, 'out', 'stills')));
const FFMPEG = process.env.FFMPEG_EXE || 'ffmpeg';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
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
            'Content-Length': st.size, 'Cache-Control': 'no-store',
          });
          fs.createReadStream(file).pipe(res);
        });
      } catch (e) { res.writeHead(400).end('bad request'); }
    });
    server.on('error', reject);
    server.listen(num('port', 0), '127.0.0.1', () => resolve(server));
  });
}

function browserCandidates() {
  const cs = [];
  const envExe = process.env.CHROME_EXE;
  if (envExe && fs.existsSync(envExe)) cs.push({ label: 'CHROME_EXE', opts: { executablePath: envExe } });
  if (process.platform === 'linux') {
    const cft = path.join(os.homedir(), '.local', 'opt', 'chrome-for-testing', 'chrome-linux64', 'chrome');
    if (fs.existsSync(cft)) cs.push({ label: 'chrome-for-testing', opts: { executablePath: cft } });
  }
  cs.push({ label: 'playwright bundled', opts: {} });
  if (process.platform === 'win32') cs.push({ label: 'channel:msedge', opts: { channel: 'msedge' } });
  if (process.platform === 'linux') cs.push({ label: 'channel:chromium', opts: { channel: 'chromium' } });
  return cs;
}

async function loadChromium() {
  try {
    const m = await import('playwright');
    return m.chromium;
  } catch {
    const m = await import('playwright-core');
    return m.chromium;
  }
}

// ffmpeg launcher: frames arrive on stdin as JPEGs (image2pipe -> libx264)
function launchFfmpeg(outFile) {
  const p = spawn(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile,
  ], { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => {
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + ': ' + err.slice(0, 800)))));
  });
  return { stdin: p.stdin, done, proc: p };
}

function writeAsync(stream, buf) {
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

// Relative page path -> embedded-server URL with segment-mode params appended;
// common.js createSegment() reads them to map u to t = t0 + u*speed.
function withSegmentParams(page, port) {
  const u = new URL(`http://127.0.0.1:${port}/${page.replace(/^\/+/, '')}`);
  u.searchParams.set('seg', '1');
  u.searchParams.set('t0', String(T0));
  u.searchParams.set('speed', String(SPEED));
  u.searchParams.set('dur', String(DURATION));
  return u.toString();
}

async function main() {
  const server = await startServer(ROOT);
  const port = server.address().port;
  const pageUrl = /^https?:\/\//.test(PAGE) ? PAGE : withSegmentParams(PAGE, port);
  const chromium = await loadChromium();
  const chromiumArgs = [
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions',
  ];
  if (process.platform !== 'win32') chromiumArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');

  let browser = null, how = '';
  for (const c of browserCandidates()) {
    try {
      browser = await chromium.launch({ headless: !HEADED, args: chromiumArgs, ...c.opts });
      how = c.label; break;
    } catch (e) {
      console.error(`[browser] ${c.label} unavailable: ${String(e.message).split('\n')[0]}`);
    }
  }
  if (!browser) throw new Error('no browser could be launched');
  console.log(`[browser] ${how}`);
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    console.log(`[page] ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForFunction('window.__ready === true || window.__bootError', null, { timeout: TIMEOUT });
    const bootError = await page.evaluate(() => window.__bootError || null);
    if (bootError) throw new Error('page boot error: ' + bootError);
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.DURATION ?? null);
    if (duration && Math.abs(duration - DURATION) > 1e-6) {
      console.warn(`[warn] page DURATION=${duration} but --duration=${DURATION}; using --duration`);
    }

    const cdp = await page.context().newCDPSession(page);

    if (STILLS) {
      fs.mkdirSync(OUTDIR, { recursive: true });
      for (const t of STILLS) {
        await page.evaluate((tt) => window.renderFrame(tt), t);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY, fromSurface: true });
        const file = path.join(OUTDIR, `still-${String(t.toFixed(2)).replace('.', '_')}.jpg`);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log(`[still] ${file}`);
      }
      console.log(`[done] ${STILLS.length} stills -> ${OUTDIR}`);
      if (errors.length) console.error('[page errors]', errors.slice(0, 5));
      return;
    }

    if (!OUT) throw new Error('--out is required (or use --still)');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const frames = Math.round(DURATION * FPS);
    const ff = launchFfmpeg(OUT);
    const started = performance.now();
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      await page.evaluate((tt) => window.renderFrame(tt), t);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY, fromSurface: true });
      const buf = Buffer.from(shot.data, 'base64');
      if (buf.length < 800) throw new Error(`frame ${i} suspiciously small (${buf.length} bytes)`);
      await writeAsync(ff.stdin, buf);
      if (i % 30 === 0 || i === frames - 1) {
        const el = ((performance.now() - started) / 1000).toFixed(1);
        console.log(`[frame] ${i + 1}/${frames}  t=${t.toFixed(3)}s  elapsed=${el}s`);
      }
    }
    ff.stdin.end();
    await ff.done;
    const size = fs.statSync(OUT).size;
    console.log(`[done] ${OUT}  ${frames} frames @${FPS}fps  ${(size / 1024 / 1024).toFixed(2)} MB`);
    if (errors.length) console.error('[page errors]', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('[fatal]', e && e.stack || e); process.exit(1); });
