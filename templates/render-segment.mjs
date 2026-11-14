#!/usr/bin/env node
/**
 * render-segment.mjs v3 — render one HTML segment to MP4, frame by frame.
 *
 *   node render-segment.mjs --page segments/01.html --out out/01.mp4 --duration 3
 *   node render-segment.mjs --page segments/09.html --out out/09.mp4 --duration 3 --t0 0.35 --speed 1.4
 *   node render-segment.mjs --page segments/01.html --still 0.2,0.8,1.4 --outdir out/stills
 *
 * v3 keeps the CLI and the pixel pipeline byte-for-byte identical, and adds a
 * reusable module surface so one process can render many segments with a single
 * static server and a single browser (the SwiftShader startup is the dominant
 * cost of a 23-segment film):
 *
 *   import { withRenderer, renderSegment } from './render-segment.mjs';
 *
 *   await withRenderer({ root, width, height, browser }, async (ctx) => {
 *     for (const seg of plan.segments) {
 *       await ctx.render(segOptions);        // one page, one ffmpeg, same frames
 *     }
 *   });
 *
 * `renderSegment(options)` still does the whole single-segment job (server +
 * browser + ffmpeg) and is what the CLI calls. `withRenderer(options, fn)` owns
 * the server + browser and hands `fn` a context whose `render()` / `stills()`
 * methods take the same option names as the CLI.
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
import { fileURLToPath } from 'node:url';
import { launch as launchCdp, evaluate as cdpEvaluate, waitFor as cdpWaitFor } from './cdp.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
};

// ---------- tiny arg parser ----------

/** Parse an argv slice (`--key value`, `--flag`) into a plain object. */
export function parseArgv(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const bool = (v, d) => (v === undefined ? d : !(v === false || v === 'false' || v === '0'));

function parseStills(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  return String(v).split(',').map(Number).filter(Number.isFinite);
}

function loadVars(v, root) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  const s = String(v);
  if (s.trim().startsWith('{')) return JSON.parse(s);
  return JSON.parse(fs.readFileSync(path.resolve(root, s), 'utf8'));
}

/** Map parsed CLI args to the plain options object renderSegment() accepts. */
export function optionsFromArgs(args) {
  const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
  const str = (k, d) => (args[k] === undefined ? d : String(args[k]));
  const root = path.resolve(str('root', process.cwd()));
  return {
    page: args.page === undefined ? null : String(args.page),
    out: args.out === undefined ? null : String(args.out),
    duration: num('duration', 3),
    t0: num('t0', 0),
    speed: num('speed', 1),
    fps: num('fps', 30),
    width: num('width', 1920),
    height: num('height', 1080),
    root,
    port: num('port', 0),
    crf: num('crf', 12),
    preset: str('preset', 'veryfast'),
    tune: str('tune', ''),
    quality: num('quality', 92),
    format: str('format', 'jpeg'),
    capture: str('capture', 'auto'),
    headed: !!args.headed,
    timeout: num('timeout', 120000),
    launchTimeout: num('launch-timeout', 30000),
    warmup: args['no-warmup'] ? false : bool(args.warmup, true),
    optimize: args['no-optimize'] ? false : bool(args.optimize, true),
    still: args.still === undefined ? null : String(args.still),
    outdir: args.outdir === undefined ? null : String(args.outdir),
    vars: args.vars === undefined ? null : String(args.vars),
    browser: args.browser === undefined ? null : String(args.browser),
    cdp: !!args.cdp,
    noPlaywright: !!args['no-playwright'],
    profileDir: args['profile-dir'] === undefined ? null : String(args['profile-dir']),
    removeProfile: !!args['remove-profile'],
  };
}

/**
 * Normalise any supported option spelling into the canonical object used by
 * the renderer. Paths are resolved once here so callers may pass relative paths.
 */
