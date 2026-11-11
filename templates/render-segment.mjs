#!/usr/bin/env node
/**
 * render-segment.mjs v2 — render one HTML segment to MP4, frame by frame.
 *
 *   node render-segment.mjs --page segments/01.html --out out/01.mp4 --duration 3
 *   node render-segment.mjs --page segments/09.html --out out/09.mp4 --duration 3 --t0 0.35 --speed 1.4
 *   node render-segment.mjs --page segments/01.html --still 0.2,0.8,1.4 --outdir out/stills
 *
 * What changed in v2 (see CHANGELOG):
 *   • Zero-dependency fallback: uses system Chrome/Edge over raw CDP when
 *     Playwright is not installed (templates/cdp.mjs).
 *   • Fast canvas capture: for single full-viewport <canvas> pages, frames are
 *     encoded in-page with canvas.toDataURL() and piped to ffmpeg — typically
 *     30–50% faster than a CDP screenshot per frame. DOM-heavy pages fall back
 *     to Page.captureScreenshot automatically.
 *   • Correct colour: JPEG/PNG (full range) is explicitly converted to limited
 *     range bt709 with colour tags, so players do not guess bt601.
 *   • Intermediates encode with CRF 12 / veryfast; the final pass re-encodes once.
 *
 * Design: page.evaluate(renderFrame(t)) → capture → ffmpeg image2pipe → libx264.
 * Relative --page paths are served by an embedded static server with
 * ?seg=1&t0=&speed=&dur= appended, so common.js createSegment() maps clip time u
 * to scene time t = t0 + u*speed.
 *
 * Requires: ffmpeg on PATH (or FFMPEG_EXE), and either Playwright or Chrome/Edge.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launch as launchCdp, evaluate as cdpEvaluate, waitFor as cdpWaitFor, browserCandidates as cdpCandidates } from './cdp.mjs';

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
const bool = (k, d) => (args[k] === undefined ? d : !(args[k] === false || args[k] === 'false' || args[k] === '0'));

if (args.help || !args.page) {
  console.log(`Usage: node render-segment.mjs --page <path-or-url> [options]
  --out <file.mp4>        output video (required unless --still)
  --duration <sec>        clip duration, default 3
  --t0 <sec>              scene offset appended to the page URL, default 0
  --speed <x>             scene playback speed, default 1
  --fps <n>               default 30
  --width/--height <n>    viewport, default 1920x1080
  --root <dir>            static root, default cwd
  --port <n>              static server port, default 0 (ephemeral)
  --crf <n>               libx264 crf for the intermediate, default 12
  --preset <name>         libx264 preset, default veryfast
  --tune <name>           optional x264 tune (e.g. animation)
  --format <jpeg|png>     frame format, default jpeg
  --quality <n>           jpeg quality, default 92
  --capture <auto|canvas|cdp>  frame capture path, default auto
  --vars <file|json>      expose as window.__vars (also ?vars=<base64url>)
  --still <t1,t2,...>     render stills instead of video
  --outdir <dir>          stills directory, default out/stills
  --no-warmup             skip the first-frame warm-up
  --no-optimize           disable CDP optimizeForSpeed
  --headed                show the browser (debug)
  --timeout <ms>          ready timeout, default 120000
  --browser <path>        explicit Chrome/Edge executable

Relative --page paths get ?seg=1&t0=&speed=&dur= appended automatically.
A page can force the capture path with window.__capture = 'canvas' | 'cdp'.`);
  process.exit(args.help ? 0 : 1);
}

const PAGE = str('page');
const OUT = args.out ? path.resolve(str('out')) : null;
const DURATION = num('duration', 3);
const T0 = num('t0', 0);
const SPEED = num('speed', 1);
const FPS = num('fps', 30);
const WIDTH = num('width', 1920);
const HEIGHT = num('height', 1080);
const ROOT = path.resolve(str('root', process.cwd()));
const CRF = num('crf', 12);
const PRESET = str('preset', 'veryfast');
const TUNE = str('tune', '');
const QUALITY = num('quality', 92);
const FORMAT = str('format', 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg';
const CAPTURE = str('capture', 'auto');
const HEADED = !!args.headed;
const TIMEOUT = num('timeout', 120000);
const WARMUP = bool('warmup', true);
const OPTIMIZE = bool('optimize', true);
const STILLS = args.still ? String(args.still).split(',').map(Number).filter(Number.isFinite) : null;
const OUTDIR = path.resolve(str('outdir', path.join(ROOT, 'out', 'stills')));
const FFMPEG = process.env.FFMPEG_EXE || 'ffmpeg';
const BROWSER = args.browser ? path.resolve(String(args.browser)) : (process.env.CHROME_EXE || null);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
};

// ---------- static server ----------
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
      } catch { res.writeHead(400).end('bad request'); }
    });
    server.on('error', reject);
    server.listen(num('port', 0), '127.0.0.1', () => resolve(server));
  });
}

// ---------- ffmpeg ----------
function launchFfmpeg(outFile) {
  const input = ['-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0'];
  const filters = [
    'scale=in_range=pc:out_range=tv:out_color_matrix=bt709',
    'format=yuv420p',
  ].join(',');
  const codec = [
    '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF),
    ...(TUNE ? ['-tune', TUNE] : []),
    '-vf', filters,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '90000',
    '-movflags', '+faststart', outFile,
  ];
  const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...input, ...codec], { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => {
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + ': ' + err.slice(0, 800)))));
  });
  return { stdin: p.stdin, done };
}

function writeAsync(stream, buf) {
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

// ---------- URL ----------
function withSegmentParams(page, port) {
  const u = new URL(`http://127.0.0.1:${port}/${page.replace(/^\/+/, '')}`);
  u.searchParams.set('seg', '1');
  u.searchParams.set('t0', String(T0));
  u.searchParams.set('speed', String(SPEED));
  u.searchParams.set('dur', String(DURATION));
  return u.toString();
}

function loadVars() {
  if (!args.vars) return null;
  const v = String(args.vars);
  if (v.trim().startsWith('{')) return JSON.parse(v);
  return JSON.parse(fs.readFileSync(path.resolve(v), 'utf8'));
}

// ---------- renderer adapters ----------
async function viaPlaywright({ pageUrl, initScript, errors }) {
  let chromium;
  try { chromium = (await import('playwright')).chromium; }
  catch { chromium = (await import('playwright-core')).chromium; }

  const launchArgs = [
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions',
    '--run-all-compositor-stages-before-draw', '--disable-frame-rate-limit', '--force-color-profile=srgb',
    '--disable-lcd-text', '--font-render-hinting=none',
  ];
  if (process.platform !== 'win32') launchArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');

  const browser = await chromium.launch({
    headless: !HEADED,
    args: launchArgs,
    ...(BROWSER ? { executablePath: BROWSER } : {}),
  });
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (initScript) await page.addInitScript({ content: initScript });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForFunction('window.__ready === true || window.__bootError', null, { timeout: TIMEOUT });
  const bootError = await page.evaluate(() => window.__bootError || null);
  if (bootError) throw new Error('page boot error: ' + bootError);
  await page.evaluate(() => document.fonts.ready);

  const cdp = await ctx.newCDPSession(page);
  const ev = async (fn, arg) => page.evaluate(fn, arg);
  const shot = async () => {
    const r = await cdp.send('Page.captureScreenshot', {
      format: FORMAT, ...(FORMAT === 'jpeg' ? { quality: QUALITY } : {}),
      fromSurface: true, captureBeyondViewport: false,
      ...(OPTIMIZE ? { optimizeForSpeed: true } : {}),
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
    });
    return Buffer.from(r.data, 'base64');
  };
  const duration = await page.evaluate(() => window.DURATION ?? null);
  return { kind: 'playwright', ev, shot, duration, close: () => browser.close() };
}

async function viaCdp({ pageUrl, initScript, errors }) {
  const b = await launchCdp({ executablePath: BROWSER || undefined, width: WIDTH, height: HEIGHT, headed: HEADED, timeout: TIMEOUT });
  const sid = b.sessionId;
  b.client.on('Runtime.exceptionThrown', (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || 'page exception');
  });
  b.client.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push('console: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
  });
  if (initScript) {
    await b.client.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sid);
  }
  await b.client.send('Page.navigate', { url: pageUrl }, sid);
  await cdpWaitFor(b.client, sid, `document.readyState === 'complete' || document.readyState === 'interactive'`, { timeout: TIMEOUT, label: 'document load' });
  await cdpWaitFor(b.client, sid, 'window.__ready === true || !!window.__bootError', { timeout: TIMEOUT, label: 'window.__ready' });
  const bootError = await cdpEvaluate(b.client, sid, () => window.__bootError || null);
  if (bootError) throw new Error('page boot error: ' + bootError);
  await cdpEvaluate(b.client, sid, () => document.fonts.ready);

  const ev = (fn, arg) => cdpEvaluate(b.client, sid, fn, arg);
  const shot = async () => {
    const r = await b.client.send('Page.captureScreenshot', {
      format: FORMAT, ...(FORMAT === 'jpeg' ? { quality: QUALITY } : {}),
      fromSurface: true, captureBeyondViewport: false,
      ...(OPTIMIZE ? { optimizeForSpeed: true } : {}),
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
    }, sid);
    return Buffer.from(r.data, 'base64');
  };
  const duration = await cdpEvaluate(b.client, sid, () => window.DURATION ?? null);
  return { kind: 'cdp', ev, shot, duration, close: () => b.close() };
}

async function openRenderer(opts) {
  const tried = [];
  if (!args.cdp && !args['no-playwright']) {
    try { return await viaPlaywright(opts); }
    catch (e) { tried.push(`playwright: ${String(e.message).split('\n')[0]}`); }
  }
  try { return await viaCdp(opts); }
  catch (e) { tried.push(`cdp: ${String(e.message).split('\n')[0]}`); }
  throw new Error('no renderer available:\n  - ' + tried.join('\n  - '));
}

// ---------- main ----------
async function main() {
  const vars = loadVars();
  const varsParam = vars ? { vars: Buffer.from(JSON.stringify(vars)).toString('base64url') } : {};
  const initScript = vars ? `window.__vars = ${JSON.stringify(vars)};` : '';

  const server = await startServer(ROOT);
  const port = server.address().port;
  let pageUrl = /^https?:\/\//.test(PAGE) ? PAGE : withSegmentParams(PAGE, port);
  if (vars) {
    const u = new URL(pageUrl);
    for (const [k, v] of Object.entries(varsParam)) u.searchParams.set(k, v);
    pageUrl = u.toString();
  }

  const errors = [];
  let R = null;
  try {
    R = await openRenderer({ pageUrl, initScript, errors });
    console.log(`[browser] ${R.kind}`);
    console.log(`[page] ${pageUrl}`);
    if (!STILLS && R.duration && Math.abs(R.duration - DURATION) > 1e-6) {
      console.warn(`[warn] page DURATION=${R.duration} but --duration=${DURATION}; using --duration`);
    }

    // Capture-path decision: canvas.toDataURL is much cheaper than a CDP
    // screenshot, but it cannot see DOM overlays and needs preserveDrawingBuffer
    // on WebGL pages.
    let mode = CAPTURE;
    if (mode === 'auto') {
      try {
        mode = await R.ev(({ w, h }) => {
          if (window.__capture === 'canvas' || window.__capture === 'cdp') return window.__capture;
          const cs = [...document.querySelectorAll('canvas')];
          if (cs.length !== 1) return 'cdp';
          if (document.querySelector('[data-dom-overlay]')) return 'cdp';
          const c = cs[0];
          return c.width >= w * 0.99 && c.height >= h * 0.99 ? 'canvas' : 'cdp';
        }, { w: WIDTH, h: HEIGHT });
      } catch { mode = 'cdp'; }
    }
    if (mode === 'canvas') {
      const can = await R.ev(() => document.querySelectorAll('canvas').length === 1);
      if (!can) mode = 'cdp';
    }
    console.log(`[capture] ${mode}`);

    if (WARMUP && !STILLS) {
      try {
        await R.ev((t) => window.renderFrame(t), 0);
        await R.ev(() => new Promise((r) => requestAnimationFrame(() => r(true))));
      } catch { /* warm-up is best effort */ }
    }

    async function grab(t) {
      if (mode === 'canvas') {
        const dataUrl = await R.ev(({ tt, fmt, q }) => {
          window.renderFrame(tt);
          const c = document.querySelector('canvas');
          return c.toDataURL(fmt === 'png' ? 'image/png' : 'image/jpeg', q);
        }, { tt: t, fmt: FORMAT, q: QUALITY });
        const comma = String(dataUrl).indexOf(',');
        if (comma < 0) throw new Error('canvas.toDataURL returned no data');
        const buf = Buffer.from(String(dataUrl).slice(comma + 1), 'base64');
        if (buf.length < 800) throw new Error(`canvas frame suspiciously small (${buf.length} bytes)`);
        return buf;
      }
      await R.ev((tt) => window.renderFrame(tt), t);
      const buf = await R.shot();
      if (buf.length < 800) throw new Error(`CDP frame suspiciously small (${buf.length} bytes)`);
      return buf;
    }

    if (STILLS) {
      fs.mkdirSync(OUTDIR, { recursive: true });
      for (const t of STILLS) {
        let buf;
        try { buf = await grab(t); }
        catch (e) {
          if (mode === 'canvas') { console.warn(`[warn] canvas capture failed (${e.message}); switching to cdp`); mode = 'cdp'; buf = await grab(t); }
          else throw e;
        }
        const ext = FORMAT === 'png' ? 'png' : 'jpg';
        const file = path.join(OUTDIR, `still-${String(t.toFixed(2)).replace('.', '_')}.${ext}`);
        fs.writeFileSync(file, buf);
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
      let buf;
      try { buf = await grab(t); }
      catch (e) {
        if (mode === 'canvas') { console.warn(`[warn] canvas capture failed at frame ${i} (${e.message}); switching to cdp`); mode = 'cdp'; buf = await grab(t); }
        else throw e;
      }
      await writeAsync(ff.stdin, buf);
      if (i % 30 === 0 || i === frames - 1) {
        const el = ((performance.now() - started) / 1000).toFixed(1);
        const fps = (i + 1) / Math.max(0.001, performance.now() / 1000 - started / 1000);
        console.log(`[frame] ${i + 1}/${frames}  t=${t.toFixed(3)}s  elapsed=${el}s  ~${fps.toFixed(1)}fps`);
      }
    }
    ff.stdin.end();
    await ff.done;
    const size = fs.statSync(OUT).size;
    console.log(`[done] ${OUT}  ${frames} frames @${FPS}fps  ${(size / 1024 / 1024).toFixed(2)} MB  capture=${mode}`);
    if (errors.length) console.error('[page errors]', errors.slice(0, 5));
  } finally {
    if (R) await R.close().catch(() => {});
    server.close();
    // Browser keep-alive sockets otherwise hold the process open until the
    // 5 s keepAliveTimeout, which multiplied across 33 segments is real time.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
}

main().catch((e) => { console.error('[fatal]', e && e.stack || e); process.exit(1); });
