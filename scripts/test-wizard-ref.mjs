#!/usr/bin/env node
/**
 * test-wizard-ref.mjs — Wizard 参考图上传的端到端验收（真实 Chrome）。
 *
 *   CHROME_EXE="..." node scripts/test-wizard-ref.mjs
 *
 * 断言：
 *   1. Wizard 就绪；初始 spec 可读
 *   2. applyReferenceDataUrl(赛博霓虹预览板) → theme=cyber-neon，accent 为 #hex
 *   3. spec.meta.reference 写入置信度/候选；look.density 可选写入
 *   4. 页面出现 3 个候选 chip，状态文字含「识别」
 *   5. 点候选（applyReferenceTheme）可切换主题并重生成 spec
 *
 * 退出码 0/1。零 npm 依赖。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, evaluate, waitFor, browserCandidates, launchRetry } from '../templates/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

async function main() {
  const candidates = browserCandidates();
  if (!candidates.length) { console.error('no Chrome/Edge found; set CHROME_EXE'); process.exit(1); }

  // 临时端口（--port 0）避免与并行套件/占用冲突；从 stdout 解析实际绑定端口。
  const server = spawn(process.execPath, ['app/wizard/serve.mjs', '--port', '0'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let serverLog = '';
  let port = 0;
  let exited = false;
  server.on('exit', () => { exited = true; });
  server.stdout.on('data', (d) => { serverLog += String(d); });
  server.stderr.on('data', (d) => { serverLog += String(d); });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('wizard server did not start: ' + serverLog.slice(-400))), 15000);
    server.stdout.on('data', (d) => {
      const m = String(d).match(/open\s+http:\/\/[\d.]+:(\d+)\//);
      if (m) { port = Number(m[1]); clearTimeout(t); resolve(); }
    });
    server.on('exit', () => { clearTimeout(t); reject(new Error('wizard server exited early: ' + serverLog.slice(-400))); });
  });
  if (exited || !port) throw new Error('wizard server failed to bind: ' + serverLog.slice(-400));

  let browser = null;
  try {
    browser = await launchRetry({
      executablePath: process.env.CHROME_EXE || candidates[0],
      width: 1440, height: 900, timeout: 30000,
    });
    const { client, sessionId } = browser;
    const url = `http://127.0.0.1:${port}/app/wizard/`;
    console.log(`[wizard] ${url}`);
    await client.send('Page.navigate', { url }, sessionId);
    await sleep(800);

    const ready = await waitFor(client, sessionId, () => !!(window.__wizard && window.__wizard.spec), { timeout: 30000, label: 'wizard ready' });
    if (!ready) throw new Error('wizard did not become ready: ' + serverLog.slice(-400));
    check('wizard ready', ready === true);

    const before = await evaluate(client, sessionId, () => ({
      theme: window.__wizard.spec.look.theme,
      hasRef: !!window.__wizard.spec.meta.reference,
    }));
    check('initial spec readable', !!before.theme, before.theme);

    const ref = await evaluate(client, sessionId, async () => {
      const r = await window.__wizard.applyReferenceDataUrl('/assets/theme-previews/09-cyber-neon.jpg');
      return r ? {
        id: r.theme.id,
        confidence: r.theme.confidence,
        candidates: r.theme.candidates.map((c) => c.id),
        accent: typeof r.theme.accentOverride === 'string' ? r.theme.accentOverride : (r.theme.accentOverride && r.theme.accentOverride.accent),
        palette: r.palette.length,
      } : null;
    });
    check('reference analyzed', !!ref, ref && ref.id);
    check('theme = cyber-neon', ref && ref.id === 'cyber-neon', ref && ref.id);
    check('3 candidates', ref && ref.candidates.length === 3, ref && ref.candidates.join(','));
    check('accent is #hex', ref && /^#[0-9a-f]{6}$/i.test(ref.accent || ''), ref && ref.accent);

    const after = await evaluate(client, sessionId, () => {
      const ao = window.__wizard.spec.look.accentOverride;
      return {
      theme: window.__wizard.spec.look.theme,
      accent: typeof ao === 'string' ? ao : (ao && ao.accent),
      reference: window.__wizard.spec.meta.reference || null,
      status: (document.querySelector('#ref-status') || {}).textContent || '',
      chips: document.querySelectorAll('#ref-candidates button').length,
      };
    });
    check('spec.look.theme updated', after.theme === 'cyber-neon', after.theme);
    check('spec.look.accentOverride updated', /^#[0-9a-f]{6}$/i.test(after.accent || ''), after.accent);
    check('spec.meta.reference written', !!after.reference && after.reference.source === 'upload', JSON.stringify(after.reference && after.reference.candidates));
    check('candidate chips rendered', after.chips === 3, String(after.chips));
    check('status mentions 识别', after.status.includes('识别'), after.status.slice(0, 40));

    const switched = await evaluate(client, sessionId, () => {
      const ok = window.__wizard.applyReferenceTheme('graphite-signal');
      return { ok, theme: window.__wizard.spec.look.theme };
    });
    check('candidate switch works', switched.ok === true && switched.theme === 'graphite-signal', switched.theme);

    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
    process.exitCode = failed ? 1 : 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch((e) => {
  console.error('[fatal]', e.stack || e);
  process.exit(1);
});