export function normalizeOptions(raw = {}) {
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  const str = (v, d) => (v === undefined || v === null ? d : String(v));
  const root = path.resolve(str(raw.root, process.cwd()));
  const width = num(raw.width, 1920);
  const height = num(raw.height, 1080);
  const stills = parseStills(raw.stills !== undefined ? raw.stills : raw.still);
  const outdir = path.resolve(str(raw.outdir, path.join(root, 'out', 'stills')));
  const browser = raw.browser ? path.resolve(String(raw.browser)) : (process.env.CHROME_EXE || null);
  const log = typeof raw.log === 'function' ? raw.log : (line) => console.log(line);
  const warn = typeof raw.warn === 'function' ? raw.warn : (line) => console.warn(line);
  return {
    page: raw.page === undefined || raw.page === null ? null : String(raw.page),
    out: raw.out ? path.resolve(String(raw.out)) : null,
    duration: num(raw.duration, 3),
    t0: num(raw.t0, 0),
    speed: num(raw.speed, 1),
    fps: num(raw.fps, 30),
    width,
    height,
    root,
    port: num(raw.port, 0),
    crf: num(raw.crf, 12),
    preset: str(raw.preset, 'veryfast'),
    tune: str(raw.tune, ''),
    format: String(str(raw.format, 'jpeg')).toLowerCase() === 'png' ? 'png' : 'jpeg',
    quality: num(raw.quality, 92),
    capture: str(raw.capture, 'auto'),
    headed: !!raw.headed,
    timeout: num(raw.timeout, 120000),
    // 浏览器**启动**超时与页面 ready 超时必须分开：页面可以慢（SwiftShader 首帧），
    // 但一个起不来的浏览器不该继承 120s 的页面预算，把失败路径拖成两分钟空等。
    launchTimeout: num(raw.launchTimeout, 30000),
    warmup: raw.warmup !== undefined ? bool(raw.warmup, true) : true,
    optimize: raw.optimize !== undefined ? bool(raw.optimize, true) : true,
    stills,
    outdir,
    vars: loadVars(raw.vars, root),
    ffmpeg: process.env.FFMPEG_EXE || 'ffmpeg',
    browser,
    cdp: !!raw.cdp,
    noPlaywright: !!raw.noPlaywright,
    profileDir: raw.profileDir ? path.resolve(String(raw.profileDir)) : null,
    removeProfile: !!raw.removeProfile,
    log,
    warn,
  };
}

/** Turn a plan segment's `renderArgs` array into canonical options. */
export function optionsFromRenderArgs(renderArgs, extra = {}) {
  const args = parseArgv(renderArgs || []);
  return normalizeOptions({ ...optionsFromArgs(args), ...extra });
}

// ---------- static server ----------

export function startStaticServer(root, port = 0) {
  return new Promise((resolve, reject) => {
    const ROOT = path.resolve(root);
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (urlPath === '/favicon.ico') { res.writeHead(204).end(); return; }
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        // 点文件（.git/、.env…）不提供——渲染服务器也会被外部请求碰到。
        if (urlPath.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')) {
          res.writeHead(404).end('404'); return;
        }
        const file = path.resolve(ROOT, '.' + urlPath);
        if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }
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
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ---------- ffmpeg ----------

function launchFfmpeg(outFile, opts) {
  const input = ['-f', 'image2pipe', '-framerate', String(opts.fps), '-i', 'pipe:0'];
  const filters = [
    'scale=in_range=pc:out_range=tv:out_color_matrix=bt709',
    'format=yuv420p',
  ].join(',');
  const codec = [
    '-c:v', 'libx264', '-preset', opts.preset, '-crf', String(opts.crf),
    ...(opts.tune ? ['-tune', opts.tune] : []),
    // R2-11：段编码也钉死线程 + bitexact——帧渲染确定（golden 静帧稳定），
    // 但 x264 auto 线程数会让段 mp4 逐次不同，破坏 master 幂等。与 concat 链一致。
    '-threads', '2', '-x264-params', 'threads=2:lookahead_threads=1:rc-lookahead=10',
    '-fflags', '+bitexact', '-flags', '+bitexact',
    '-vf', filters,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '90000',
    '-movflags', '+faststart', outFile,
  ];
  const p = spawn(opts.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...input, ...codec], { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => {
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + ': ' + err.slice(0, 800)))));
  });
  // 渲染中途抛错（页面 renderFrame 抛异常 / 抓帧失败）时必须能杀掉 ffmpeg：
  // 它一直等 stdin，管道句柄让 Node 事件循环不退出。症状是「batch 打印了
  // done 但进程挂住」，看起来像卡死，实际是一个没被清理的子进程。
  const kill = () => {
    try { p.stdin.destroy(); } catch { /* ignore */ }
    try { p.kill('SIGKILL'); } catch { /* ignore */ }
  };
  return { stdin: p.stdin, done, kill };
}

