/**
 * app.js — 编辑画布宿主（C2-01 / C2-03 / C2-04）。
 *
 * 结构：
 *   iframe(1920×1080) ── CSS scale ──> 等比显示
 *   点击 iframe 内 canvas → 换算成画布位图坐标 → __inspect → 右侧 schema 面板
 *   面板改动 → __patch(id, props) → 页面自己 renderFrame(currentT) → 即时重绘
 *   底部滑杆 → __renderFrame(t)
 *
 * 全部同源静态资源，无任何外部依赖 / 网络请求。
 */
import { THEME_LIST } from '/templates/themes.js';
import { renderInspector, renderPatches, cloneEntry } from './panel.js';

const $ = (id) => document.getElementById(id);
const frame = $('frame');
const stageWrap = $('stageWrap');
const inspector = $('inspector');
const patchesBox = $('patches');
const timeSlider = $('time');
const timeNum = $('timeNum');
const tLabel = $('tLabel');
const durLabel = $('durLabel');
const statusEl = $('status');
const playBtn = $('play');

const state = {
  page: 'big-card',
  theme: 'coral-noir',
  dur: 1,
  t: 0,
  ready: false,
  entry: null,
  loadToken: 0,
};

// ---------- 顶栏 ----------
function fillThemes() {
  const sel = $('theme');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（无 theme · 旧版默认画面）';
  sel.append(none);
  for (const t of THEME_LIST) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name || t.id} · ${t.id}`;
    sel.append(o);
  }
  sel.value = state.theme;
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function pageUrl() {
  const u = new URL(`/templates/${state.page}.html`, location.origin);
  if (state.theme) u.searchParams.set('theme', state.theme);
  // 与 render-segment.mjs 相同的片段参数：页面按 t0/speed/dur 映射时间
  u.searchParams.set('seg', '1');
  u.searchParams.set('t0', '0');
  u.searchParams.set('speed', '1');
  u.searchParams.set('dur', '3');
  return u.toString();
}

// ---------- 缩放 ----------
function fit() {
  const w = stageWrap.clientWidth;
  const h = stageWrap.clientHeight;
  if (!w || !h) return;
  const s = Math.min(w / 1920, h / 1080);
  frame.style.transform = `scale(${s})`;
  frame.style.left = `${Math.max(0, (w - 1920 * s) / 2)}px`;
  frame.style.top = `${Math.max(0, (h - 1080 * s) / 2)}px`;
}
window.addEventListener('resize', fit);

// ---------- 加载 iframe ----------
function load() {
  state.ready = false;
  state.entry = null;
  state.loadToken++;
  const token = state.loadToken;
  renderInspector(inspector, null);
  setStatus('加载中…');
  frame.src = pageUrl();
  fit();

  frame.onload = () => {
    if (token !== state.loadToken) return;
    waitReady(token);
  };
}

function waitReady(token) {
  let tries = 0;
  const win = frame.contentWindow;
  const tick = () => {
    if (token !== state.loadToken) return;
    let ready = false;
    let bootError = null;
    try {
      ready = win.__ready === true;
      bootError = win.__bootError || null;
    } catch { /* 还在导航 */ }
    if (bootError) { setStatus('页面启动失败：' + String(bootError).slice(0, 160), 'err'); return; }
    if (ready) { onReady(win, token); return; }
    if (++tries > 400) { setStatus('等待 __ready 超时（8s）', 'err'); return; }
    setTimeout(tick, 20);
  };
  setTimeout(tick, 10);
}

function onReady(win, token) {
  if (token !== state.loadToken) return;
  state.ready = true;
  state.dur = Number(win.DURATION) || 1;

  timeSlider.min = '0';
  timeSlider.max = String(state.dur);
  timeSlider.step = String(Math.max(0.001, state.dur / 1000));
  timeNum.min = '0';
  timeNum.max = String(state.dur);
  timeNum.step = String(Math.max(0.001, state.dur / 1000));
  durLabel.textContent = `DURATION ${state.dur}s`;

  const doc = win.document;
  doc.addEventListener('click', (ev) => onStageClick(win, ev));

  fit();
  renderAt(0);
  refreshPatches();
  setStatus(`就绪 · ${state.page} · ${frame.contentWindow.__hit ? frame.contentWindow.__hit.length : 0} 个可编辑区域`, 'ok');
}

// ---------- 点击 → inspect ----------
function onStageClick(win, ev) {
  const cv = win.document.querySelector('canvas');
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // 宿主换算：iframe 内 client 坐标 → 画布位图坐标（含 DPR / canvas CSS 缩放）
  const x = (ev.clientX - r.left) * (cv.width / r.width);
  const y = (ev.clientY - r.top) * (cv.height / r.height);

  let hit = null;
  try { hit = win.__inspect ? win.__inspect(x, y) : null; } catch { hit = null; }

  state.entry = cloneEntry(hit);
  renderInspector(inspector, state.entry, { onChange: (prop, value) => onFieldChange(prop, value) });
  if (hit) setStatus(`选中 ${hit.id} · (${x.toFixed(0)}, ${y.toFixed(0)})`, 'ok');
  else setStatus(`未命中 (${x.toFixed(0)}, ${y.toFixed(0)}) · 该处不可编辑`, '');
}

// ---------- 编辑 → patch ----------
function onFieldChange(prop, value) {
  const win = frame.contentWindow;
  if (!state.ready || !state.entry || typeof win.__patch !== 'function') return;
  const id = state.entry.id;
  let res = null;
  try {
    res = win.__patch(id, { [prop]: value });
  } catch (e) {
    setStatus('__patch 失败：' + (e && e.message || e), 'err');
    return;
  }
  // patch 后面板值以最新命中表为准（文本/字号会改变矩形）。
  // 注意：这里**不重建面板 DOM** —— 重建会丢掉输入焦点，用户每打一个字就要重新点一次。
  // 控件自身已经显示用户刚输入的值；矩形/新 props 在下次点击选中时刷新。
  const fresh = (win.__hit || []).find((e) => e.id === id);
  state.entry = cloneEntry(fresh) || state.entry;
  refreshPatches();
  const n = res && res.diff ? res.diff.patches : 0;
  setStatus(`已 patch ${id}.${prop} = ${JSON.stringify(value)} · 共 ${n} 条`, 'ok');
}

// ---------- patches 面板 ----------
function currentPatches() {
  const win = frame.contentWindow;
  try {
    if (win && win.__editBridge && typeof win.__editBridge.exportPatches === 'function') {
      return win.__editBridge.exportPatches();
    }
    if (win && typeof win.__spec === 'function') return (win.__spec().patches) || [];
  } catch { /* ignore */ }
  return [];
}

function refreshPatches() {
  const patches = currentPatches();
  renderPatches(patchesBox, patches, {
    onCopy: () => copyText(JSON.stringify(patches, null, 2), 'patches JSON 已复制'),
    onDownload: () => downloadJson(patches),
    onClear: () => {
      const win = frame.contentWindow;
      try { if (win.__editBridge) win.__editBridge.clearPatches(); } catch { /* ignore */ }
      state.entry = null;
      renderInspector(inspector, null);
      refreshPatches();
      setStatus('patches 已清空', 'ok');
    },
  });
}

async function copyText(text, okMsg) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  setStatus(ok ? okMsg : '复制失败（浏览器拒绝剪贴板）', ok ? 'ok' : 'err');
}

function downloadJson(patches) {
  const payload = { specVersion: 1, kind: state.page, patches };
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spec.patches.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus('已导出 spec.patches.json', 'ok');
}

// ---------- 时间轴 ----------
function renderAt(t) {
  if (!state.ready) return;
  const v = Math.min(state.dur, Math.max(0, Number(t) || 0));
  state.t = v;
  try { frame.contentWindow.renderFrame(v); } catch { /* 页面可能正在重载 */ }
  timeSlider.value = String(v);
  timeNum.value = v.toFixed(3);
  tLabel.textContent = `t = ${v.toFixed(3)}s`;
}

timeSlider.addEventListener('input', () => renderAt(timeSlider.value));
timeNum.addEventListener('input', () => { if (timeNum.value !== '') renderAt(timeNum.value); });

let raf = 0;
let playing = false;
let lastTs = 0;

function stopPlay() {
  playing = false;
  cancelAnimationFrame(raf);
  playBtn.textContent = '播放';
  playBtn.classList.remove('playing');
}

function startPlay() {
  if (!state.ready) return;
  if (Number(timeSlider.value) >= state.dur - 1e-4) renderAt(0);
  playing = true;
  playBtn.textContent = '暂停';
  playBtn.classList.add('playing');
  lastTs = performance.now();
  const tick = (now) => {
    if (!playing) return;
    const dt = Math.min(0.1, (now - lastTs) / 1000);
    lastTs = now;
    const next = Number(timeSlider.value) + dt;
    if (next >= state.dur) {
      renderAt(state.dur);
      stopPlay();
      return;
    }
    renderAt(next);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));

// ---------- 顶栏事件 ----------
$('page').addEventListener('change', (e) => {
  state.page = e.target.value;
  load();
});
$('theme').addEventListener('change', (e) => {
  state.theme = e.target.value;
  load();
});
$('reload').addEventListener('click', () => load());

// ---------- boot ----------
fillThemes();
renderInspector(inspector, null);
refreshPatches();
load();
