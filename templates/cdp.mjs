/**
 * cdp.mjs — zero-dependency Chrome DevTools Protocol driver.
 *
 * render-segment.mjs uses Playwright when it is installed, but the skill must
 * also work on a clean machine that only has Chrome or Edge. This module launches
 * a real browser with --remote-debugging-port=0, reads DevToolsActivePort, and
 * talks the flat CDP protocol over Node's built-in WebSocket (Node ≥ 22).
 *
 * No npm packages, no bundled browser, no telemetry.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ordered list of likely Chrome/Edge/Chromium executables for this OS. */
export function browserCandidates() {
  const out = [];
  const add = (p) => { if (p && fs.existsSync(p) && !out.includes(p)) out.push(p); };
  if (process.env.CHROME_EXE) add(process.env.CHROME_EXE);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) add(process.env.PUPPETEER_EXECUTABLE_PATH);
  if (process.platform === 'win32') {
    const env = (name) => {
      const hit = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
      return hit ? process.env[hit] : undefined;
    };
    const roots = [env('PROGRAMFILES'), env('PROGRAMFILES(X86)'), env('LOCALAPPDATA')];
    for (const r of roots) {
      if (!r) continue;
      add(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add(path.join(r, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'));
      add(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      add(path.join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    const home = os.homedir();
    add(path.join(home, '.local', 'opt', 'chrome-for-testing', 'chrome-linux64', 'chrome'));
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) add(p);
  }
  return out;
}

/** Minimal CDP client over one browser WebSocket. */
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const cb of this.handlers.get(msg.method) || []) cb(msg.params, msg.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
    return () => {
      const arr = this.handlers.get(method) || [];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  close() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function connect(wsUrl, timeout = 15000) {
  if (typeof WebSocket === 'undefined') throw new Error('Node WebSocket is unavailable; use Node ≥ 22 or install playwright');
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeout) {
    try {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + (e.message || 'unknown'))), { once: true });
      });
      return new Cdp(ws);
    } catch (e) {
      lastErr = e;
      await sleep(100);
    }
  }
  throw lastErr || new Error('could not connect to Chrome');
}

/**
 * Launch a headless browser and return a session bound to one page.
 *
 * Options:
 *   profileDir     use this directory as --user-data-dir (persistent). Default
 *                  is a fresh temp profile that is removed on close.
 *   removeProfile  delete the persistent profile on close (default false).
 *   extraArgs      extra Chrome flags (appended verbatim).
 *
 * The returned object also exposes `createPage()` so one browser can render
 * many segments without paying the (expensive) SwiftShader startup each time.
 *
 * @returns {Promise<{client:Cdp, sessionId:string, targetId:string, executable:string, createPage:Function, close:()=>Promise<void>}>}
 */
export async function launch({
  executablePath, width = 1920, height = 1080, headed = false, timeout = 20000,
  profileDir = null, removeProfile = false, extraArgs = [],
} = {}) {
  const exe = executablePath || browserCandidates()[0];
  if (!exe) throw new Error('no Chrome/Edge/Chromium found; set CHROME_EXE or install playwright');
  const persistent = !!profileDir;
  const userDataDir = persistent
    ? path.resolve(String(profileDir))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'cvshow-cdp-'));
  if (persistent) {
    fs.mkdirSync(userDataDir, { recursive: true });
    // A crashed previous run can leave singleton locks behind and make Chrome
    // silently hand off to the dead instance (or refuse to start).
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try { fs.unlinkSync(path.join(userDataDir, f)); } catch { /* none */ }
    }
  }
  const args = [
    headed ? '--new-window' : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--disable-extensions', '--metrics-recording-only',
    '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
    '--run-all-compositor-stages-before-draw', '--disable-frame-rate-limit', '--disable-gpu-vsync',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--disable-search-engine-choice-screen',
    ...extraArgs,
    'about:blank',
  ];
  if (process.platform !== 'win32') args.unshift('--no-sandbox', '--disable-setuid-sandbox');
  // Write browser stderr to a file instead of a pipe: orphaned GPU/renderer
  // children can keep a pipe open and delay the parent process exit on Windows.
  const logPath = path.join(userDataDir, 'stderr.log');
  const logFd = fs.openSync(logPath, 'w');
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', logFd], windowsHide: true });
  proc.unref();
  const readStderr = () => {
    try { return fs.readFileSync(logPath, 'utf8').slice(-4000); } catch { return ''; }
  };

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let port = 0, wsPath = '';
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      port = parseInt(txt[0], 10);
      wsPath = txt[1] || '';
      if (port && wsPath) break;
    }
    if (proc.exitCode !== null) break;
    await sleep(60);
  }
  if (!port || !wsPath) {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    throw new Error(`browser did not expose DevToolsActivePort. ${readStderr().slice(0, 400)}`);
  }

  const client = await connect(`ws://127.0.0.1:${port}${wsPath}`, timeout);

  /** Create a fresh tab bound to a flat CDP session with the given viewport. */
  async function createPage({ width: w = width, height: h = height } = {}) {
    const { targetId: tid } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId: tid, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false,
      screenWidth: w, screenHeight: h,
    }, sessionId);
    return {
      sessionId,
      targetId: tid,
      close: async () => {
        try { await client.send('Target.closeTarget', { targetId: tid }); } catch { /* already gone */ }
      },
    };
  }

  const first = await createPage({ width, height });
  const { sessionId, targetId } = first;

  const close = async () => {
    try { await first.close(); } catch { /* ignore */ }
    client.close();
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    await sleep(40);
    // Removing a Chrome profile synchronously can take seconds on Windows (and
    // would delay every render). Hand it to a detached, unref'd process.
    if (persistent && !removeProfile) return;
    try {
      const [c, a] = process.platform === 'win32'
        ? ['cmd', ['/c', 'rmdir', '/s', '/q', userDataDir]]
        : ['rm', ['-rf', userDataDir]];
      spawn(c, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch { /* ignore */ }
  };

  return { client, sessionId, targetId, executable: exe, createPage, userDataDir, close };
}

/** Evaluate an expression or function-with-arg inside the page. */
export async function evaluate(client, sessionId, fn, arg) {
  const expression = typeof fn === 'function' ? `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})` : String(fn);
  const res = await client.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(d.exception?.description || d.text || 'page evaluation failed');
  }
  return res.result?.value;
}

/** Poll a page expression until truthy. */
export async function waitFor(client, sessionId, fn, { timeout = 120000, interval = 80, label = 'condition' } = {}) {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeout) {
    try {
      const v = await evaluate(client, sessionId, fn);
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}
