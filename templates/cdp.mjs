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
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 杀掉整棵浏览器进程树。
 *
 * Windows 上 proc.kill() 只 TerminateProcess 父进程：renderer / GPU / utility
 * 子进程会活下来，继续占着 --user-data-dir 的 singleton 锁。后果不是「多几个
 * 僵尸」这么轻——下一次 launch 复用同一个 profile 时 Chrome 起不来，重启路径
 * 于是白等一整个 timeout 才报 no renderer available。taskkill /T /F 连子进程
 * 一起收，profile 才真的可复用。
 */
function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true, timeout: 10000,
      });
      if (r.status === 0) return;
    } catch { /* fall through to the single-process kill */ }
  }
  try { proc.kill('SIGKILL'); } catch { /* already gone */ }
}

/**
 * 把 PATH 里的命令名解析成绝对路径。
 * 以前 `CHROME_EXE=google-chrome`（无斜杠、在 PATH 里）会被 fs.existsSync 静默忽略，
 * 于是用户按 CI 文档配置了变量却仍然是「找不到浏览器」。
 */
export function resolveOnPath(name) {
  if (!name || name.includes('/') || name.includes('\\')) return null;
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return null;
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}

/** Ordered list of likely Chrome/Edge/Chromium executables for this OS. */
export function browserCandidates() {
  const out = [];
  const add = (p) => {
    const resolved = p && !fs.existsSync(p) ? (resolveOnPath(p) || p) : p;
    if (resolved && fs.existsSync(resolved) && !out.includes(resolved)) out.push(resolved);
  };
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
    // close() 只是发起关闭握手；对端不回话时 socket 会一直挂着。有 terminate 就用，
    // 确保句柄真的释放（undici 的 WebSocket 没有这个方法，忽略即可）。
    try { this.ws.terminate?.(); } catch { /* ignore */ }
  }
}

async function connect(wsUrl, timeout = 15000) {
  if (typeof WebSocket === 'undefined') throw new Error('Node WebSocket is unavailable; use Node ≥ 22 or install playwright');
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeout) {
    let ws = null;
    try {
      ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + (e.message || 'unknown'))), { once: true });
      });
      return new Cdp(ws);
    } catch (e) {
      lastErr = e;
      // 失败的 WebSocket 必须收掉。留在 CONNECTING/CLOSING 的 socket 会一直持有
      // 事件循环句柄：重试 120s（100ms 一轮）能漏上千个，于是进程打印完 [batch] done
      // 也退不出去，父进程 farm/compile 跟着永远等下去。
      try { ws?.close(); } catch { /* ignore */ }
      try { ws?.terminate?.(); } catch { /* undici 没有 terminate，忽略 */ }
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
  // 上一轮的 DevToolsActivePort 必须删掉：否则下面的等待循环第一轮就读到**旧端口**，
  // 立刻 break，然后 connect() 对着一个已经死掉的 ws 重试满 timeout。
  // 这正是「重启浏览器」既失败又慢的原因（复用 persistent profile 时必然发生）。
  try { fs.unlinkSync(path.join(userDataDir, 'DevToolsActivePort')); } catch { /* none */ }
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
  // 默认保留 Chromium 沙箱：渲染的页面来自 spec，属于不可信输入。
  // 容器 / root 环境确实需要关沙箱时，用 CVS_NO_SANDBOX=1 显式开启（docker/Dockerfile 已设）。
  if (process.platform !== 'win32' && process.env.CVS_NO_SANDBOX === '1') {
    args.unshift('--no-sandbox', '--disable-setuid-sandbox');
  }
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
    killTree(proc);
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
    killTree(proc);
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    // 等进程真的没了再返回：调用方（restart）紧接着要用同一个 profile 起新浏览器，
    // 子进程还活着就会撞 singleton 锁。上限 2s，收不掉也不能把渲染卡死。
    const deadline = Date.now() + 2000;
    while (proc.exitCode === null && proc.signalCode === null && Date.now() < deadline) await sleep(40);
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

/**
 * 起浏览器，失败重试。
 *
 * 负载重的机器上 Chrome 冷启动可能超过单次预算（实测全套并发时 30s 不够），
 * 而「浏览器起不来」与「页面坏了」是两回事：前者重试一次通常就好，后者重试也没用。
 * 与 test-reflow-pages 的 renderStill 两次尝试约定一致。产品侧的重试在 render-batch
 * （段级重试 + 浏览器重启），这里只给直接调 launch 的测试用。
 */
export async function launchRetry(opts = {}, attempts = 2) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await launch(opts); }
    catch (e) {
      last = e;
      if (i < attempts) await sleep(500);
    }
  }
  throw last;
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
export async function waitFor(client, sessionId, fn, {
  timeout = 120000, interval = 80, label = 'condition', warnAfter = 30000, warn = null,
} = {}) {
  const started = Date.now();
  let lastErr = null;
  let warned = false;
  while (Date.now() - started < timeout) {
    try {
      const v = await evaluate(client, sessionId, fn);
      if (v) return v;
    } catch (e) { lastErr = e; }
    const elapsed = Date.now() - started;
    // 卡住要看得见。重启浏览器后的首个页面若迟迟不 ready，以前会静默到 timeout
    // （默认 120s）才报错，日志上看起来像挂死。超过 warnAfter 先告警一次。
    if (!warned && typeof warn === 'function' && elapsed >= warnAfter) {
      warned = true;
      try {
        warn(`[wait] ${label} still pending after ${(elapsed / 1000).toFixed(0)}s (budget ${(timeout / 1000).toFixed(0)}s)${lastErr ? `: ${lastErr.message}` : ''}`);
      } catch { /* 告警失败不影响等待 */ }
    }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}