function writeAsync(stream, buf) {
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

// ---------- URL ----------

function withSegmentParams(page, port, t) {
  const u = new URL(`http://127.0.0.1:${port}/${page.replace(/^\/+/, '')}`);
  u.searchParams.set('seg', '1');
  u.searchParams.set('t0', String(t.t0));
  u.searchParams.set('speed', String(t.speed));
  u.searchParams.set('dur', String(t.duration));
  return u.toString();
}

function buildPageUrl(page, port, t) {
  let pageUrl = /^https?:\/\//.test(page) ? page : withSegmentParams(page, port, t);
  if (t.vars) {
    const u = new URL(pageUrl);
    u.searchParams.set('vars', Buffer.from(JSON.stringify(t.vars)).toString('base64url'));
    pageUrl = u.toString();
  }
  return pageUrl;
}

// ---------- page adapters ----------

async function openPlaywright(opts) {
  let chromium;
  try { chromium = (await import('playwright')).chromium; }
  catch { chromium = (await import('playwright-core')).chromium; }

  const launchArgs = [
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions',
    '--run-all-compositor-stages-before-draw', '--disable-frame-rate-limit', '--force-color-profile=srgb',
    '--disable-lcd-text', '--font-render-hinting=none',
  ];
  if (process.platform !== 'win32') {
    launchArgs.push('--disable-dev-shm-usage');
    // 沙箱默认开启；容器 / root 环境用 CVS_NO_SANDBOX=1 显式关闭（docker/Dockerfile 已设）。
    if (process.env.CVS_NO_SANDBOX === '1') launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  const browser = await chromium.launch({
    headless: !opts.headed,
    args: launchArgs,
    ...(opts.browser ? { executablePath: opts.browser } : {}),
  });
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  return {
    kind: 'playwright',
    async newPage({ url, initScript, width = opts.width, height = opts.height }) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      try {
        await page.setViewportSize({ width, height });
        if (initScript) await page.addInitScript({ content: initScript });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
        await page.waitForFunction('window.__ready === true || window.__bootError', null, { timeout: opts.timeout });
        const bootError = await page.evaluate(() => window.__bootError || null);
        if (bootError) throw new Error('page boot error: ' + bootError);
        await page.evaluate(() => document.fonts.ready);

        const cdp = await context.newCDPSession(page);
        const ev = (fn, arg) => page.evaluate(fn, arg);
        const shot = async () => {
          const r = await cdp.send('Page.captureScreenshot', {
            format: opts.format, ...(opts.format === 'jpeg' ? { quality: opts.quality } : {}),
            fromSurface: true, captureBeyondViewport: false,
            ...(opts.optimize ? { optimizeForSpeed: true } : {}),
            clip: { x: 0, y: 0, width, height, scale: 1 },
          });
          return Buffer.from(r.data, 'base64');
        };
        const duration = await page.evaluate(() => window.DURATION ?? null);
        return { kind: 'playwright', ev, shot, errors, duration, close: () => page.close() };
      } catch (e) {
        await page.close().catch(() => {});
        throw e;
      }
    },
    close: () => browser.close(),
  };
}

async function openCdp(opts) {
  const b = await launchCdp({
    executablePath: opts.browser || undefined,
    width: opts.width,
    height: opts.height,
    headed: opts.headed,
    timeout: opts.launchTimeout,
    profileDir: opts.profileDir,
    removeProfile: opts.removeProfile,
  });
  return {
    kind: 'cdp',
    async newPage({ url, initScript, width = opts.width, height = opts.height }) {
      const p = await b.createPage({ width, height });
      const errors = [];
      const offs = [
        b.client.on('Runtime.exceptionThrown', (params, sid) => {
          if (sid !== p.sessionId) return;
          errors.push(params?.exceptionDetails?.exception?.description || params?.exceptionDetails?.text || 'page exception');
          // 模块加载失败（404 依赖）时模块体不执行，__ready/__bootError 都不会置位。
          // 立一个旗标让 ready 等待提前退出，而不是烧满 timeout。
          cdpEvaluate(b.client, p.sessionId, () => { if (!window.__ready) window.__pageException = true; }).catch(() => {});
        }),
        b.client.on('Runtime.consoleAPICalled', (params, sid) => {
          if (sid !== p.sessionId) return;
          if (params.type === 'error') errors.push('console: ' + (params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
        }),
      ];
      try {
        if (initScript) {
          await b.client.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, p.sessionId);
        }
        await b.client.send('Page.navigate', { url }, p.sessionId);
        await cdpWaitFor(b.client, p.sessionId, 'document.readyState === "complete" || document.readyState === "interactive"', { timeout: opts.timeout, label: 'document load', warn: opts.warn });
        await cdpWaitFor(b.client, p.sessionId, 'window.__ready === true || !!window.__bootError || !!window.__pageException', { timeout: opts.timeout, label: 'window.__ready', warn: opts.warn });
        const bootError = await cdpEvaluate(b.client, p.sessionId, () => window.__bootError || null);
        if (bootError) throw new Error('page boot error: ' + bootError);
        const isReady = await cdpEvaluate(b.client, p.sessionId, () => window.__ready === true);
        if (!isReady && errors.length) throw new Error('page boot error: ' + errors[0]);
        await cdpEvaluate(b.client, p.sessionId, () => document.fonts.ready);

        const ev = (fn, arg) => cdpEvaluate(b.client, p.sessionId, fn, arg);
        const shot = async () => {
          const r = await b.client.send('Page.captureScreenshot', {
            format: opts.format, ...(opts.format === 'jpeg' ? { quality: opts.quality } : {}),
            fromSurface: true, captureBeyondViewport: false,
            ...(opts.optimize ? { optimizeForSpeed: true } : {}),
            clip: { x: 0, y: 0, width, height, scale: 1 },
          }, p.sessionId);
          return Buffer.from(r.data, 'base64');
        };
        const duration = await cdpEvaluate(b.client, p.sessionId, () => window.DURATION ?? null);
        return { kind: 'cdp', ev, shot, errors, duration, close: async () => { for (const off of offs) off(); await p.close(); } };
      } catch (e) {
        for (const off of offs) off();
        await p.close().catch(() => {});
        throw e;
      }
    },
    close: () => b.close(),
  };
}

/** Open one browser (Playwright when installed, raw CDP otherwise). */
export async function openBrowser(opts) {
  const tried = [];
  if (!opts.cdp && !opts.noPlaywright) {
    try { return await openPlaywright(opts); }
    catch (e) { tried.push(`playwright: ${String(e.message).split('\n')[0]}`); }
  }
  try { return await openCdp(opts); }
  catch (e) { tried.push(`cdp: ${String(e.message).split('\n')[0]}`); }
  throw new Error('no renderer available:\n  - ' + tried.join('\n  - '));
}

// ---------- capture ----------

async function resolveCaptureMode(page, opts) {
  let mode = opts.capture;
  if (mode === 'auto') {
    try {
      mode = await page.ev(({ w, h }) => {
        if (window.__capture === 'canvas' || window.__capture === 'cdp') return window.__capture;
        const cs = [...document.querySelectorAll('canvas')];
        if (cs.length !== 1) return 'cdp';
        if (document.querySelector('[data-dom-overlay]')) return 'cdp';
        const c = cs[0];
        return c.width >= w * 0.99 && c.height >= h * 0.99 ? 'canvas' : 'cdp';
      }, { w: opts.width, h: opts.height });
    } catch { mode = 'cdp'; }
  }
  if (mode === 'canvas') {
    const can = await page.ev(() => document.querySelectorAll('canvas').length === 1);
    if (!can) mode = 'cdp';
  }
  return mode;
}

async function grab(page, t, mode, opts) {
  if (mode === 'canvas') {
    const dataUrl = await page.ev(({ tt, fmt, q }) => {
      window.renderFrame(tt);
      const c = document.querySelector('canvas');
      return c.toDataURL(fmt === 'png' ? 'image/png' : 'image/jpeg', q);
    }, { tt: t, fmt: opts.format, q: opts.quality });
    const comma = String(dataUrl).indexOf(',');
    if (comma < 0) throw new Error('canvas.toDataURL returned no data');
    const buf = Buffer.from(String(dataUrl).slice(comma + 1), 'base64');
    if (buf.length < 800) throw new Error(`canvas frame suspiciously small (${buf.length} bytes)`);
    return buf;
  }
  await page.ev((tt) => window.renderFrame(tt), t);
  const buf = await page.shot();
  if (buf.length < 800) throw new Error(`CDP frame suspiciously small (${buf.length} bytes)`);
  return buf;
}

// ---------- renderer context ----------

/**
 * Start one static server and one browser, then run `fn(ctx)`.
 *
 * ctx.openPage(pageOpts) → { url, kind, ev, shot, errors, duration, close }
 * ctx.render(pageOpts)   → render one segment to MP4 (same options as CLI)
 * ctx.stills(pageOpts)   → render stills (same options as CLI)
 * ctx.restart()          → replace the browser (retry path)
 */
export async function withRenderer(rawOptions, fn) {
  const opts = normalizeOptions(rawOptions);
  const server = await startStaticServer(opts.root, opts.port);
  const port = server.address().port;
  let browser = null;
  let restarts = 0;
  const baseProfileDir = opts.profileDir;

  const pageOptions = (pageOpts = {}) => {
    const merged = normalizeOptions({ ...opts, ...pageOpts, root: opts.root, log: opts.log, warn: opts.warn });
    // normalizeOptions would re-read --vars; page-level vars win when given.
    merged.vars = pageOpts.vars !== undefined ? loadVars(pageOpts.vars, opts.root) : opts.vars;
    return merged;
  };

  const ctx = {
    root: opts.root,
    port,
    origin: `http://127.0.0.1:${port}`,
    opts,
    get browser() { return browser; },
    get kind() { return browser ? browser.kind : null; },

    async openPage(pageOpts = {}) {
      const o = pageOptions(pageOpts);
      const page = o.page || opts.page;
      if (!page) throw new Error('--page is required');
      const url = buildPageUrl(page, port, { t0: o.t0, speed: o.speed, duration: o.duration, vars: o.vars });
      const initScript = o.vars ? `window.__vars = ${JSON.stringify(o.vars)};` : '';
      const log = typeof pageOpts.log === 'function' ? pageOpts.log : opts.log;
      log(`[page] ${url}`);
      if (!browser) throw new Error('renderer is not running');
      const p = await browser.newPage({ url, initScript, width: o.width, height: o.height });
      p.url = url;
      p.log = log;
      return p;
    },

    async render(pageOpts = {}) {
      return renderVideo(ctx, pageOptions(pageOpts), pageOpts);
    },

    async stills(pageOpts = {}) {
      return renderStills(ctx, pageOptions(pageOpts), pageOpts);
    },

    async restart() {
      const old = browser;
      browser = null;
      if (old) await old.close().catch(() => {});
      // 恢复路径换一个全新的 profile 目录。被杀/崩溃的浏览器可能把 singleton 锁、
      // 半写的 Local State 留在旧目录里；复用它等于把「能不能恢复」押在上一次死得
      // 够干净上。profile 只是浏览器状态，帧缓存是 .cache，换目录不损失任何复用。
      restarts += 1;
      const next = baseProfileDir ? { ...opts, profileDir: `${baseProfileDir}-r${restarts}` } : opts;
      browser = await openBrowser(next);
      opts.log(`[browser] ${browser.kind}${restarts > 1 ? ` (restart ${restarts})` : ''}`);
      return browser.kind;
    },
  };

  try {
    browser = await openBrowser(opts);
    opts.log(`[browser] ${browser.kind}`);
    return await fn(ctx);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    // Browser keep-alive sockets otherwise hold the process open until the
    // 5 s keepAliveTimeout, which multiplied across 33 segments is real time.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
}

async function preparePage(ctx, opts, pageOpts) {
  const page = await ctx.openPage(pageOpts);
  try {
    const mode = await resolveCaptureMode(page, opts);
    page.log(`[capture] ${mode}`);
    page.mode = mode;
    return page;
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

async function warmUp(page, opts) {
  if (!opts.warmup) return;
  try {
    await page.ev((t) => window.renderFrame(t), 0);
    await page.ev(() => new Promise((r) => requestAnimationFrame(() => r(true))));
  } catch { /* warm-up is best effort */ }
}

async function renderVideo(ctx, opts, rawPageOpts = {}) {
  if (!opts.out) throw new Error('--out is required (or use --still)');
  const page = await preparePage(ctx, opts, rawPageOpts);
  try {
    if (page.duration && Math.abs(page.duration - opts.duration) > 1e-6) {
      opts.warn(`[warn] page DURATION=${page.duration} but --duration=${opts.duration}; using --duration`);
    }
    await warmUp(page, opts);

    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    const frames = Math.round(opts.duration * opts.fps);
    const ff = launchFfmpeg(opts.out, opts);
    const started = performance.now();
    try {
      for (let i = 0; i < frames; i++) {
        const t = i / opts.fps;
        let buf;
        try { buf = await grab(page, t, page.mode, opts); }
        catch (e) {
          if (page.mode === 'canvas') {
            page.log(`[warn] canvas capture failed at frame ${i} (${e.message}); switching to cdp`);
            page.mode = 'cdp';
            buf = await grab(page, t, page.mode, opts);
          } else throw e;
        }
        await writeAsync(ff.stdin, buf);
        if (i % 30 === 0 || i === frames - 1) {
          const sec = (performance.now() - started) / 1000;
          const fps = (i + 1) / Math.max(0.001, sec);
          page.log(`[frame] ${i + 1}/${frames}  t=${t.toFixed(3)}s  elapsed=${sec.toFixed(1)}s  ~${fps.toFixed(1)}fps`);
        }
      }
      ff.stdin.end();
      await ff.done;
    } catch (e) {
      // 抓帧失败：杀掉 ffmpeg，避免它的 stdin 管道把进程留住。
      // kill 之后 done 必然 reject（exit null），必须消费掉，否则成为未处理拒绝。
      ff.kill();
      try { await ff.done; } catch { /* expected after kill */ }
      throw e;
    }
    const size = fs.statSync(opts.out).size;
    page.log(`[done] ${opts.out}  ${frames} frames @${opts.fps}fps  ${(size / 1024 / 1024).toFixed(2)} MB  capture=${page.mode}`);
    if (page.errors.length) opts.warn('[page errors] ' + page.errors.slice(0, 5).join(' | '));
    return { out: opts.out, frames, seconds: (performance.now() - started) / 1000, capture: page.mode, errors: page.errors.slice(0, 5) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function renderStills(ctx, opts, rawPageOpts = {}) {
  const stills = opts.stills || [];
  const page = await preparePage(ctx, opts, rawPageOpts);
  try {
    fs.mkdirSync(opts.outdir, { recursive: true });
    for (const t of stills) {
      let buf;
      try { buf = await grab(page, t, page.mode, opts); }
      catch (e) {
        if (page.mode === 'canvas') {
          page.log(`[warn] canvas capture failed (${e.message}); switching to cdp`);
          page.mode = 'cdp';
          buf = await grab(page, t, page.mode, opts);
        } else throw e;
      }
      const ext = opts.format === 'png' ? 'png' : 'jpg';
      const file = path.join(opts.outdir, `still-${String(t.toFixed(2)).replace('.', '_')}.${ext}`);
      fs.writeFileSync(file, buf);
      page.log(`[still] ${file}`);
    }
    page.log(`[done] ${stills.length} stills -> ${opts.outdir}`);
    if (page.errors.length) opts.warn('[page errors] ' + page.errors.slice(0, 5).join(' | '));
    return { stills: stills.length, outdir: opts.outdir, files: stills.map((t) => path.join(opts.outdir, `still-${String(t.toFixed(2)).replace('.', '_')}.${opts.format === 'png' ? 'png' : 'jpg'}`)) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Render exactly one segment (or its stills). Starts its own server and
 * browser, so this is the "cold" single-segment entry point. For many
 * segments use withRenderer() to amortise the browser startup.
 */
export async function renderSegment(rawOptions) {
  const opts = normalizeOptions(rawOptions);
  return withRenderer(opts, async (ctx) => {
    if (opts.stills) return ctx.stills({});
    return ctx.render({});
  });
}

// ---------- CLI ----------

const USAGE = `Usage: node render-segment.mjs --page <path-or-url> [options]
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
  --launch-timeout <ms>   browser start timeout, default 30000 (kept separate from
                          --timeout so a browser that cannot start fails fast)
  --browser <path>        explicit Chrome/Edge executable
  --profile-dir <dir>     persistent Chrome profile (default: temp, removed)
  --remove-profile        delete the persistent profile on exit
  --cdp                   skip Playwright, use raw CDP
  --no-playwright         same as --cdp

Relative --page paths get ?seg=1&t0=&speed=&dur= appended automatically.
A page can force the capture path with window.__capture = 'canvas' | 'cdp'.`;

const isMain = (() => {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = path.resolve(fileURLToPath(import.meta.url));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
})();

if (isMain) {
  const args = parseArgv(process.argv.slice(2));
  if (args.help || !args.page) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  renderSegment(optionsFromArgs(args))
    .then((r) => {
      if (r && r.frames !== undefined && r.frames === 0) process.exitCode = 1;
    })
    .catch((e) => { console.error('[fatal]', e && e.stack || e); process.exit(1); });
}
